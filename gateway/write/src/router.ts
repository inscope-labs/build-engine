/**
 * The request router.
 *
 * The routes, in the order the contract's verification order requires:
 *
 *  1. the method must be `GET`;
 *  2. the path must parse into a capability;
 *  3. the key id must be known;
 *  4. the signature must verify;
 *  5. the capability must not be expired;
 *  6. the capability's lifetime must be within the maximum.
 *
 * Steps 1 to 4 answer `401` — except the method, which answers `405` — and steps 2 to 4 answer
 * **the same body** for every failure, so that a caller who cannot authenticate learns nothing
 * about which check failed.
 *
 * After step 6 the request is handed to the Durable Object, which decides the session-level
 * questions: whether the task is revoked, closed or sealed, and whether the operation may
 * proceed.
 */
import { ROUTE_ADMIN, ROUTE_HEALTH } from "./config/constants.ts";
import { authorizeCapability } from "./auth/policy-authz.ts";
import { parseCapabilityPath } from "./auth/root-url.ts";
import { sign, verifySignature } from "./auth/signature.ts";
import { contractDocument } from "./http/contract.ts";
import { errorResponse, envelope, jsonResponse } from "./http/responses.ts";
import { markdownHeaders, textHeaders } from "./http/headers.ts";
import { errorSpec } from "./http/status-codes.ts";
import { originOf } from "./http/help.ts";
import { audit } from "./audit/logger.ts";
import { count, emptyCounters, type Counters } from "./audit/metrics.ts";
import { PROTOCOL } from "./config/constants.ts";
import { now as currentTime, testClockEngaged } from "./util/clock.ts";
import { quotas } from "./policy/quotas.ts";
import type { Env, Config } from "./config/env.ts";
import type { InternalRequest, InternalResponse } from "./session/task-session.ts";

/** The live counters, per Worker instance. */
const counters: Counters = emptyCounters();

/** Everything the router needs. */
export interface RouterInput {
  request: Request;
  env: Env;
  config: Config;
  requestId: string;
}

/** Route one request. */
export async function handleRequest(input: RouterInput): Promise<Response> {
  const { request, env, config, requestId } = input;
  const url = new URL(request.url);
  const now = currentTime(env);
  const base = originOf(request.url);

  // The contract documents, the health endpoint and the operator channel are not the agent
  // protocol and are routed before anything else.
  const document = contractDocument(url.pathname);
  if (document !== null) {
    return new Response(document, { status: 200, headers: markdownHeaders(requestId) });
  }
  if (url.pathname === ROUTE_HEALTH) {
    return health(requestId, env, config, now);
  }
  if (url.pathname === ROUTE_ADMIN || url.pathname.startsWith(`${ROUTE_ADMIN}/`)) {
    return operatorChannel(input, base);
  }

  return handleCapability(input, base, now);
}

/**
 * The capability route.
 *
 * This is where the contract's verification order lives, in the order the contract gives.
 */
