# build-engine

**Operator-controlled build system** for driving planned work from private development repositories into public projects.

This repository is the single source of the build-engine: the plan/implementation system comprising plans, work orders, operator tooling, prompts, and related infrastructure. Private `<project>-dev` repositories (for example, `inscope-labs/PROJECT-dev`) consume verified **release artifacts**. Consumers never clone or copy from this repository by hand; they install or update via `engine/bin/update.sh`.

Current version: **0.5.0** (unreleased).

---

## Purpose

The engine enables an operator to:

1. Define and manage implementation plans.
2. Issue work orders that bind context (files at pinned commits) to tasks.
3. Mint short-lived, signed, read-only context links for agents that lack repository credentials (Class B agents).
4. Receive deliverables, publish them upstream, and reconcile state.
5. Audit fetches and revoke access when work completes.

Class A agents (authenticated git or curl) may bypass the gateway and read private raw URLs directly. Class B agents are limited to plain HTTPS GET and therefore rely on the signed-link gateway.

The design prioritises:

- No agent holds write credentials or repository tokens.
- Context remains in the private repository; nothing is copied to third-party storage in the recommended path.
- Links are short-lived, order-scoped, revocable, and audited.
- Releases are allowlisted, verified, and installed as an atomic managed set.

---

## Repository layout

| Path | Role | Included in release? |
|------|------|----------------------|
| `template/` | The product. Maps 1:1 onto a consumer repository root (`engine/`, `operator/`, `docs/`, `plans/README.md`). | Yes (allowlist only) |
| `gateway/` | Context gateways: `read/` (tested reference + planned production port) and `write/` (proposed Cloudflare Worker scaffold). | **Never** |
| `conformance/` | Language-neutral acceptance suite for the link scheme and any read gateway (signing vectors, behaviours B1–B11). | No |
| `variants/` | Documented alternatives not chosen (e.g. `object-storage/`). | No |
| `release/` | Allowlist (`manifest.txt`), deny rules (`forbidden.txt`), `package.sh`, `verify.sh`, `set-version.sh`, self-test. | No |
| `tests/` | Consumer install/update flow tests. | No |
| `docs/` | Maintainer documentation: `END-TO-END.md`, `ARCHITECTURE.md`, `RELEASING.md`, `decisions/`, `pilot/`, `proposals/`. | No |
| `.github/workflows/` | `ci.yml` (every push/PR), `release.yml` (on `vX.Y.Z` tag). | No |
| `VERSION`, `CHANGELOG.md`, `COMPATIBILITY.md` | Version, history, and abstract PROJECT compatibility. | Version is stamped into the artifact |

### Template contents (what ships)

- **`engine/`** — Core tooling (`plan_tool.py`, `ctxlink.py`, prompts, configuration, `bin/update.sh`).
- **`operator/`** — Operator bridge (`cbridge` for upload, publish, reconcile) and related scripts.
- **`docs/`** — Shipped documentation, including the context-export design.
- **`plans/`** — Plan templates and README (consumer-owned plan data lives outside the managed set).

---

## End-to-end flow

```
 operator                    read gateway               agent (Class B)           submission               upstream
 ----------                  ------------               ---------------           ----------               --------
 plan_tool order  --mint-->  (verifies link,   <--GET--  fetches context   --deliverable-->  operator: cbridge upload
 plan_tool links              serves one file)           per work order            or  write gateway (proposed)
 revoke / audit  ---------->  revocation, audit                                              |
                                                                                              v
                                                                               cbridge publish / reconcile -> public repo
```

