/**
 * ctxgate-read: the production Class B context-read gateway.
 *
 * A Cloudflare Worker (docs/decisions/0001) that verifies a signed ctxgate-v1 link and serves
 * exactly one file at one pinned commit from one private repository. It holds no repository
 * credential of its own beyond a single read-only, short-lived token, it never writes to the
 * repository, and it has no path that serves anything a valid link does not name.
 *
 * The scheme is `conformance/SCHEME.md`. The rules are `src/rules.ts`.
 */
import { newRequestId } from "./audit.ts";
import { healthPayload, loadPolicy, ConfigError, type Policy } from "./policy.ts";
import { evaluate } from "./rules.ts";
import { GitHubContentsSource, type Source } from "./source.ts";
import { buildStateClient, callStateAdmin } from "./state-client.ts";
import { GatewayState } from "./state.ts";

export interface Env {
  /** JSON: { "k1": "<secret>" }. A secret; never in wrangler.toml. */
  SIGNING_KEYS: string;
  /** The operator credential for the admin channel. A secret. */
  OPERATOR_TOKEN: string;
  /** The repository credential. A secret. Read-only, one repository, short expiry. */
  GITHUB_TOKEN: string;
  GITHUB_API_BASE: string;
  GITHUB_REPO: string;
  ALLOW_PREFIXES: string;
  DENY_PATTERNS: string;
  MAX_BYTES: string;
  MAX_TTL: string;
  CLOCK_SKEW_TOLERANCE: string;
  SOURCE_TIMEOUT_MS: string;
  RATE_LIMIT_PER_ORDER: string;
  RATE_LIMIT_PER_IP: string;
  RATE_LIMIT_GLOBAL: string;
  REFUSAL_BURST: string;
  REFUSAL_COOLDOWN_SECONDS: string;
  AUDIT_RETENTION: string;
  /** Test-mode clock switch. A production deployment MUST NOT set it. */
  CTXGATE_TEST_CLOCK: string;
  STATE: DurableObjectNamespace;
}

const VERSION = "0.5.0";

// The Durable Object class must be exported from the entrypoint so that the runtime can bind it.
export { GatewayState };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let policy: Policy;
    try {
      policy = loadPolicy(env as unknown as Record<string, string | undefined>);
    } catch (e) {
      // A misconfigured gateway fails closed. It says what is wrong to the operator, because a
      // gateway that cannot serve a link must still be diagnosable, and it serves no content.
      const message = e instanceof ConfigError ? e.message : "configuration error";
      return new Response(`gateway misconfigured: ${message}\n`, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/healthz") {
      return Response.json(
        { ...healthPayload(policy, VERSION), conformance_clock: env.CTXGATE_TEST_CLOCK === "1" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url);
    }
    return handleLink(request, env, url, policy);
  },
};

/** The link route. The whole of it. */
async function handleLink(request: Request, env: Env, url: URL, policy: Policy): Promise<Response> {
  const requestId = newRequestId();
  const now = currentTime(env, request);
  const source = buildSource(env, policy);
  const state = buildStateClient(env, policy);

  let outcome;
  try {
    outcome = await evaluate(
      { method: request.method, rawPath: url.pathname, ip: clientIp(request), now },
      policy,
      source,
      state,
      requestId,
    );
  } catch (e) {
    // An unexpected failure must not become a stack trace in the caller's face, and it must not
    // go unrecorded. The reason is "internal-error": the gateway does not know why it failed,
    // and it does not serve anything.
    console.error("ctxgate-read: unhandled failure", e);
    const record = {
      ts: now,
      status: 500,
      reason: "internal-error",
      kid: "-",
      order: "-",
      ref: "-",
      path: "-",
      bytes: 0,
      request_id: requestId,
    };
    await state.audit(record);
    return new Response("internal error\n", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  }

  const headers = new Headers(outcome.headers);
  return new Response(outcome.body as BodyInit, { status: outcome.status, headers });
}

/**
 * The operator channel: revoke an order, read the audit trail, read the metrics.
 * It is authenticated with its own credential, separately from the signing keys, so that
 * holding a signing key does not give an operator the right to rewrite the revocation list.
 */
async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isOperator(request, env)) {
    return new Response("unauthorised\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (url.pathname === "/admin/revoke" && request.method === "POST") {
    let order = "";
    try {
      const body = (await request.json()) as { order?: string };
      order = (body.order ?? "").trim();
    } catch {
      return new Response("bad request\n", { status: 400 });
    }
    if (!order) return new Response("bad request\n", { status: 400 });
    // The revocation is reported as done only when the state store says it stored it. An
    // operator who is told "revoked" stops watching that order, so a revoke that silently
    // failed would leave a live capability behind a closed door.
    const result = await callStateAdmin(env, "/revoke", "POST", { order });
    if (!result.ok) {
      return new Response(`${result.message}\n`, {
        status: result.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return Response.json({ revoked: order });
  }

  if (url.pathname === "/admin/audit") {
    const order = url.searchParams.get("order");
    const result = await callStateAdmin(env, "/audit", "GET");
    if (!result.ok) {
      return new Response(`${result.message}\n`, {
        status: result.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const text = await result.response.text();
    if (!order) {
      return new Response(text, {
        headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
      });
    }
    const kept = text
      .split("\n")
      .filter((line) => line.trim())
      .filter((line) => {
        try {
          return (JSON.parse(line) as { order?: string }).order === order;
        } catch {
          return false;
        }
      })
      .join("\n");
    return new Response(kept ? kept + "\n" : "", {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  if (url.pathname === "/admin/metrics") {
    const result = await callStateAdmin(env, "/metrics", "GET");
    if (!result.ok) {
      return new Response(`${result.message}\n`, {
        status: result.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return new Response(await result.response.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response("not found\n", { status: 404 });
}

/** Constant-time comparison of the operator token. */
function isOperator(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = env.OPERATOR_TOKEN ?? "";
  if (presented.length !== expected.length || expected.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function buildSource(env: Env, policy: Policy): Source {
  return new GitHubContentsSource({
    apiBase: env.GITHUB_API_BASE || "https://api.github.com",
    repo: env.GITHUB_REPO || "",
    token: env.GITHUB_TOKEN || "",
    maxBytes: policy.maxBytes,
    timeoutMs: policy.sourceTimeoutMs,
  });
}

/**
 * The current time. The conformance test clock is inert unless CTXGATE_TEST_CLOCK=1; a
 * production deployment MUST NOT set it, because the override would let a caller extend the
 * life of an expired link.
 */
function currentTime(env: Env, request: Request): number {
  if (env.CTXGATE_TEST_CLOCK === "1") {
    const header = request.headers.get("X-Conformance-Now");
    if (header && /^[0-9]+$/.test(header)) return Number(header);
  }
  return Math.floor(Date.now() / 1000);
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}