async function handleCapability(input: RouterInput, base: string, now: number): Promise<Response> {
  const { request, env, config, requestId } = input;
  const url = new URL(request.url);

  // 1. The method.
  if (request.method !== "GET") {
    const response = errorResponse(requestId, 405, {
      op: "unknown",
      task: null,
      order: null,
      state: null,
      base,
      error: { code: "method-not-allowed", message: "this protocol is GET only", retryable: false },
    });
    response.headers.set("Allow", "GET");
    audit({ ts: now, status: 405, reason: "method-not-allowed", op: "unknown", request_id: requestId });
    count(counters, { op: "unknown", status: 405, code: "method-not-allowed" });
    return response;
  }

  // 2. The path parses into a capability.
  const parsed = parseCapabilityPath(url.pathname);
  if (!parsed.ok) {
    return refuse(requestId, now, "unknown", "not-authorised", base);
  }
  const { capability, operation } = parsed;

  // 3. The key id is known.
  const secret = config.keys.get(capability.kid);
  if (secret === undefined) {
    return refuse(requestId, now, "unknown", "not-authorised", base);
  }

  // 4. The signature verifies. Nothing about the request is revealed before this.
  const valid = await verifySignature(secret, capability, capability.sig);
  if (!valid) {
    return refuse(requestId, now, "unknown", "not-authorised", base);
  }

  // 5. The capability is not expired. 6. Its lifetime is within the maximum.
  const authorized = authorizeCapability(capability, now, config.maxTtlSeconds);
  if (authorized !== null) {
    const response = errorResponse(requestId, authorized.status, {
      op: operation ?? "index",
      task: capability.task,
      order: capability.order,
      state: null,
      base,
      error: authorized.toBody(),
    });
    audit({
      ts: now,
      status: authorized.status,
      reason: authorized.code,
      op: operation ?? "index",
      kid: capability.kid,
      order: capability.order,
      task: capability.task,
      writer: capability.writer,
      request_id: requestId,
    });
    count(counters, { op: operation ?? "index", status: authorized.status, code: authorized.code });
    return response;
  }

  // The session decides the rest.
  const internal: InternalRequest = {
    op: operation,
    query: url.search.replace(/^\?/, ""),
    capability,
    now,
    requestId,
    config: { folderTemplate: config.folderTemplate, leaseSeconds: config.leaseSeconds },
  };

  let outcome: InternalResponse;
  try {
    const stub = env.TASK_SESSION.get(env.TASK_SESSION.idFromName(capability.task));
    const raw = await stub.fetch("https://session.internal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(internal),
    });
    if (raw.status === 503) {
      throw new Error("state unavailable");
    }
    outcome = (await raw.json()) as InternalResponse;
  } catch {
    // The state channel fails closed: if the session cannot be read, the gateway serves nothing.
    const code = "state-unavailable";
    const response = errorResponse(requestId, errorSpec(code).status, {
      op: operation ?? "index",
      task: capability.task,
      order: capability.order,
      state: null,
      base,
      error: { code, message: "the session state is unavailable", retryable: true },
    });
    audit({
      ts: now,
      status: errorSpec(code).status,
      reason: code,
      op: operation ?? "index",
      kid: capability.kid,
      order: capability.order,
      task: capability.task,
      request_id: requestId,
    });
    count(counters, { op: operation ?? "index", status: 503, code });
    return response;
  }

  const status = outcome.ok ? 200 : errorSpec(outcome.error?.code ?? "state-unavailable").status;
  const body = envelope({
    op: outcome.op,
    task: capability.task,
    order: capability.order,
    state: outcome.state,
    result: outcome.result,
    next: outcome.next,
    error: outcome.error,
    base,
  });
  const response = jsonResponse(requestId, status, body);

  // The audit record is a fixed schema. The session says which of the extra fields may be
  // written, and only those are copied: nothing from the result is merged in wholesale.
  audit({
    ts: now,
    status,
    reason: outcome.ok ? "ok" : (outcome.error?.code ?? "error"),
    op: outcome.op,
    kid: capability.kid,
    order: capability.order,
    task: capability.task,
    writer: capability.writer,
    ...(outcome.audit?.commit !== undefined ? { commit: outcome.audit.commit } : {}),
    ...(outcome.audit?.files !== undefined ? { files: outcome.audit.files } : {}),
    ...(outcome.audit?.selection !== undefined ? { selection: outcome.audit.selection } : {}),
    request_id: requestId,
  });
  count(counters, {
    op: outcome.op,
    status,
    code: outcome.ok ? undefined : outcome.error?.code,
    replayed: outcome.ok && typeof outcome.result === "object" && outcome.result !== null
      ? (outcome.result as { replayed?: boolean }).replayed === true
      : false,
  });

  return response;
}

/**
 * The single refusal for every pre-signature failure.
 *
 * The body is the same for a malformed path, an unknown key id and a bad signature, so that a
 * caller who cannot authenticate learns nothing at all.
 */
function refuse(requestId: string, now: number, op: string, code: string, base: string): Response {
  const response = errorResponse(requestId, errorSpec(code).status, {
    op,
    task: null,
    order: null,
    state: null,
    base,
    error: { code, message: "not authorised", retryable: false },
  });
  audit({ ts: now, status: errorSpec(code).status, reason: code, op, request_id: requestId });
  count(counters, { op, status: errorSpec(code).status, code });
  return response;
}

/**
 * The health endpoint.
 *
 * It reports the status, the version, the protocol, the effective policy and whether the test
 * clock is on. It holds no path, no order and no count of protected files.
 */