| Stage | Component | Location | Status |
|-------|-----------|----------|--------|
| Plan and order | `plan_tool.py order`, work orders, plan templates | `template/engine/` | Built |
| Mint links | `ctxlink.py`, `plan_tool.py links` | `template/engine/tools/` | Built |
| Serve context | Read gateway (reference) | `gateway/read/reference/` | Built (proof of concept); not deployed |
| Serve context | Read gateway (production) | `gateway/read/production/` | Implemented (Cloudflare Worker, decisions 0001-0004 closed): passes the shared conformance suite over real HTTP. Stage 4.3 added the three environments, the deploy gate, the operational checks and the operator runbook. **Not deployed** |
| Acceptance | Signing vectors, behaviours B1–B11 | `conformance/` | Built: 17 valid + 19 invalid vectors, 53 executable cases, a runner and a CI gate (Stage 4.1) |
| Fallback read path | Object-storage variant | `variants/object-storage/` | Design only |
| Submit deliverables (operator) | `cbridge upload` | `template/operator/` | Built |
| Submit deliverables (agent) | Write gateway | `gateway/write/` | Scaffold; open design questions |
| Publish upstream | `cbridge publish`, `reconcile` | `template/operator/` | Built |
| Revoke and audit | `ctxgate.py revoke`, `audit`; the production operator channel | `gateway/read/reference/`, `gateway/read/production/` | Both: the production gateway revokes by order over an authenticated admin channel and keeps a bounded audit trail |
| Release and install | Package, verify, update | `release/`, `template/engine/bin/` | Built |
| Pilot | One real task end-to-end | `docs/pilot/` | Not started |

Full status and design notes: [`docs/END-TO-END.md`](docs/END-TO-END.md). Architecture and release isolation: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Context export (signed links)

Agents that can only perform plain HTTPS GET need access to private repository files without holding credentials. The recommended solution is a **signed context gateway**:

- The operator mints a short-lived, read-only link per file in a work order.
- A small gateway verifies the link, reads the single file at the pinned commit from the private repository, and returns it.
- No content is copied to third-party storage. Agents never hold a repository credential.
- Links expire (default 24 h), can be re-minted without altering the order file, can be revoked per order, and every fetch is audited.

Link format (v1):

```
{base}/v1/{kid}/{exp}/{order}/{sig}/{ref}/{path...}
```

The message authenticated by HMAC-SHA256 is:

```
ctxgate-v1\n{kid}\n{exp}\n{order}\n{ref}\n{path}
```

The shipped link scheme and minting logic live in `engine/tools/ctxlink.py`. The reference gateway implementation (`ctxgate.py`) remains in `gateway/read/reference/` and is never packaged. Detailed design, threat model, and refusal rules: `template/docs/CONTEXT-EXPORT.md`.

---

## Installation and updates (consumer side)

Consumers install a release artifact into their private `<project>-dev` repository. The updater:

- Verifies checksum and release manifest.
- Replaces **managed** files as a set (never hand-edited).
- Installs **seed** files (e.g. `engine/engine.json`) only when absent and never overwrites them.
- Removes files dropped by the new release (if unmodified).
- Records state in `.build-engine.lock`.
- Performs no commit; the consumer reviews the diff and opens a pull request.

### First install

```bash
gh release download vX.Y.Z -R OWNER/build-engine -D /tmp/be
tar -xzf /tmp/be/build-engine-vX.Y.Z.tar.gz -O engine/bin/update.sh > /tmp/update.sh
bash /tmp/update.sh --from-dir /tmp/be --version X.Y.Z --repo OWNER/build-engine
```

### Subsequent updates

```bash
engine/bin/update.sh --version X.Y.Z
# or, to use the latest:
engine/bin/update.sh
```

Useful options: `--dry-run`, `--force` (overwrite local conflicts), `--repo OWNER/build-engine`, `--from-dir DIR`.

Because this repository is private, authenticated `gh` access is required to fetch release assets.

---

## Development and common tasks

Run from a checkout of this repository:

```bash
# Shipped engine tests
python3 -m unittest discover -s template/engine/tools

# Read-gateway reference tests (not shipped)
python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'

# Release pipeline self-test
release/test-release.sh

# Consumer install/update flow on a throwaway repository
tests/test_update.sh

# Package and verify a release artifact
release/package.sh && release/verify.sh dist/build-engine-v$(cat VERSION).tar.gz
```

