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

## 1.4.6 — GitHub write boundary (amended 2026-10-26; supersedes the earlier choice (c))

- **Choice:** a **dedicated, isolated submissions repository** and an **isolated branch** in it, as the plan preferred. The earlier choice (c), the existing private repository with path allow-listing only, is withdrawn.
- **Fixed destination:** gateway configuration names exactly one repository and one branch. The gateway's credential is scoped to the submissions repository only and has no access to the private consumer repository. No request may select a repository, branch or path outside the configured destination.
- **Pre-created, never created by the gateway:** the submissions branch and the task submission folder (named by plan-id/task-id) must already exist before the work order is issued. The gateway never creates repositories, branches or folders. A request for a folder that does not exist fails with a defined error (specified in Phase 5.1). Git does not store empty folders, so "already exists" means the operator has committed a placeholder file in it; the gateway treats that placeholder as non-deliverable (exact handling specified in Phase 5.1).
- **Write scope:** only that task folder on that branch; full file create/read/replace/delete within it. Path allow-listing in gateway code stays as defense in depth.
- **Blast radius:** a leaked token could modify anything in the submissions repository, i.e. other tasks' submissions, but cannot reach the private consumer repository. The documentation must still not describe the credential itself as path-scoped.
- **Consequence for the workflow:** deliverables now land in the submissions repository, not the private consumer repository. The operator's review and sync step must bring accepted files into the consumer repository (Stage 1.1.2 steps 4-6). That transfer path, and the operator tooling that creates the branch and task folder at work-order issue time, are **not yet designed and not yet in the plan** (register R0-011).
- `gateway/write/.dev.vars.example` (`GITHUB_REPO=OWNER/PROJECT-dev`) and `wrangler.toml` placeholders are updated in Stage 5.2.2 / 5.4.6.

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
