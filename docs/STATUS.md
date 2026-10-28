# Status of build-engine 0.5.0 (unreleased)

Audited commit: `main` after PR #6 (`121f2e4`), 2026-10-26. Evidence and the full defect list: `docs/release/DEFECT-REGISTER.md`.

**Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

**Conclusion.** The consumer artifact (template, packaging, verification, install/update) is implemented, tested and passing in CI, with hardening items open in Phases 2 and 3. The first release additionally requires the Class B read and write gateways, which are not complete, so **0.5.0 cannot be released yet**. Blockers, in order:

1. Production read gateway: not started (Phase 4). Conformance vectors are empty and the harness is not built (Phase 4.1).
2. Write gateway: the **core request and session lifecycle (Stage 5.2), the GitHub delivery (Stage 5.3), the audit, privacy and operations (Stage 5.4) and the real test suite and CI gates (Stage 5.5) are implemented** — routing, signature verification, the writer lease, sequencing and idempotent replay, quotas, the type policy, staging, the seal, the operator's revocation and closure, the hypermedia links and the redacted audit record, and a `commit` route that delivers to the provider: it validates the selection, checks that the branch is still at the head the capability names, writes only the selected files into the task folder, creates exactly one commit, records it, and makes the seal's precondition reachable. **362 tests pass** against the real Worker, the real Durable Object and the real provider client, driven against a mock GitHub that is an actual HTTP server on loopback. Stage 5.4 added the durable audit stream (one instance per order, queryable at `/admin/audit`, and rebuilt by the Durable Object that holds it so that a bug in the Worker cannot put a secret into the store), the sentinel-injection log-hygiene check (the same driver backs the unit test and the deploy gate), the operator runbook, and the deploy workflow — triggered by a push to `main` or by hand, with its credentials in a protected environment and a gate that fails if a pull-request-triggered workflow holds one. Stage 5.5 finished the suite (the two eviction tests, the adversarial inputs, the provider's status table, the bounded load test) and wired the gates: four on every pull request and three on a schedule, with a test that fails the build if a stub reappears or a test file falls out of the runner's glob. The deployment has never been run. The protocol contract is `ctxwrite-v1` (Stage 5.1). The gateway is **not deployed**, it has never been run against the real GitHub, and the Phase 5 exit gate is not met.
3. Submissions-to-consumer transfer path and pre-creation of the submissions branch and task folder: not designed and not in the plan (register R0-011).
4. End-to-end staging pilot: not started (Phase 6).
5. Repository protection (branch and tag rules, required checks) is not configured (register R0-004; Stage 3.3.7).
6. `CHANGELOG.md` still says `0.5.0 - unreleased`; the dated entry is written only at release-candidate time (Stage 2.1.2, 7.1).

Resolved: the compatibility field is `protocol` = `build-engine/0.5` in `template/engine/release.json` (Stage 1.2); version sources agree (`VERSION`, `template/engine/VERSION`, `release.json` all `0.5.0`); read-gateway decisions 0001 to 0005 and write-gateway decisions are recorded (Stages 1.3 and 1.4); the write-gateway protocol contract is specified as `ctxwrite-v1` (Stage 5.1). **Stage 1.1 product contract is APPROVED (2026-10-27)** with clarified Class A credential exception, managed/seed metadata names (`engine/engine.json` / `engine/release.json`), Supervisor-Agent transfer design (1.1.5), and environment acceptance matrix. Physical rename of template metadata files and code readers remains a Phase 2 task.

No allowlisted path under `template/` is missing. The three release-isolation layers (structure, allowlist, content inspection) are intact, with the verification gaps listed in the register (F0-010 to F0-012, F0-016, F0-023).

---

## Categorised, file-based overview

### 1. Root metadata and version control

| Path | Role |
|------|------|
| `VERSION` | Single source of truth: `0.5.0` |
| `CHANGELOG.md` | History; currently unreleased |
| `COMPATIBILITY.md` | Protocol compatibility table (`build-engine/0.5` for 0.5.0) |
| `README.md` | Maintainer-facing overview |
| `.gitignore` | Standard exclusions |
| `.github/workflows/ci.yml` | Push/PR: unit tests, shell syntax, release self-test, update-flow test, dry-run package+verify, write-gateway typecheck/bundle |
| `.github/workflows/release.yml` | Tag-triggered: version/tag checks, tests, package, `--release` verify, publish assets |

### 2. Release machinery (`release/` — never shipped)

| Path | Role |
|------|------|
| `manifest.txt` | Allowlist (`managed` / `seed`) relative to `template/` |
| `forbidden.txt` | Path and content deny rules (gateway, credentials, Worker artefacts, etc.) |
| `package.sh` | Expand allowlist → stage → deterministic tarball + SHA-256 |
| `verify.sh` | Independent inspection of finished artefact (checksum, safety, allowlist, forbidden, version agreement, payload tests); `--release` gate |
| `set-version.sh` | Synchronise `VERSION`, `template/engine/VERSION`, `release.json` |
| `test-release.sh` | Self-test proving clean packaging succeeds and each failure mode is detected |

### 3. Shipped product (`template/` — maps 1:1 onto consumer root)

#### 3.1 Engine core (`template/engine/`)

| Path | Role |
|------|------|
| `release.json` | Machine metadata (`engine_version`, `protocol`) — managed (was `ENGINE.json`; renamed for F0-013) |
| `VERSION` | Stamped version — managed |
| `engine.json` | Consumer configuration (placeholders) — **seed** (installed once, never overwritten) |
| `AGENTS.md` | Agent guidance |
| `bin/update.sh` | Install / update from release artefact (checksum, lock file, conflict handling) |
| `prompts/AGENT-SUPERVISOR-PROMPT.md` | Supervisor prompt |
| `prompts/AGENT-WORKER-PROMPT.md` | Worker prompt |
| `schemas/*.schema.json` | JSON Schema for plan, stages, task, order, submission, decisions, coverage_exempt |
| `templates/plan/` | Scaffold files (`plan.json`, `stages.json`, `decisions.json`, `coverage_exempt.json`, `AGENTS.md`, `tasks/.gitkeep`) |
| `tools/plan_tool.py` | Sole writer of plan state (plans, order, links, check, render, set, decide, verify, coverage, \ldots) |
| `tools/ctxlink.py` | Signed context-link minting (client side only) |
| `tools/unpack_blocks.py` | Utility |
| `tools/test_plan_tool.py` | Unit tests for plan tooling |
| `tools/test_ctxlink.py` | Unit tests / signing vectors for link scheme |

#### 3.2 Operator bridge (`template/operator/`)

| Path | Role |
|------|------|
| `cbridge` | Bash operator bridge (init, bootstrap, doctor, sync, upload, publish, reconcile, halt/resume) |
| `cbridge.config.example` | Configuration template |
| `install.sh` | Operator-side installer |
| `README.md` | Operator documentation |

#### 3.3 Documentation shipped to consumers (`template/docs/`)

| Path | Role |
|------|------|
| `CONTEXT-EXPORT.md` | Signed-link design, threat model, integration |
| `OVERVIEW.md`, `SETUP.md`, `OPERATOR-GUIDE.md`, `SECURITY.md`, `TASK-FORMAT.md`, `TEMPLATE.md`, `LOOP.md`, `GATES.md`, `DECISIONS.md` | Operational and process documentation |

#### 3.4 Plans entry point

| Path | Role |
|------|------|
| `plans/README.md` | Consumer plan directory contract (managed); actual plan data is consumer-owned |

### 4. Gateway (source-only — never packaged)

#### 4.1 Read gateway

| Path | Role / status |
|------|---------------|
| `gateway/README.md`, `gateway/read/README.md` | Orientation |
| `gateway/read/reference/ctxgate.py` | Reference implementation (serve, revoke, audit) — reference only: tested, not deployed |
| `gateway/read/reference/test_ctxgate.py` | Reference tests |
| `gateway/read/production/` (README + `ops/`, `rules/`, `source-adapter/` READMEs only) | Production port — not started; decisions 0001–0005 recorded; required for 0.5.0 |

#### 4.2 Write gateway (Cloudflare Worker scaffold)

Scaffold only. TypeScript tree under `gateway/write/` (src, tests, docs/adr, ci stubs, `wrangler.toml`, scripts, package files): 46 of 48 source files, all 32 test files, the 4 scripts and the 6 `ci/*.yml` files are stubs, and the Worker answers 501. Typecheck and bundle dry run pass in CI but prove nothing about behaviour. Required for 0.5.0 (Phase 5).

**The protocol contract is specified (Stage 5.1), the core is implemented (Stage 5.2), the delivery is implemented (Stage 5.3) and the audit, privacy and operations are implemented (Stage 5.4).** `gateway/write/docs/protocol.md` defines `ctxwrite-v1`: the capability format and signature, the routes and parameters, the response envelope, the session state machine, the quotas and type policy, the commit and seal contract, the credential boundary, and the recovery model. `docs/error-catalog.md` is the error authority, `src/config/quotas.json` and `src/config/type-policy.json` are the limit authorities, and `gateway/write/AGENTS.md` holds the stable agent-facing anchors.

Stage 5.2 implemented the core request and session lifecycle against that contract: the Worker routes and authenticates, the Durable Object holds the session, and the writer lease, the sequence numbers and chunk hashes, the idempotent replay, the quota ledger, the type policy, the path rules, the staging operations, the seal, the operator's revocation and closure, the hypermedia links, the audit record and the fail-closed environment validation all work.

Stage 5.3 implemented the delivery. The `commit` route no longer answers `501 not-implemented`: it validates the selection against the session, checks the branch head against the head the capability names, creates the commit's objects, moves the branch to them, and records the commit — and it does the last two inside the Durable Object, so that the commit's outcome and the state that records it change together. The provider's failures are mapped onto the gateway's own codes and the provider's body is never read; a delivery whose outcome is unknown is resolved by looking at the branch and answers `409 reconcile-required` rather than committing twice. The client has no method that could reach anywhere but the configured repository and branch, and the gateway never creates a repository, a branch or a folder. 222 tests pass against the real Worker, the real Durable Object and the real provider client, the last of them driven against a mock GitHub that is an actual HTTP server on loopback.

Stage 5.4 implemented the audit, the privacy and the operations. The audit record is built field by field from a fixed schema, and the durable copy of it is rebuilt by the Durable Object that holds it, through the same gate — so a bug in the Worker cannot put a capability into the store. The log-hygiene check plants a sentinel in every place a secret could be and drives the whole protocol with them in place, and the same driver backs the deploy gate. The operator runbook is written: minting, monitoring, revoking, closing, resetting a quota, reading the audit stream, rotating each of the three secrets, deploying, and four incident procedures.

What is not there: the remaining chaos suite and the CI wiring (Stage 5.5), the deployment itself and the pilot (Stage 6). The gateway is **not deployed**, it has never been run against the real GitHub, and no write-gateway capability is claimed as operational.

### 5. Conformance and variants (source-only)

| Path | Role / status |
|------|---------------|
| `conformance/README.md`, `behaviours.md` | Acceptance behaviours B1–B11 |
| `conformance/signing-vectors.json` | Empty vector set (stub); to be completed in Stage 4.1 |
| `conformance/harness/README.md` | Harness not yet implemented |

### 6. Maintainer documentation (`docs/` — never shipped)

| Path | Role |
|------|------|
| `END-TO-END.md` | Stage status matrix |
| `ARCHITECTURE.md` | Two-repository model and isolation layers |
| `RELEASING.md` | Release procedure |
| `decisions/0001`–`0005` + README | Decided read-gateway decisions (hosting, proxy, lifetimes, prefixes, Class A access) |
| `pilot/README.md` | Pilot acceptance (not started; Phase 6) |
| `proposals/context-export.md` | Historical proposal |

### 7. Consumer-flow tests (`tests/`)

| Path | Role |
|------|------|
| `tests/test_update.sh` | End-to-end install/update on a throwaway repository |

---

## Gaps that currently prevent a release

See the conclusion at the top of this file and `docs/release/DEFECT-REGISTER.md` (section F maps every finding to the plan stage that closes it).

**Structural completeness of the shippable payload:** none missing. Every path in `release/manifest.txt` exists under `template/`; `package.sh` succeeds on a clean tree and ordinary `verify.sh` passes. `verify.sh --release` fails only on the dated changelog entry, by design, until release-candidate time.
