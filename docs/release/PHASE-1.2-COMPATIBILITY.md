# Build Engine — Phase 1.2 Compatibility and Neutrality Decision

- Repository: https://github.com/inscope-labs/build-engine
- Branch: phase-1/compatibility-neutral
- Baseline: main @ a2f90fec327e75b14c70014bfcdec9ef6ad46166
- Date: 2026-10-26
- Status: **Implemented on this branch; submitted for review**

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
- `release/verify.sh` and `release/test-release.sh` accept the new field (with a temporary fallback read of the old key for safety during transition).
- `release/set-version.sh` comment updated.

### Castiel removal (1.2.5)

All occurrences of Castiel / castiel have been removed or generalised in:

- Shipped documentation under `template/docs/`
- Operator bridge and its README
- Agent prompts
- Root README, `docs/RELEASING.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/END-TO-END.md`
- Release tooling comments and self-test

Historical Phase 0 records (`docs/release/DEFECT-REGISTER.md`, baseline/closeout) retain their original evidence language for auditability; they are not part of the shipped artifact.

## Exit criteria for Stage 1.2

- [x] Product-neutral decision recorded.
- [x] Field migrated and value set.
- [x] VERSION / release.json (then ENGINE.json) / COMPATIBILITY.md / CHANGELOG synchronised.
- [x] Castiel references removed from current/shipped content.
- [ ] Operator review and merge of this branch.
- [ ] Subsequent CI green (package, verify, unit tests, update-flow).

After merge, F0-001 and F0-007 from the Phase 0 defect register are closed by this change (subject to CI confirmation).
