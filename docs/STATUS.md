# Status of build-engine

**Latest published release:** 0.5.0 (released 2026-10-29) — **Basic, Class A-only**.
**Release being prepared:** 0.6.0 Standard — Class B read and write gateways, the pilot and the submissions-to-consumer transfer (ADR 0006).

Audited commit: `main` at `c95ae51`, tagged `v0.5.0`; published by `release.yml` run 40879890746 (all gates passed), 2026-10-29. **Updated 2026-11-07 (Stage BE-0)** to record ADR 0007's acceptance of R0-005 and R0-007, the closure of R0-013, the acceptance of R0-014, and the Phase 6 deployment results. Evidence and the full defect list: `docs/release/DEFECT-REGISTER.md`.

**Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

**Conclusion.** 0.5.0 is redesignated **Basic, Class A-only** by operator decision D1 (2026-10-29). The consumer artifact (template, packaging, independent static verification, install/update) and the Class A workflow are the release scope. Deployed Class B read and write gateways are **unsupported in 0.5.0** and planned for **0.6.0 Standard**. Class B implementation work (Stages 4.1 to 5.5) is in the source repository, not in the artifact. Only deployment, the pilot, and the submissions-transfer path are deferred.

**Class B read gateway (Stages 4.1 to 4.3).** The conformance suite, the production read gateway and its deployment surface (three separated environments with a generated configuration, a deploy gate, the operational checks and the operator runbook) are in the source repository, and the gateway passes the shared suite on the local runtime. It is **not deployed for production**: the operator's production repository and host are still to be supplied. It remains **unsupported in 0.5.0**.

**The staging deployment (Phase 6, 2026-11-01 to 2026-11-05).** A **disposable staging environment** exists for both gateways and has been exercised against the real provider. The staging read gateway (`ctxgate-read-staging.qnuralink.workers.dev`) and the staging write gateway (`ctxgate-write-staging.qnuralink.workers.dev`) are published, and the full signed Class B workflow ran against them on 2026-11-05: **44 checks passed** (read leg, write leg, revocation, and audit hygiene — see the register entry R0-013 for the run evidence). The production gateways are **not deployed**; that is BE-4 and BE-5, and the operator's production approval is required at run time.

**The 0.6.0 release claim is not made.** ADR 0006 decision 4 permits the wording "production ready, deployed, and supported" only when operator-console OC-1 to OC-8 and build-engine BE-4 to BE-7 have passed, staging has been deployed and piloted, the A03 Core device acceptance has passed, and production has been deployed and verified. **None of those conditions is met yet.**

