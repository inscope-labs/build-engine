/**
 * The audit trail.
 *
 * One record per request, with exactly the fields documented in conformance/SCHEME.md section 10.
 * The record never holds the signature, the signing secret, the raw URL or the file content: the
 * audit trail is read by the operator and by anybody who can reach the admin channel, so it must
 * not become a second copy of the capability.
 */

export const AUDIT_REASONS = [
  "ok",
  "method",
  "encoded-separator",
  "malformed",
  "unknown-key",
  "bad-signature",
  "expired",
  "ttl-too-long",
  "revoked",
  "path-denied",
  "not-found",
  "too-large",
  "rate-limited",
  "cooldown",
  "upstream-error",
  "upstream-timeout",
  "upstream-unauthorized",
  "upstream-rate-limited",
  "internal-error",
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

/**
 * The refusals that can only be reached AFTER the signature has been verified.
 *
 * These are the refusals that say something about an order: its link was expired, its budget was
 * spent, it was revoked, its path was denied. They are counted against the order's abuse
 * cooldown. The refusals that come BEFORE the signature (a malformed link, an unknown key, a bad
 * signature) are not counted: an unauthenticated caller must not be able to lock out a real
 * order, and the order in a forged link is nothing but a string the forger chose.
 *
 * "cooldown" is not counted either: a request refused by the cooldown must not extend it.
 */
const AUTHENTICATED_REFUSALS: ReadonlySet<string> = new Set([
  "expired",
  "ttl-too-long",
  "revoked",
  "path-denied",
  "not-found",
  "too-large",
  "rate-limited",
  "upstream-error",
  "upstream-timeout",
  "upstream-unauthorized",
  "upstream-rate-limited",
]);

/** True when the refusal happened after the request proved it held a valid link. */
export function isAuthenticatedRefusal(reason: string): boolean {
  return AUTHENTICATED_REFUSALS.has(reason);
}

export interface AuditRecord {
  ts: number;
  status: number;
  reason: string;
  kid: string;
  order: string;
  ref: string;
  path: string;
  bytes: number;
  request_id: string;
}

/** The fields a link carries. Only these are ever recorded, and only after validation. */
export interface LinkFacts {
  kid?: string;
  order?: string;
  ref?: string;
  path?: string;
}

/**
 * Build an audit record. The facts are copied field by field, so nothing that is not on this
 * list can reach the trail - there is no path by which a signature or a secret gets in.
 */
export function auditRecord(
  ts: number,
  status: number,
  reason: string,
  requestId: string,
  facts: LinkFacts = {},
  bytes = 0,
): AuditRecord {
  return {
    ts,
    status,
    reason,
    kid: facts.kid ?? "-",
    order: facts.order ?? "-",
    ref: facts.ref ?? "-",
    path: facts.path ?? "-",
    bytes,
    request_id: requestId,
  };
}

/** A correlation id for one request. Not a capability: it grants nothing and is not a secret. */
export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
