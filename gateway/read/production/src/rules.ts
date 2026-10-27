/**
 * The gateway's rules: the ten checks of conformance/SCHEME.md section 7, in order.
 *
 * The order is part of the scheme, not an implementation detail. In particular the signature is
 * verified BEFORE expiry, lifetime, revocation and path policy, so that a forged link is
 * recorded as a forgery rather than as an expired or denied request, and so that a caller who
 * cannot authenticate learns nothing about why their request failed.
 *
 * The resource controls (the rate limit and the abuse cooldown) sit around those checks rather
 * than inside them: they bound the work the gateway does, and they are not part of the scheme.
 */
import type { AuditReason, AuditRecord, LinkFacts } from "./audit.ts";
import { auditRecord } from "./audit.ts";
import type { Policy } from "./policy.ts";
import { isPathAllowed, prefixToRegExp } from "./policy.ts";
import { parseLink, verifySignature, type ParsedLink } from "./scheme.ts";
import { NotFound, TooLarge, UpstreamError, UpstreamRateLimited, UpstreamTimeout, UpstreamUnauthorized, type Source } from "./source.ts";

export interface StateClient {
  /** The early abuse gate: per-IP and global budgets. */
  gate(ip: string, now: number): Promise<{ action: string; reason: string }>;
  /** The late gate: revocation, the order's request budget and its abuse cooldown. */
  apply(order: string, now: number): Promise<{ action: string; reason: string }>;
  /** Write the final audit record. */
  audit(record: AuditRecord): Promise<void>;
}

export interface RequestFacts {
  method: string;
  /** the raw URL path, still percent-encoded */
  rawPath: string;
  ip: string;
  now: number;
}

export interface Outcome {
  status: number;
  reason: AuditReason;
  headers: Record<string, string>;
  body: Uint8Array | string;
  facts: LinkFacts;
  requestId: string;
  link?: ParsedLink;
}

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "private, no-store",
  // Cloudflare's edge cache is told separately: a cached context file is a leaked context file.
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Every refusal before the file is read returns the same body, so nothing is disclosed. */
const REFUSAL_BODY = "forbidden (link invalid, expired or revoked)\n";

export async function evaluate(
  req: RequestFacts,
  policy: Policy,
  source: Source,
  state: StateClient,
  requestId: string,
): Promise<Outcome> {
  const facts: LinkFacts = {};
  const finish = (status: number, reason: AuditReason, extra?: Record<string, string>, body?: string): Outcome => ({
    status,
    reason,
    headers: { ...TEXT_HEADERS, "X-Request-Id": requestId, ...(extra ?? {}) },
    body: body ?? REFUSAL_BODY,
    facts,
    requestId,
  });

  // 1. the method must be GET or HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    const outcome = finish(405, "method", { Allow: "GET, HEAD" }, "read-only\n");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 2. the resource controls. They run first so that a flood is bounded before any work.
  const gate = await state.gate(req.ip, req.now);
  if (gate.action !== "allow") {
    const outcome = finish(429, gate.reason as AuditReason, { "Retry-After": "60" }, "too many requests\n");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 3. the link parses and its fields are well formed
  const parsed = parseLink(req.rawPath);
  if (!parsed.ok) {
    const outcome = finish(403, parsed.reason);
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }
  const link = parsed.link;
  facts.kid = link.kid;
  facts.order = link.order;
  facts.ref = link.ref;
  facts.path = link.path;

  // 4. the key id is known
  const secret = policy.keys.get(link.kid);
  if (secret === undefined) {
    const outcome = finish(403, "unknown-key");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 5. the signature is valid. Nothing about the request is revealed before this.
  if (!(await verifySignature(secret, link.kid, link.exp, link.order, link.ref, link.path, link.sig))) {
    const outcome = finish(403, "bad-signature");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 6. the link is not expired
  if (req.now > link.exp + policy.clockSkewTolerance) {
    const outcome = finish(403, "expired");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 7. the link is within the maximum lifetime
  if (link.exp - req.now > policy.maxTtl) {
    const outcome = finish(403, "ttl-too-long");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 8. the order is not revoked, and the order is within its request budget
  const applied = await state.apply(link.order, req.now);
  if (applied.action === "revoked") {
    const outcome = finish(403, "revoked");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }
  if (applied.action === "cooldown") {
    const outcome = finish(429, "cooldown", { "Retry-After": "60" }, "too many requests\n");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }
  if (applied.action !== "allow") {
    const outcome = finish(429, "rate-limited", { "Retry-After": "60" }, "too many requests\n");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 9. the path is inside an allowed prefix and matches no deny rule
  const allowed = policy.allowPrefixes.map((p) => prefixToRegExp(p));
  if (!isPathAllowed(link.path, allowed) || policy.deny.some((re) => re.test(link.path))) {
    const outcome = finish(403, "path-denied");
    await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
    return outcome;
  }

  // 10. read the one blob at the one pinned commit
  let content: Uint8Array;
  try {
    content = await source.read(link.ref, link.path);
  } catch (e) {
    if (e instanceof NotFound) {
      const outcome = finish(404, "not-found", undefined, "not found\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    if (e instanceof TooLarge) {
      const outcome = finish(413, "too-large", undefined, "too large\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    if (e instanceof UpstreamTimeout) {
      const outcome = finish(504, "upstream-timeout", undefined, "upstream timeout\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    if (e instanceof UpstreamUnauthorized) {
      const outcome = finish(502, "upstream-unauthorized", undefined, "upstream refused the credential\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    if (e instanceof UpstreamRateLimited) {
      const outcome = finish(503, "upstream-rate-limited", { "Retry-After": "30" }, "upstream rate limited\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    if (e instanceof UpstreamError) {
      const outcome = finish(502, "upstream-error", undefined, "upstream error\n");
      await state.audit(auditRecord(req.now, outcome.status, outcome.reason, requestId, facts));
      return outcome;
    }
    throw e;
  }

  const digest = await sha256Hex(content);
  const headers: Record<string, string> = {
    ...TEXT_HEADERS,
    "X-Content-SHA256": digest,
    "X-Ctx-Order": link.order,
    "X-Request-Id": requestId,
    "Content-Length": String(content.length),
  };
  await state.audit(auditRecord(req.now, 200, "ok", requestId, facts, content.length));
  return {
    status: 200,
    reason: "ok",
    headers,
    body: req.method === "HEAD" ? new Uint8Array(0) : content,
    facts,
    requestId,
    link,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
