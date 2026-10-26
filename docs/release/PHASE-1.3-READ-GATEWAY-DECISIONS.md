# Build Engine — Phase 1.3 Read-Gateway Decisions Closeout

- Repository: https://github.com/inscope-labs/build-engine
- Branch: phase-1/read-gateway-decisions
- Baseline: main @ b1923be5a940b8e87810c01485607b5b4e452cf7
- Date: 2026-10-26
- Status: **Decisions recorded; submitted for review**

## Scope change relative to Stage 1.1

Stage 1.1 product contract classified the production Class B read gateway as explicitly out of scope for the first release. Operator answers to the Stage 1.3 validation questions override that classification:

- The read gateway is **in-scope** for 0.5.0.
- It is a **mandatory** part of the tools provided to Build Engine workers (Class B).

The product contract will be amended in a follow-up change once the remaining Phase 1 decisions (Stage 1.4) are closed, or as part of Phase 2 documentation alignment. Until then, the Stage 1.1 contract’s Level-A boundary is understood to have been expanded by this decision.

## Closed decisions

| # | Decision | Summary |
|---|---|---|
| 0001 | Hosting | Cloudflare (Workers / on-demand). Operator-owned, single-tenant. |
| 0002 | Proxy reachability | Restricted to host(s) named in the approved work order. Same host constraint for write gateway; write path scope is submission-folder only. |
| 0003 | Link lifetimes | Default 24 h; hard max 72 h. Standard clock-skew tolerance; re-minting always permitted. |
| 0004 | Served prefixes | Configurable allow-list (project-specific). Universal deny list and normalisation. Commit SHA only; no moving refs. |
| 0005 | Class A access | Private raw URLs are sufficient. Strict separation of Class A and Class B trust paths. |

Full text of each closed decision is in `docs/decisions/0001`–`0005`.

## Object-storage variant

Per operator direction (validation question 27): the object-storage variant is **rejected**. All references and the `variants/object-storage/` tree are to be removed. This closeout records the decision; the mechanical deletion is included in the same change set.

## “Standard” items resolved by best practice

Where the operator answered “standard”, the following concrete values are adopted and documented in the decision files:

- Clock skew: small fixed tolerance (recommended ±120 s), documented and tested.
- Re-minting: always allowed; no artificial rate limit.
- Signing secret and repository credential: held only by the operator and the gateway secret store; never in source, never by agents.
- Per-order revocation: required; enforcement is immediate for subsequent requests (best-effort propagation latency under a few seconds for a single-instance Worker).
- Audit: every request produces one structured, redacted record; retention and query access are operator-controlled; no signatures, secrets or full payloads in logs.
- Residual risk of a leaked link: single file, single commit, until expiry or revocation — accepted.
- Error uniformity: unauthenticated callers receive a uniform 403; existence is never revealed before a valid signature.
- Production gateway must reproduce the reference signing vectors and the behavioural checks already proven by `gateway/read/reference`.

## Exit criteria for Stage 1.3

- [x] Decisions 0001–0005 closed with recorded answers and dates.
- [x] Object-storage variant rejected and removal initiated.
- [x] Scope change (read gateway in-scope for 0.5.0) recorded.
- [ ] Operator review and merge of this branch.
- [ ] Subsequent production implementation work may begin under Phase 4, subject to Phase 1 exit gate (including Stage 1.4).

## Next

Stage 1.4 — Resolve write gateway decisions before coding.
