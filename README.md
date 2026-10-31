# build-engine

**Operator-controlled build system** for driving planned work from private development repositories into public projects.

This repository is the single source of the build-engine: the plan/implementation system comprising plans, work orders, operator tooling, prompts, and related infrastructure. Private `<project>-dev` repositories (for example, `inscope-labs/PROJECT-dev`) consume verified **release artifacts**. Consumers never clone or copy from this repository by hand; they install or update via `engine/bin/update.sh`.

Current version: **0.5.0** (unreleased) — **Basic, Class A-only** (operator redesignation 2026-10-29).

---

## Purpose

The engine enables an operator to:

1. Define and manage implementation plans.
2. Issue work orders that bind context (files at pinned commits) to tasks.
3. Mint short-lived, signed, read-only context links for agents that lack repository credentials (Class B agents).
4. Receive deliverables, publish them upstream, and reconcile state.
5. Audit fetches and revoke access when work completes.

Class A agents (authenticated git or curl) may bypass the gateway and read private raw URLs directly; this is the supported path in 0.5.0 Basic. Class B agents are limited to plain HTTPS GET and therefore rely on the signed-link gateway; **Class B is not supported in 0.5.0** and is planned for 0.6.0 Standard.

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
| `gateway/` | Context gateways: `read/` (reference implementation and production Cloudflare Worker, not deployed) and `write/` (implementation on branches). **Not included in 0.5.0 Basic**; planned for 0.6.0 Standard. Neither ships in the artifact. | **Never** |
| `conformance/` | Language-neutral acceptance suite for the link scheme and any read gateway (signing vectors, behaviours B1–B11). | No |
| `variants/` | Retired. Holds only a note that the object-storage variant was rejected (Stage 1.3). | No |
| `release/` | Allowlist (`manifest.txt`), deny rules (`forbidden.txt`), `package.sh`, `verify.sh`, `set-version.sh`, self-test. | No |
| `tests/` | Consumer install/update flow tests. | No |
| `docs/` | Maintainer documentation: `END-TO-END.md`, `ARCHITECTURE.md`, `RELEASING.md`, `decisions/`, `pilot/`, `proposals/`. | No |
| `.github/workflows/` | `ci.yml` (every push/PR), `release.yml` (on `vX.Y.Z` tag). | No |
| `VERSION`, `CHANGELOG.md`, `COMPATIBILITY.md` | Version, history, and the protocol compatibility identifier. | Version is stamped into the artifact |

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
 plan_tool links              serves one file)           per work order            or  write gateway (required, scaffold)
 revoke / audit  ---------->  revocation, audit                                              |
                                                                                              v
                                                                               cbridge publish / reconcile -> public repo
