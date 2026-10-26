# ADR 0004: Audit log hygiene

Status: **decided** (2026-10-26)

## Context
Every request must produce an audit record, but root URLs, signatures, base64 payloads, file content, and secrets must never appear in logs, metrics, traces, or error responses.

## Decision
- **Always redact** from all logs, metrics, error responses, and traces:
  - Root capability URLs
  - Signatures and HMAC material
  - Full query strings and base64url payloads
  - File content and decoded payload bodies
  - GitHub tokens and any other secrets
  - Any other field that would allow reconstruction of a capability or credential
- **Retain** structured, redacted audit events that record at minimum:
  - Event type (e.g. stage, commit, seal, revoke, reject)
  - Task / order identifier
  - Outcome (success, conflict, quota, authz, etc.)
  - Timestamp
  - Redacted path or file-count summaries where useful for operators
- **Retention and access**: operator-controlled. Default retention should be long enough for post-task review and incident investigation; exact duration is an operational parameter. Only the operator (or systems the operator designates) may query the audit stream.
- Implementation must be tested by injecting sentinel secrets/payloads and asserting they never appear in captured output.

## Consequences
- `src/audit/redaction.ts` (and equivalent) is a hard gate for every log line.
- Error responses to agents remain uninformative about internal state beyond the documented error catalogue.
