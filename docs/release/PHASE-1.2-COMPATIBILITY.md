# Build Engine — Phase 1.2 Compatibility and Neutrality Decision

- Repository: https://github.com/inscope-labs/build-engine
- Branch: phase-1/compatibility-neutral
- Baseline: main @ a2f90fec327e75b14c70014bfcdec9ef6ad46166
- Date: 2026-10-26
- Status: **Complete.** Merged in PR #3 (2026-10-26); conformance gaps closed by supplementary PR #25 (branch `phase-1.2/conformance-fixes`, 2026-10-28)
- Approval: developer-approved by John Wendell, 2026-10-28 (decision confirmed: product-neutral, `protocol = build-engine/0.5`, `implements_abstract` retired), in addition to the PR #3 merge

## Decision

Build Engine is **product-agnostic**. It is not tied to any external project or repository. All former references to “Castiel” (or `castiel`) are scaffold leftovers and have been removed from shipped content and current maintainer documentation.

### Compatibility identifier

- Field migration: `implements_abstract` → `protocol`
- Value for 0.5.0: `build-engine/0.5`
- Meaning: this engine release implements the Build Engine protocol version 0.5 (schemas, context-link scheme, plan/order tooling, operator bridge behaviour, and update semantics defined by this release).
- Consumers supply their own concrete repository configuration via the seed file `engine/engine.json` (placeholders `OWNER/PROJECT`).

### Rationale (Stage 1.2.1–1.2.3)

1.2.1 There is no external abstract framework. The only authoritative interface is the one defined by this repository.
1.2.2 The former Castiel naming is therefore incorrect and has been retired.
1.2.3 The field was renamed (not merely filled) so that readers, the release gate, tests, and documentation remain consistent and unambiguous.

### Synchronisation (1.2.4)

- `VERSION` / `template/engine/VERSION` remain `0.5.0` (no version bump required for this metadata change).
- `template/engine/release.json` (named `ENGINE.json` when this stage was done) now contains `"protocol": "build-engine/0.5"`.
- `COMPATIBILITY.md` rewritten for the neutral protocol model.
- `CHANGELOG.md` records the neutrality and field migration under the still-unreleased 0.5.0 section.
- `release/verify.sh` reads `protocol` only. The temporary fallback to the old key was removed in PR #25; `implements_abstract` is now rejected (see Supplementary conformance below).
- `release/set-version.sh` now synchronises `VERSION`, `template/engine/VERSION`, `release.json` (`engine_version` and `protocol`), the `COMPATIBILITY.md` row and the `CHANGELOG.md` heading (PR #25).

### Castiel removal (1.2.5)

All occurrences of Castiel / castiel have been removed or generalised in:

- Shipped documentation under `template/docs/`
- Operator bridge and its README
- Agent prompts
- Root README, `docs/RELEASING.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/END-TO-END.md`
- Release tooling comments and self-test
- `docs/proposals/context-export.md` (last reference removed in PR #25)

Historical Phase 0 records (`docs/release/DEFECT-REGISTER.md`, baseline/closeout) retain their original evidence language for auditability; they are not part of the shipped artifact.

## Supplementary conformance (PR #25)

A conformance review after PR #3 found these gaps; all are closed in PR #25.

1. CI on `main` was red at `5a8d06c`: `template/operator/install.sh` was committed as mode 100644, so the self-test found 2 of the expected 3 shipped executables. Restored to 0755.
2. The update-flow tests (`tests/test_update.sh`, `tests/test_update_hardening.sh`) built releases from copies without a `.git` directory, which Stage 3.1 packaging refuses. They had been hidden behind issue 1. They now build from committed git copies.
3. `verify.sh --release` only checked that `protocol` was non-empty. It now also requires the form `build-engine/<major>.<minor>`, equality with the major.minor of the release version, and a `COMPATIBILITY.md` row recording that engine version with that protocol.
4. The `implements_abstract` fallback in `verify.sh` was removed. `verify.sh` rejects a `release.json` that still carries the key, in every mode.
5. `set-version.sh` now updates `release.json`, the `COMPATIBILITY.md` row and the `CHANGELOG.md` heading (created when missing; idempotent).
6. Tests added to `release/test-release.sh`: retired key rejected (two cases), malformed protocol, protocol/version mismatch, missing and wrong `COMPATIBILITY.md` row, `set-version.sh` sync and idempotence, patch bump, and a `set-version.sh` version passing the release gate.
7. The word "abstract" was retired from `verify.sh` and `test-release.sh` in favour of "compatibility protocol version".
8. The `castiel` mention in `docs/proposals/context-export.md` was removed.
9. `docs/STATUS.md` was refreshed from observed results.

Historical audit records (`DEFECT-REGISTER.md`, this report, and the CHANGELOG line describing the neutrality change) still name Castiel as evidence of what was removed; they are not shipped.

## Exit criteria for Stage 1.2

- [x] Product-neutral decision recorded.
- [x] Field migrated and value set.
- [x] VERSION / release.json (then ENGINE.json) / COMPATIBILITY.md / CHANGELOG synchronised, and enforced by `verify.sh --release` and `set-version.sh`.
- [x] Castiel references removed from current/shipped content.
- [x] Developer review and approval (PR #3 merged 2026-10-26; decision re-approved 2026-10-28).
- [x] CI green (package, verify, unit tests, update-flow): CI run 40753977622 on PR #25 (`cb73ca3`) passed all jobs. Confirmation on `main` follows the merge of PR #25.

F0-001 and F0-007 from the Phase 0 defect register are closed by PR #3 and PR #25.
