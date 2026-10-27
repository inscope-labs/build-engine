/**
 * Redaction (ADR 0004).
 *
 * The rule is not "redact the things that look sensitive". The rule is that the audit record and
 * the error body are **built field by field from a fixed schema**, so that a value that is not in
 * the schema has no path into the output at all.
 *
 * This module is the second line of defence: it is the place where a value is checked before it
 * is put into a record, and the place where a mistake in a caller is caught rather than logged.
 */

/** The values that must never appear in an audit record or a log line. */
const FORBIDDEN = [
  // A capability path: /w1/<kid>/<exp>/<order>/<plan>/<task>/<writer>/<head>/<sig>
  /\/w1\/[A-Za-z0-9_]+\/\d+\/[^\s/]+\/[^\s/]+\/[^\s/]+\/[^\s/]+\/[0-9a-f]{40}\/[A-Za-z0-9_-]{43}/g,
  // A signature on its own.
  /\b[A-Za-z0-9_-]{43}\b/g,
  // A query string.
  /\?[A-Za-z0-9_.~%+&=-]{8,}/g,
  // A bearer token, in the shapes GitHub and Cloudflare use.
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\b[A-Fa-f0-9]{2}:[A-Za-z0-9_-]{20,}\b/g,
];

/**
 * Remove anything that looks like a secret from a string.
 *
 * This is a backstop, not the mechanism. The mechanism is the fixed schema.
 */
export function redactText(value: string): string {
  let out = value;
  for (const pattern of FORBIDDEN) out = out.replace(pattern, "[redacted]");
  return out;
}

/**
 * Whether a string contains something that must not be logged.
 *
 * The tests use this as a hard assertion: a sentinel that reaches a captured log fails the run.
 */
export function containsSecret(value: string): boolean {
  for (const pattern of FORBIDDEN) {
    if (new RegExp(pattern.source, pattern.flags.replace("g", "")).test(value)) return true;
  }
  return false;
}

/** The fields of an audit record. Nothing else may be written. */
export interface AuditFields {
  /** The time of the request, in unix seconds. */
  ts: number;
  /** The HTTP status that was returned. */
  status: number;
  /** The machine-readable cause. The same string as `error.code` on a failure. */
  reason: string;
  /** The operation, or the path as written when the request did not parse. */
  op: string;
  /** The key id. A selector, not a secret. */
  kid?: string | undefined;
  /** The work order. */
  order?: string | undefined;
  /** The task. */
  task?: string | undefined;
  /** The writer. */
  writer?: string | undefined;
  /** The number of bytes the request moved. A count, never content. */
  bytes?: number | undefined;
  /** The number of files the request touched. A count, never a path list. */
  files?: number | undefined;
  /** Whether the request was an idempotent replay. */
  replayed?: boolean | undefined;
  /** The request id, which is also returned in the `X-Request-Id` header. */
  request_id: string;
}

/**
 * Build an audit record.
 *
 * The record is assembled from the fields above and nothing else. A signature, a secret, a raw
 * URL, a query string and file content have no field to be written into, and the string fields
 * are redacted as a second line of defence.
 */
export function auditRecord(fields: AuditFields): Record<string, unknown> {
  const record: Record<string, unknown> = {
    ts: fields.ts,
    status: fields.status,
    reason: fields.reason,
    op: fields.op,
    request_id: fields.request_id,
  };
  if (fields.kid !== undefined) record.kid = fields.kid;
  if (fields.order !== undefined) record.order = fields.order;
  if (fields.task !== undefined) record.task = fields.task;
  if (fields.writer !== undefined) record.writer = fields.writer;
  if (fields.bytes !== undefined) record.bytes = fields.bytes;
  if (fields.files !== undefined) record.files = fields.files;
  if (fields.replayed !== undefined) record.replayed = fields.replayed;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") record[key] = redactText(value);
  }
  return record;
}
