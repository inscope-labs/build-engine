# Status of build-engine 0.5.0 (unreleased) — Basic, Class A-only

Audited commit: `main` at `28b04aa` (Stage 3.2 verifier hardening merged via PR #26), 2026-10-29. Evidence and the full defect list: `docs/release/DEFECT-REGISTER.md`.

**Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

**Conclusion.** 0.5.0 is redesignated **Basic, Class A-only** by operator decision D1 (2026-10-29). The consumer artifact (template, packaging, independent static verification, install/update) and the Class A workflow are the release scope. Deployed Class B read and write gateways are **unsupported in 0.5.0** and planned for **0.6.0 Standard**. Class B implementation work exists on unmerged branches (`phase-4/*`, `phase-5/*`); it is to be landed, not discarded. Only deployment, the pilot, and the submissions-transfer path are deferred.

**Basic blockers remaining (in order):**

1. Repository protection (branch and tag rules, required checks) is not configured (R0-004). Operator policy recorded 2026-10-29: require PR + `ci` on `main`, no force-push, deletions allowed; no `v*` tag restriction; apply **after** the `v0.5.0` tag is created.
2. Final operator authorization of the artifact and release notes at tag time (G-12) — pre-authorised 2026-10-29 pending gate pass.

**Closed for Basic (2026-10-29 decisions):**
- F0-002 — changelog dated `## 0.5.0 - 2026-10-29` with Basic scope statement.
- F0-023 — release workflow: CI success required for the tagged commit, tip-of-main tag check, SHA-pinned actions. (Permissions left as job-level `contents: write` per operator decision.)
- R0-011 — operator-side `cbridge upload` is the sole documented Class A delivery route; submissions-to-consumer transfer path deferred to 0.6.0; agent-side write gateway unsupported in 0.5.0.
- F0-020 — product contract redesignation (PR #27).

**Closed for Basic:** F0-010 and F0-016 (Stage 3.2 / PR #26); protocol field migration and set-version sync (Stage 1.2); allowlist packaging hardening (Stage 3.1); install/update transactional behaviour (Stage 2.4).

**Not Basic blockers (remain open for 0.6.0 Standard):** R0-005 (GET-mutation semantics), R0-007 (ephemeral staging / ambiguous retry), credential scope, audit leakage, gateway deployment, live conformance, Class B pilot.

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
- Read gateway (production) and write gateway: implementation exists on unmerged branches; **not deployed**; **unsupported in 0.5.0**; planned for 0.6.0.
- Conformance harness: exists on branches; live deployment conformance deferred to 0.6.0.

### Maintainer documentation

Product contract, STATUS, END-TO-END, README aligned to Basic redesignation. Defect register and requirement traceability to be updated to match.

### Consumer-flow tests

`tests/test_update.sh` and release self-tests implemented and passing on `main` after Stage 3.2.

---

## Gaps that currently prevent a Basic release

1. F0-002 — dated changelog entry (RC time only).
2. F0-023 — release workflow hardening.
3. R0-004 — repository branch/tag protection (operator/admin action).
4. R0-011 — Class A delivery route decision.
5. Final operator authorization of the artifact and release notes (G-12).

Class B deployment and pilot are **not** Basic release blockers.
