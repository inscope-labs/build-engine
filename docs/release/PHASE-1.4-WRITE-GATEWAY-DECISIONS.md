# Build Engine — Phase 1.4 Write-Gateway Decisions Closeout

- Repository: https://github.com/inscope-labs/build-engine
- Branch: phase-1/write-gateway-decisions
- Baseline: main @ 3e8a8ed874696f846687848ba11b8b876b9e1ae6
- Date: 2026-10-26
- Status: **Decisions recorded; submitted for review**

## Scope change

The write gateway is **in-scope and mandatory** for the 0.5.0 first release (same status as the read gateway after Stage 1.3). Class B agents require it.

## 1.4.1 — Transport

- **Adopted:** GET-only write gateway with payload in the query string (base64url).
- Described as a constrained compatibility transport for Class B agents that can only issue HTTPS GET, not as a claim that GET is generally safe for mutation.
- Residual risks of side-effecting GET (caching, prefetch, intermediary/platform logs) **are accepted**, subject to the mitigations in ADR 0003.

## 1.4.2 — Durable Object coordination (ADR 0001)

- **Durable:** writer lease, seal/revocation state, idempotency keys and outcomes, sequence/quota metadata, and all other control-plane state needed to enforce single-writer and post-seal failure.
- **Ephemeral:** task data (actual file contents / partial files).
- **Lost-response recovery:** retry with the same idempotency key must yield a consistent success if the commit already exists; same key + different payload → conflict; indeterminate state → explicit reconcile-required error, never a silent duplicate commit.

## 1.4.3 — Content handling (ADR 0002)

- In-memory only; never copied to Durable Object storage, disk, or third-party object storage.
- No binary files. Text only; per-type configuration with standard defaults for common text types. Valid UTF-8 required. Empty files permitted unless a type policy forbids them.
- Size limits enforced on decoded byte lengths.

## 1.4.4 — Side-effecting GET (ADR 0003)

- Adopted with residual risk accepted.
- Mandatory mitigations: `Cache-Control: no-store, no-cache`, no mutating redirects, non-prefetchable shapes where possible, and strict log hygiene (ADR 0004).

## 1.4.5 — Audit hygiene (ADR 0004)

- Redact root URLs, signatures, payloads, content, secrets from all logs, metrics, traces, and error responses.
- Retain structured redacted events (type, task/order id, outcome, timestamp, safe summaries).
- Retention and query access are operator-controlled; hygiene is tested with sentinel injection.

## 1.4.6 — GitHub write boundary

- **Choice (c):** the existing private repository with **server-enforced path allow-listing only**.
- The work order supplied to the agent states the plan-id, the repository, and the task submission path. That folder must already exist.
- Write scope is **only** that folder. Full file CRUD inside it; no write access outside it.
- A fine-grained PAT remains repository-scoped; path restriction is enforced solely by gateway code. Documentation must not claim the credential itself is path-scoped.
- Prefer least-privilege credentials, short lifetime, and operator-controlled rotation (standard practice).

## 1.4.7 — Commit, seal, revoke, and post-close behaviour

- **Commit:** idempotent. Same idempotency key + same logical payload → same success. Same key + different payload → conflict (standard conflict semantics; no silent overwrite).
- **Seal:** marks the task submission process complete and hands control of the folder over. Invoked by the agent via the small folder command set exposed by the gateway.
- **Revoke:** tears down the specific task-id based API URL endpoints. Performed by the supervisor (operator-controlled path), not by the agent.
- **After seal or work-order closure:** further writes fail.

## 1.4.8 — Quotas

Retained as proposed (binary KiB = 1024 bytes), published in `src/config/quotas.json`:

| Limit | Value |
|-------|--------|
| Max files | 20 |
| Max total bytes | 245760 (240 × 1024) |
| Max file bytes | 12288 (12 × 1024) |
| Rate limit | 30 requests / 60 seconds |
| Max concurrency | 1 (single writer) |

## 1.4.9 — Types, paths, and validation

- No binary. Type policy configuration supplies allowed extensions / types; standard defaults for common text formats.
- UTF-8 validation required.
- Path normalisation, rejection of traversal / reserved / hidden names, and standard safety rules apply (aligned with the read gateway’s normalisation principles).
- Empty files allowed unless a specific type policy says otherwise.

## Engine invariants (question 19)

- The **worker still holds no credential**. The gateway holds the GitHub write credential.
- Documentation (`AGENTS.md`, `SECURITY.md`, supervisor prompt) must be updated to describe the Class B path accurately: agents obtain a capability URL; the gateway performs the write under a credential the agent never sees.
- The previous absolute statement “only the operator uploads” is refined, not abandoned: Class A / operator path remains operator-driven; Class B path is gateway-mediated.

## Hosting

- Cloudflare Workers, operator-owned, consistent with the read gateway (Stage 1.3).

## Exit criteria for Stage 1.4

- [x] ADRs 0001–0004 decided and recorded.
- [x] Transport, scope, quotas, commit/seal/revoke, and credential boundary decided.
- [x] First-release scope (mandatory for 0.5.0) recorded.
- [ ] Operator review and merge of this branch.
- [ ] Phase 1 exit gate can then be considered once any residual documentation alignment is complete.

## Next

Phase 1 exit gate review, then Phase 2 (repair release foundation and shipped template) or Phase 4/5 implementation work on the gateways as prioritised.