function health(requestId: string, env: Env, config: Config, now: number): Response {
  const limits = quotas();
  return new Response(
    JSON.stringify({
      status: "ok",
      version: "0.5.0",
      protocol: PROTOCOL,
      now,
      policy: {
        max_ttl_seconds: config.maxTtlSeconds,
        lease_seconds: config.leaseSeconds,
        max_files: limits.max_files,
        max_total_bytes: limits.max_total_bytes,
        max_file_bytes: limits.max_file_bytes,
        rate_limit: limits.rate_limit,
        max_concurrency: limits.max_concurrency,
        key_ids: [...config.keys.keys()].sort(),
        submissions_repo: config.submissionsRepo,
        submissions_branch: config.submissionsBranch,
      },
      conformance_clock: testClockEngaged(env),
    }),
    { status: 200, headers: textHeaders(requestId) },
  );
}

/**
 * The operator channel.
 *
 * A separate route namespace with a separate credential. Holding a signing key does not grant
 * operator rights, and holding the operator token does not mint capabilities.
 */
async function operatorChannel(input: RouterInput, base: string): Promise<Response> {
  const { request, env, requestId } = input;
  const url = new URL(request.url);

  if (!isOperator(request, env)) {
    return new Response("unauthorised\n", { status: 401, headers: textHeaders(requestId) });
  }

  if (url.pathname === `${ROUTE_ADMIN}/metrics` && request.method === "GET") {
    return new Response(JSON.stringify(counters), { status: 200, headers: textHeaders(requestId) });
  }

  if (url.pathname === `${ROUTE_ADMIN}/audit` && request.method === "GET") {
    // Stage 5.4.1 implements the audit stream and its retention.
    return new Response(
      JSON.stringify({ error: { code: "not-implemented", message: "the audit stream is Stage 5.4.1" } }),
      { status: 501, headers: textHeaders(requestId) },
    );
  }

  if (url.pathname === `${ROUTE_ADMIN}/mint` && request.method === "POST") {
    return mintCapability(input, base);
  }

  const transitions: Record<string, string> = {
    [`${ROUTE_ADMIN}/revoke`]: "/admin/revoke",
    [`${ROUTE_ADMIN}/close`]: "/admin/close",
    [`${ROUTE_ADMIN}/reset-quota`]: "/admin/reset-quota",
  };
  const internal = transitions[url.pathname];
  if (internal !== undefined && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { task?: string };
    if (typeof body.task !== "string" || body.task === "") {
      return new Response("bad request\n", { status: 400, headers: textHeaders(requestId) });
    }
    const stub = env.TASK_SESSION.get(env.TASK_SESSION.idFromName(body.task));
    const result = await stub.fetch(`https://session.internal${internal}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: body.task }),
    });
    return new Response(await result.text(), { status: result.status, headers: textHeaders(requestId) });
  }

  return new Response("not found\n", { status: 404, headers: textHeaders(requestId) });
}

/** Whether the request carries the operator credential. */
function isOperator(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (match === null) return false;
  return timingSafeEqual(match[1]!, env.OPERATOR_TOKEN);
}

/**
 * Compare two strings without leaking the position of the first difference.
 *
 * The operator token is a secret, so the comparison must not be an early-exit one.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint a capability.
 *
 * The operator channel's own job: it turns a task id into a capability URL. The agent never
 * receives a credential, only the URL.
 */
async function mintCapability(input: RouterInput, base: string): Promise<Response> {
  const { request, env, config, requestId } = input;
  const body = (await request.json().catch(() => ({}))) as {
    task?: string;
    order?: string;
    plan?: string;
    writer?: string;
    kid?: string;
    ttl?: number;
    head?: string;
  };

  const task = body.task ?? "";
  const order = body.order ?? "";
  const plan = body.plan ?? "";
  const writer = body.writer ?? "";
  const kid = body.kid ?? [...config.keys.keys()].sort()[0] ?? "";
  const head = body.head ?? "0".repeat(40);
  const ttl = typeof body.ttl === "number" && Number.isInteger(body.ttl) && body.ttl > 0 ? body.ttl : 3600;

  if (task === "" || order === "" || plan === "" || writer === "" || kid === "") {
    return new Response("bad request\n", { status: 400, headers: textHeaders(requestId) });
  }
  const secret = config.keys.get(kid);
  if (secret === undefined) {
    return new Response("bad request\n", { status: 400, headers: textHeaders(requestId) });
  }

  const now = currentTime(env);
  const exp = now + Math.min(ttl, config.maxTtlSeconds);
  const fields = { kid, exp, order, plan, task, writer, head };
  const signature = await sign(secret, fields);
  const capability = `${base}/w1/${kid}/${exp}/${order}/${plan}/${task}/${writer}/${head}/${signature}`;

  return new Response(JSON.stringify({ capability, exp, kid }), { status: 200, headers: textHeaders(requestId) });
}