```

| Stage | Component | Location | Status |
|-------|-----------|----------|--------|
| Plan and order | `plan_tool.py order`, work orders, plan templates | `template/engine/` | Implemented |
| Mint links | `ctxlink.py`, `plan_tool.py links` | `template/engine/tools/` | Implemented |
| Serve context | Read gateway (reference) | `gateway/read/reference/` | Reference only; not deployed |
| Serve context | Read gateway (production) | `gateway/read/production/` | **Not included in 0.5.0**; planned for 0.6.0 Standard |
| Acceptance | Signing vectors, behaviours B1–B11 | `conformance/` | Behaviours written; vectors empty, harness not started |
| Submit deliverables (operator) | `cbridge upload` | `template/operator/` | Implemented |
| Submit deliverables (agent) | Write gateway | `gateway/write/` | **Not included in 0.5.0**; planned for 0.6.0 Standard |
| Publish upstream | `cbridge publish`, `reconcile` | `template/operator/` | Implemented |
| Revoke and audit | `ctxgate.py revoke`, `audit` | `gateway/read/reference/` only | Reference only; remote channel **not included in 0.5.0**; planned for 0.6.0 |
| Release and install | Package, verify, update | `release/`, `template/engine/bin/` | Implemented (hardening in progress) |
| Pilot | One real task end-to-end | `docs/pilot/` | Not started |

**Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

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
- Performs no commit, staging or push; the consumer reviews the diff and opens a pull request.
- Is **all or nothing**: new files are staged and every file about to change is backed up in `.build-engine.txn/` first. A
  failure restores the previous state; if the process is killed, the next run recovers automatically and says so.
- **Stops before touching anything** on a damaged lock or manifest, a locally edited or unrecorded managed file
  (conflict), an artifact whose contents are a different version than requested, a downgrade, and any path that goes
  through a symlink, a directory where a file belongs, or a file where a directory belongs.
- Refuses a release whose paths differ only by case when the filesystem ignores case.
- Requires **bash 4.4 or newer**, GNU coreutils (`sha256sum`), `tar`, `gzip`, `find` and `sed`; `gh` only to download.
  Supported on Linux and Termux. macOS's stock bash 3.2 is not supported.

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

Useful options: `--dry-run`, `--force` (overwrite local conflicts), `--allow-downgrade`, `--repo OWNER/build-engine`, `--from-dir DIR`.

If an update is interrupted, just run it again: it restores the previous state first. `--dry-run` refuses to run while an interrupted update is waiting to be recovered. If `.build-engine.lock` is damaged, restore it with `git checkout -- .build-engine.lock`, or delete it and re-run with `--force` to re-adopt the managed files, then review `git diff`.

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
2. Set the version: `release/set-version.sh X.Y.Z` (updates `VERSION`, `template/engine/VERSION`, and `template/engine/release.json`).
3. Confirm the protocol version this release implements: `protocol` in `template/engine/release.json`, with a matching row in `COMPATIBILITY.md`.
4. Update `CHANGELOG.md` (replace the unreleased section with a dated entry).
5. Open a pull request; CI must pass (unit tests, release self-test, update-flow test, dry-run package + verify).
6. After merge: `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`.
7. The `release.yml` workflow verifies the tag against `VERSION` and `main`, re-runs tests, packages, runs `verify.sh --release`, and publishes `build-engine-vX.Y.Z.tar.gz` together with its `.sha256`. Any failure publishes nothing.
8. Consumers update with `engine/bin/update.sh --version X.Y.Z` on a branch and open a pull request.

Never edit or delete a published release asset; publish a new version instead. Full procedure: [`docs/RELEASING.md`](docs/RELEASING.md).

Release isolation is enforced by three independent layers:

1. **Structure** — `gateway/` sits outside `template/`; nothing under `template/` imports from it.
2. **Allowlist** — `release/package.sh` copies only paths listed in `release/manifest.txt`, and only the files git
   tracks: an untracked or locally modified file under `template/` fails the build instead of being shipped.
3. **Inspection** — `release/verify.sh` unpacks the artifact and fails on gateway-like paths, credential-shaped strings, non-allowlisted content, manifest/version mismatches, or a payload that does not parse. It does **not** run the artifact's code: the payload's own test suite is a separate, explicit step (`--test-payload`) that the build side opts into and that whoever downloads an artifact never does.

---

## Compatibility

| Engine | Protocol | Notes |
|--------|----------|-------|
| 0.5.0 (unreleased) | build-engine/0.5 | Recorded in `template/engine/release.json` (`protocol`) |

A release build (`release/verify.sh --release`) refuses to publish while `protocol` is missing or `UNSET`. See [`COMPATIBILITY.md`](COMPATIBILITY.md).

---

## Current status and known gaps

Version 0.5.0 is unreleased and nothing has been published. The first release requires both Class B gateways, so it cannot be tagged until they exist and pass the staging pilot. Known gaps, ordered by priority; the complete list with evidence is `docs/release/DEFECT-REGISTER.md`:

1. The read gateway has a reference implementation only; the production port is not started (Phase 4).
2. The write gateway is a scaffold: its Worker answers 501 and all tests are empty stubs (Phase 5).
3. Conformance vectors are empty and the harness is not built (Phase 4).
4. No end-to-end pilot has run (Phase 6).
5. `CHANGELOG.md` still reads `0.5.0 - unreleased`; the dated entry is written at release-candidate time only.
6. GitHub branch protection on `main` and tag protection for `v*` are not configured; they are needed before any tag (Stage 3.3.7).
7. Release tooling and the updater have confirmed hardening items (reproducible archives, packaging from tracked files only, transactional update); see the register, Phases 2 and 3.
8. Prose in `template/docs/`, `engine/AGENTS.md`, and `engine/prompts/` still uses a worked example from one project. Machine-readable configuration already uses placeholders.

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
