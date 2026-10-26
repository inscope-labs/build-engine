# ADR 0001: Durable Object coordination and storage

Status: **decided** (2026-10-26)

## Context
The write gateway is a Cloudflare Worker with a Durable Object (`TaskSession`) per task. Isolate eviction, restart, redeploy, and retry can occur at any time. We must define what state survives and what does not.

## Decision
- **Durable** (must survive isolate eviction, restart, and redeploy):
  - Writer lease / single-writer claim
  - Seal state and revocation/tombstone state
  - Idempotency keys and their associated outcomes
  - Sequence / quota accounting metadata
  - Any other control-plane state required to enforce “one writer”, “fail after seal”, and idempotent commit
- **Ephemeral** (may be lost):
  - Task data itself — the actual file contents or partial file contents staged for commit
- **Recovery when a commit succeeds at GitHub but the response is lost** (timeout / isolate death):
  - On retry with the same idempotency key, the gateway must detect that the commit already exists (via expected SHA / commit comparison or equivalent) and return a consistent success outcome without creating a duplicate commit.
  - If the outcome cannot be determined, the gateway must return a deterministic “reconcile required” style error rather than silently creating a second commit.
  - Exact detection mechanism is an implementation detail; the observable behaviour is: same key + same logical payload → same successful result; same key + different payload → conflict (see ADR on commit semantics).

## Consequences
- Durable Object storage (SQLite-backed class as currently assumed in `wrangler.toml`) holds control-plane state only.
- Staged file bytes live only in memory (or equivalent non-durable staging) for the duration of the request / short-lived session window.
- Tests must cover eviction and “commit succeeded, response lost” scenarios.
