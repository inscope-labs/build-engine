/**
 * The audit stream's types (protocol section 11).
 *
 * The record is built field by field from a fixed schema, and it is built **twice**: once in the
 * Worker, for the platform's log, and once in the Durable Object, for the durable stream. The
 * second build is the point — the Durable Object does not trust the record it is handed, it
 * rebuilds it from the fields it is handed. A compromised Worker, or a bug in one, cannot put a
 * secret into the durable stream, because the Durable Object applies the same gate.
 */

/** One audit record, as it is stored and as it is logged. */
export interface AuditRecord {
  /** The time of the request, in unix seconds. */
  ts: number;
  /** The HTTP status that was returned. */
  status: number;
  /** The machine-readable cause. */
  reason: string;
  /** The operation. */
  op: string;
  /** The request id, which is also the `X-Request-Id` header. */
  request_id: string;
  /** The key id. A selector, not a secret. */
  kid?: string;
  /** The work order. */
  order?: string;
  /** The task. */
  task?: string;
  /** The writer. */
  writer?: string;
  /** The number of bytes the request moved. */
  bytes?: number;
  /** The number of files the request touched. */
  files?: number;
  /** Whether the request was an idempotent replay. */
  replayed?: boolean;
  /** The commit sha, when the request made one. */
  commit?: string;
  /** The digest of the commit's selection. */
  selection?: string;
}

/** The query the operator's route makes. */
export interface AuditQuery {
  /** Only records at or after this time, in unix seconds. */
  since?: number;
  /** The most records to return. */
  limit?: number;
}

/** The defaults the audit stream applies. */
export const AUDIT_DEFAULT_LIMIT = 200;
export const AUDIT_MAX_LIMIT = 1000;
export const AUDIT_DEFAULT_RETENTION_SECONDS = 86400;
export const AUDIT_MAX_RETENTION_SECONDS = 604800;
