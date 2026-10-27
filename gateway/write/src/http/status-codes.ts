/**
 * The error catalogue, in code.
 *
 * The authority is `gateway/write/docs/error-catalog.md`. This module is its machine-readable
 * form: the status each code carries, and whether retrying the same request unchanged can succeed.
 *
 * The status is a coarse bucket and the **code is the authoritative outcome**: two codes may share
 * a status, and a client that branches on the status instead of the code will get the wrong
 * behaviour on at least one of them.
 */

/** What the gateway knows about one error code. */
export interface ErrorSpec {
  /** The HTTP status. */
  status: number;
  /** Whether retrying the same request unchanged can succeed. */
  retryable: boolean;
}

/**
 * Every code the contract defines.
 *
 * The codes are grouped by status, and the grouping is meaningful: the 400s are "the request is
 * malformed", the 401 is "no valid capability was presented", the 403s and 410s are "your
 * capability is valid and you may not proceed", and the 409s are "the request disagrees with the
 * current state".
 */
export const ERROR_SPECS: Readonly<Record<string, ErrorSpec>> = Object.freeze({
  // 400 — the request is malformed.
  "unknown-operation": { status: 400, retryable: false },
  "unknown-parameter": { status: 400, retryable: false },
  "repeated-parameter": { status: 400, retryable: false },
  "empty-selection": { status: 400, retryable: false },
  "type-mismatch": { status: 400, retryable: false },
  "hash-mismatch": { status: 400, retryable: false },
  "not-utf8": { status: 400, retryable: false },
  "not-text": { status: 400, retryable: false },
  "type-not-allowed": { status: 400, retryable: false },
  "schema-invalid": { status: 400, retryable: false },
  "empty-not-allowed": { status: 400, retryable: false },
  "destination-not-selectable": { status: 400, retryable: false },
  "malformed-path": { status: 400, retryable: false },
  "invalid-parameter": { status: 400, retryable: false },

  // 401 — no valid capability was presented. One body for every failure here.
  "not-authorised": { status: 401, retryable: false },

  // 403 — a valid capability that may not proceed.
  "capability-expired": { status: 403, retryable: false },
  "ttl-exceeded": { status: 403, retryable: false },
  "not-permitted": { status: 403, retryable: false },

  // 404 — after a valid capability, something is not there.
  "file-not-found": { status: 404, retryable: false },
  "task-folder-missing": { status: 404, retryable: false },

  // 405 — wrong method.
  "method-not-allowed": { status: 405, retryable: false },

  // 409 — a conflict with the current state.
  "writer-conflict": { status: 409, retryable: false },
  "path-exists": { status: 409, retryable: false },
  "sequence-gap": { status: 409, retryable: false },
  "sequence-conflict": { status: 409, retryable: false },
  "idempotency-conflict": { status: 409, retryable: false },
  "file-not-staged": { status: 409, retryable: false },
  "file-count-exceeded": { status: 409, retryable: false },
  "expected-sha-conflict": { status: 409, retryable: false },
  "seal-requires-commit": { status: 409, retryable: false },
  "reconcile-required": { status: 409, retryable: false },

  // 410 — the task's write path is closed. Three closures, three meanings.
  "task-sealed": { status: 410, retryable: false },
  "task-revoked": { status: 410, retryable: false },
  "order-closed": { status: 410, retryable: false },

  // 413 — a size quota.
  "file-too-large": { status: 413, retryable: false },
  "total-bytes-exceeded": { status: 413, retryable: false },

  // 429 — a rate quota.
  "rate-limited": { status: 429, retryable: true },

  // 501 — a route that is specified but not yet implemented.
  "not-implemented": { status: 501, retryable: false },

  // 503 — the gateway cannot serve the request.
  "gateway-misconfigured": { status: 503, retryable: false },
  "state-unavailable": { status: 503, retryable: true },
});

/** The spec of a code. An unknown code is treated as a 500 rather than being thrown away. */
export function errorSpec(code: string): ErrorSpec {
  return ERROR_SPECS[code] ?? { status: 500, retryable: false };
}

/** Whether the code is one the contract defines. Used by the tests and by the redaction gate. */
export function isKnownCode(code: string): boolean {
  return code in ERROR_SPECS;
}
