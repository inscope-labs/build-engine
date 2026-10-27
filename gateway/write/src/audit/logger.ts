/**
 * The audit log (protocol section 11, ADR 0004).
 *
 * Every request writes exactly one record, after the outcome is known, so that it carries the
 * final status. The record is one JSON object per line.
 *
 * **Stage 5.4** adds the retention policy, the query interface and the sentinel-injection
 * verification. What is here is the record's shape and the writing of it, which the protocol
 * fixes.
 */
import { auditRecord, type AuditFields } from "./redaction.ts";

/** One audit record. */
export type AuditEntry = Record<string, unknown>;

/**
 * Write one audit record.
 *
 * The record goes to the platform's log as a single line. `console.log` is the Workers runtime's
 * log; the platform captures it, and the platform's own log retention is configured by the
 * operator (protocol section 10.2).
 */
export function writeAudit(entry: AuditEntry): void {
  console.log(JSON.stringify(entry));
}

/** Build and write one audit record. */
export function audit(fields: AuditFields): void {
  writeAudit(auditRecord(fields));
}

/**
 * A request id.
 *
 * It correlates the response, the audit record and the platform's log line, and it is returned in
 * the `X-Request-Id` header so that an operator can find the request in the log.
 */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
