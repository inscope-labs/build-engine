# ADR 0002: In-memory content handling

Status: **decided** (2026-10-26)

## Context
Payloads travel in the query string (base64url). They must not be copied to third-party object storage. Maximum sizes and provider logging boundaries must be explicit.

## Decision
- Payloads are handled **in memory only**. They are never written to Durable Object storage, disk, or any third-party object store.
- Maximum sizes follow the approved quotas (see quotas decision): 12 KiB per file, 240 KiB total staged content (binary KiB = 1024 bytes).
- Provider-side logging: the gateway must not emit request URLs, query strings, signatures, or payload bodies to Cloudflare logs, analytics, or any external sink. Application-level audit logs are redacted per ADR 0004.
- Binary files are rejected. Only text content is accepted; each permitted file type is governed by a type-policy configuration (standard defaults for common text types). Content must be valid UTF-8. Empty files are permitted unless a specific type policy says otherwise.

## Consequences
- Staging is request-scoped / short-lived and disappears on isolate eviction (consistent with ADR 0001: file data is ephemeral).
- Type-policy configuration (`type-policy.json` or equivalent) is the single place that enumerates allowed extensions / MIME types.
- Size checks use byte lengths of the decoded payload; the authoritative constants are published in `quotas.json`.