**Basic blockers:** none. v0.5.0 is published (https://github.com/inscope-labs/build-engine/releases/tag/v0.5.0). Observed after publication: the checksum matches, `verify.sh --release` passes on the downloaded asset, and a clean consumer install and an idempotent re-run succeed from the asset alone. Asset SHA-256: `9fcc05d2beed8931978e44571fd7b62adf0aae4a6ccbaecf0fa57e053f1ddb96`.

**Repository protection (R0-004), applied 2026-10-29 after the tag:** `main` requires a pull request and the `test` check, force-push is blocked, deletion is allowed, administrators are not forced; no `v*` tag restriction; no Actions allow-list. The remaining exposure (no required reviews, administrators can bypass, no tag rules) is an accepted risk for 0.5.0 per the operator decision of 2026-10-29.

**Closed for Basic (2026-10-29 decisions):**
- F0-002 — changelog dated `## 0.5.0 - 2026-10-29` with Basic scope statement.
- F0-023 — release workflow: CI success required for the tagged commit, tip-of-main tag check, SHA-pinned actions. (Permissions left as job-level `contents: write` per operator decision.)
- R0-011 — operator-side `cbridge upload` is the sole documented Class A delivery route; submissions-to-consumer transfer path deferred to 0.6.0; agent-side write gateway unsupported in 0.5.0.
- F0-020 — product contract redesignation (PR #27).

**Closed for Basic:** F0-010 and F0-016 (Stage 3.2 / PR #26); protocol field migration and set-version sync (Stage 1.2); allowlist packaging hardening (Stage 3.1); install/update transactional behaviour (Stage 2.4).

**Not Basic blockers (remain open for 0.6.0 Standard):** credential scope, audit leakage, **production** gateway deployment, live conformance against a production deployment, and the cross-system Class B pilot with the Android console.

**Accepted residual risks (ADR 0007, 2026-11-02; operator's decision of 2026-11-07).** These are no longer open items. They are accepted **for staging and production**, with the conditions that stay mandatory and tested, and each is carried into 0.6.0 as an accepted risk rather than as a gap:

- **R0-005** — the GET-only design is retained; no-store and no-prefetch controls on the write route, log hygiene (query strings never retained, sentinel-secret tests in the suite), and disabled platform request logs and traces for the write gateway.
- **R0-007** — ephemeral staging and ambiguous commit outcomes are retained; ambiguity is resolved by operator reconcile. The recovery model is implemented and tested (`gateway/write/docs/protocol.md` §13).
- **R0-014** — the failure scenarios run against the local runtime plus the deployed no-secret probes. **The deployed gateways do not get a fault-injection switch.** The gap — the failure scenarios have never been run against a deployed Worker — is documented, not closed.

**Closed since the 0.5.0 release:** R0-013 (the deployed signed pilot ran and passed 44 checks on 2026-11-05).

Stage 1.1 product contract is **APPROVED with Basic redesignation (2026-10-29)**. See `docs/release/PHASE-1.1-PRODUCT-CONTRACT.md`.

No allowlisted path under `template/` is missing. The three release-isolation layers (structure, allowlist, content inspection) are intact. Independent verification is static-by-default (`--test-payload` opt-in).

---

## Scope classification

| Capability | 0.5.0 Basic | 0.6.0 Standard |
|---|---|---|
| Shipped template, plan/order tooling, `cbridge` | **Required** | Required |
| Allow-list packaging, deterministic tarball, checksum | **Required** | Required |
| Independent verification (static, non-executing) | **Required** | Required |
| Install / update without data loss, transactional | **Required** | Required |
| Class A workflow end-to-end | **Required** | Required |
| Operator-side `cbridge upload` delivery | **Required** if R0-011 resolved | Required |
| Deployed read gateway | **Unsupported** | Required |
| Deployed write gateway (agent-side submission) | **Unsupported** | Required |
| Remote revocation / audit | **Unsupported** | Required |
| Conformance harness against a live deployment | **Unsupported** | Required |
| End-to-end Class B pilot | **Unsupported** | Required |

---

## Categorised overview (summary)

### Release machinery (`release/` — never shipped)

Allowlist packaging, forbidden-content rules, deterministic tarball, independent static verification (Stage 3.2), `set-version.sh`, self-tests. Implemented and passing.

### Shipped product (`template/`)

Engine core, operator bridge (`cbridge`), consumer docs. Implemented. Shipped docs already state that no production gateway is deployed in this version.

### Gateways and conformance (source-only; not in artifact)

- Read gateway (reference): reference only, not deployed.
- Read gateway (production): implemented (Stage 4.2), with its deployment surface, deploy gate, operational checks and runbook (Stage 4.3); passes the shared conformance suite on the local runtime; **the staging deployment is live and was exercised on 2026-11-05**; **the production deployment is not published**; **unsupported in 0.5.0**; planned for 0.6.0.
- Write gateway: the protocol contract is specified as `ctxwrite-v1` (Stage 5.1, `gateway/write/docs/protocol.md`); the core request and session lifecycle (Stage 5.2), the GitHub delivery (Stage 5.3), the audit, privacy and operations (Stage 5.4) and the real test suite and CI gates (Stage 5.5) are implemented — **372 tests, all passing**; **the staging deployment is live and was exercised on 2026-11-05**; **the production deployment is not published**; **unsupported in 0.5.0**; planned for 0.6.0.
- Conformance harness: implemented (Stage 4.1) and run against the reference and production gateways locally (94 checks); live deployment conformance against a **production** deployment is deferred to 0.6.0 (BE-4).

### Maintainer documentation

Product contract, STATUS, END-TO-END, README aligned to Basic redesignation. Defect register and requirement traceability to be updated to match.

### Consumer-flow tests

`tests/test_update.sh` and release self-tests implemented and passing on `main` after Stage 3.2.

---

## Gaps that prevented the Basic release (all closed)

0.5.0 is published, so this list is a record of what stood between the repository and `v0.5.0`, not of
what stands in the way of anything today.

1. F0-002 — dated changelog entry. **Closed**: `## 0.5.0 - 2026-10-29`.
2. F0-023 — release workflow hardening. **Closed** in Stage 3.3 / PR #28.
3. R0-004 residual — required reviews, tag rules and Actions allow-list. **Accepted for 0.5.0**; the
   policy is ADR 0009 and it was applied on 2026-10-29. The residual exposure (no required reviews,
   administrators can bypass, no tag rules) is accepted; the operator decided in ADR 0009 not to tighten
   it further for 0.6.0.
4. R0-011 — Class A delivery route decision. **Resolved for Basic**: `cbridge upload` is the documented
   route; the transfer path is deferred to 0.6.0 (BE-6).
5. Final operator authorization of the artifact and release notes (G-12). **Given** — the operator
   published the release.

## What stands in the way of 0.6.0 Standard

1. The **production** gateways are not deployed (BE-4, BE-5), and every production deploy needs the
   operator's approval at run time.
2. The **cross-system pilot** with the Android console has not run (BE-7 and operator-console OC-8).
3. The **submissions-to-consumer transfer path** is not designed or built (BE-6).
4. The **protocol identifier** is still `build-engine/0.5`; 0.6.0 requires `build-engine/0.6`.
5. The **capability conformance gaps** — the read link is reusable until it expires, and the write root
   capability is a bearer credential — are open and need the operator's decision. See
   `docs/release/CAPABILITY-CONFORMANCE.md` §5.
6. The **compatibility record** does not exist yet; its schema is proposed in
   `docs/release/COMPATIBILITY-MATRIX.md` §3 and the validator is BE-8.

Class B deployment and pilot are **not** Basic release blockers.
