**Analysis conclusion.** The repository already contains substantial, testable implementation code (not merely scaffolding). The allowlist under `template/` is complete relative to `release/manifest.txt`; packaging and verification scripts are present and self-tested.  

A *successful published release candidate* is currently blocked by process/gating items rather than missing directories or allowlisted files. The principal blockers are:

1. `template/engine/ENGINE.json` previously had `"protocol": "UNSET"`; Stage 1.2 migrates the field to `protocol` = `build-engine/0.5`.
2. `CHANGELOG.md` still records `## 0.5.0 - unreleased` instead of a dated entry required by the release gate.
3. Read-gateway production port, write-gateway, conformance harness vectors, and pilot remain incomplete or scaffold-only (these never ship, so they do not block packaging of the current artifact, but they limit a fully operational end-to-end system).

> Stage 4.1 completed the conformance suite, Stage 4.2 implemented the production read gateway, which passes that suite, and Stage 4.3 added its deployment surface: three separated environments with a generated configuration, a deploy gate, the operational checks, an isolation proof and the operator runbook. **The read gateway is still not deployed** — no environment has been published. The write gateway and the pilot remain outstanding.

No allowlisted path under `template/` is missing. The three release-isolation layers (structure, allowlist, content inspection) are intact.

---

## Categorised, file-based overview

### 1. Root metadata and version control

| Path | Role |
|------|------|
| `VERSION` | Single source of truth: `0.5.0` |
| `CHANGELOG.md` | History; currently unreleased |
| `COMPATIBILITY.md` | Abstract-PROJECT mapping; currently `UNSET` |
| `README.md` | Maintainer-facing overview |
| `.gitignore` | Standard exclusions |
| `.github/workflows/ci.yml` | Push/PR: unit tests, shell syntax, release self-test, update-flow test, dry-run package+verify, read-gateway typecheck/unit/conformance/abuse/operational/isolation, write-gateway typecheck/bundle |
| `.github/workflows/deploy-read-gateway.yml` | Manual: the read gateway's deploy gate, and the publish job that waits for it, for a reviewer and for `main` |
| `.github/workflows/release.yml` | Tag-triggered: version/tag checks, tests, package, `--release` verify, publish assets |

### 2. Release machinery (`release/` — never shipped)

| Path | Role |
|------|------|
| `manifest.txt` | Allowlist (`managed` / `seed`) relative to `template/` |
| `forbidden.txt` | Path and content deny rules (gateway, credentials, Worker artefacts, etc.) |
| `package.sh` | Expand allowlist → stage → deterministic tarball + SHA-256 |
| `verify.sh` | Independent inspection of finished artefact (checksum, safety, allowlist, forbidden, version agreement, payload tests); `--release` gate |
| `set-version.sh` | Synchronise `VERSION`, `template/engine/VERSION`, `ENGINE.json` |
| `test-release.sh` | Self-test proving clean packaging succeeds and each failure mode is detected |

### 3. Shipped product (`template/` — maps 1:1 onto consumer root)

#### 3.1 Engine core (`template/engine/`)

| Path | Role |
|------|------|
| `ENGINE.json` | Machine metadata (`engine_version`, `protocol`) — managed |
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
| `gateway/read/reference/ctxgate.py` | Reference implementation (serve, revoke, audit) — built, tested, not deployable |
| `gateway/read/reference/test_ctxgate.py` | Reference tests |
| `gateway/read/production/` (a Cloudflare Worker: `src/`, `test/`, `ops/`, `wrangler.toml`) | Production port — implemented (Stage 4.2), proven against the shared conformance suite, with the deployment surface, the deploy gate, the operational checks and the operator runbook (Stage 4.3). **Not deployed**: no environment has been published, and the configuration still carries the operator's placeholders |

#### 4.2 Write gateway (Cloudflare Worker scaffold)

Extensive TypeScript tree under `gateway/write/` (src, tests, docs/adr, ci workflows, `wrangler.toml`, scripts, package files). Type-checked and bundle-checked in CI; not deployable; design questions remain open.

### 5. Conformance and variants (source-only)

| Path | Role / status |
|------|---------------|
| `conformance/README.md`, `behaviours.md` | Acceptance behaviours B1–B11 |
| `conformance/signing-vectors.json` | Complete: 17 valid vectors and 19 invalid inputs (Stage 4.1) |
| `conformance/harness/` | Implemented: a runner that drives any gateway over HTTP and any signer over a JSON-lines contract, plus a CI gate (Stage 4.1) |
| `conformance/SCHEME.md` | The normative description of the scheme (Stage 4.1, amended in Stage 4.2) |

### 6. Maintainer documentation (`docs/` — never shipped)

| Path | Role |
|------|------|
| `END-TO-END.md` | Stage status matrix |
| `ARCHITECTURE.md` | Two-repository model and isolation layers |
| `RELEASING.md` | Release procedure |
| `decisions/0001`–`0005` + README | All five decided (2026-10-26): hosting, proxy, lifetimes, prefixes, Class A access |
| `pilot/README.md` | Pilot acceptance (not started) |
| `proposals/context-export.md` | Historical proposal |

### 7. Consumer-flow tests (`tests/`)

| Path | Role |
|------|------|
| `tests/test_update.sh` | End-to-end install/update on a throwaway repository |

---

## Gaps that currently prevent a successful working release candidate

**Hard blockers for publishing (release gate):**

- `protocol` remains `UNSET` in `ENGINE.json`.
- `CHANGELOG.md` lacks a dated `## 0.5.0 - YYYY-MM-DD` entry.

**Structural completeness of the shippable payload:**  
None. Every path required by `release/manifest.txt` exists under `template/`. `package.sh` will succeed on a clean tree; ordinary `verify.sh` (without `--release`) will also succeed.

**Functional / operational gaps (do not block packaging of the current artefact, but limit a complete working system):**

- Production read gateway implemented, with its deployment surface, its deploy gate and its runbook (Stages 4.2 and 4.3), but **not deployed**: no environment has been published, and the operator's Cloudflare account, repository and host are still to be supplied.
- Write gateway is scaffold only.
- Conformance harness and the full signing-vector set are complete (Stage 4.1); the production port passes the suite (Stage 4.2).
- Pilot not started.
- Prose still Project-centric in places (machine configuration already uses placeholders).
- Repository settings (branch/tag protection) not managed from this repository.

Once the two hard blockers are resolved, the existing machinery can produce and publish a verified release artefact containing the engine, operator bridge, schemas, prompts, templates, and documentation listed above.