---

## Releasing

1. Branch from `main`. Make and test changes. Add any new shipping paths to `release/manifest.txt`.
2. Set the version: `release/set-version.sh X.Y.Z` (updates `VERSION`, `template/engine/VERSION`, and `template/engine/ENGINE.json`).
3. Record the abstract PROJECT version implemented: set `protocol` in `template/engine/ENGINE.json` and add a row to `COMPATIBILITY.md`.
4. Update `CHANGELOG.md` (replace the unreleased section with a dated entry).
5. Open a pull request; CI must pass (unit tests, release self-test, update-flow test, dry-run package + verify).
6. After merge: `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`.
7. The `release.yml` workflow verifies the tag against `VERSION` and `main`, re-runs tests, packages, runs `verify.sh --release`, and publishes `build-engine-vX.Y.Z.tar.gz` together with its `.sha256`. Any failure publishes nothing.
8. Consumers update with `engine/bin/update.sh --version X.Y.Z` on a branch and open a pull request.

Never edit or delete a published release asset; publish a new version instead. Full procedure: [`docs/RELEASING.md`](docs/RELEASING.md).

Release isolation is enforced by three independent layers:

1. **Structure** — `gateway/` sits outside `template/`; nothing under `template/` imports from it.
2. **Allowlist** — `release/package.sh` copies only paths listed in `release/manifest.txt`.
3. **Inspection** — `release/verify.sh` unpacks the artifact and fails on gateway-like paths, credential-shaped strings, non-allowlisted content, manifest/version mismatches, or payloads that fail their own tests.

---

## Compatibility

| Engine | Abstract PROJECT | Notes |
|--------|------------------|-------|
| 0.5.0 (unreleased) | UNSET | Must be recorded before the first release |

A release build (`release/verify.sh --release`) refuses to publish while `protocol` is missing or `UNSET`. See [`COMPATIBILITY.md`](COMPATIBILITY.md).

---

## Current status and known gaps

Version 0.5.0 is unreleased. Known gaps, ordered by priority:

1. `protocol` remains `UNSET`; a release build will refuse to publish until the abstract PROJECT version is recorded.
2. Prose in `template/docs/`, `engine/AGENTS.md`, and `engine/prompts/` still references Project as the worked example. Machine-readable configuration (`engine.json`, `cbridge.config.example`, `install.sh`) already uses placeholders.
3. GitHub repository settings (branch protection on `main`, tag protection for `v*`) are not configured from this repository.
4. The production read gateway is implemented and proven against the shared conformance suite, with its deployment surface, deploy gate and runbook, but **it has not been deployed**: no environment has been published. The write gateway (`gateway/write`) is still a scaffold. See `template/docs/CONTEXT-EXPORT.md`, `gateway/read/production/ops/runbook.md` and `gateway/write/README.md`.

---

## Documentation map

| Document | Audience | Content |
|----------|----------|---------|
| `docs/END-TO-END.md` | Maintainers | Stage-by-stage status of the full pipeline |
| `docs/ARCHITECTURE.md` | Maintainers | Two-repository model, release isolation, update semantics |
| `docs/RELEASING.md` | Maintainers | Release procedure |
| `docs/decisions/` | Maintainers | Open design decisions |
| `docs/pilot/` | Maintainers | Acceptance / pilot planning |
| `docs/proposals/` | Maintainers | Historical and alternative proposals |
| `template/docs/CONTEXT-EXPORT.md` | Consumers + maintainers | Signed-link design, threat model, integration |
| `template/engine/AGENTS.md` | Agents / operators | Agent guidance (currently Project-centric) |
| Header of `template/engine/bin/update.sh` | Consumers | Install/update contract |

---

## Licence and contribution

This repository is private. Contribution and licensing terms are governed by the owning organisation (`inscope-labs`). Contact the maintainers for access or contribution guidance.
