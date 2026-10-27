# Changelog

## 0.5.0 - unreleased
- Repository created as a product-agnostic engine extracted from an earlier scaffold. Nothing has been released from it yet.
- The context gateway (`ctxgate.py`) is split out of the engine and lives under `gateway/`, which is never packaged. What
  the engine needs (the link scheme and `mint`) ships as `engine/tools/ctxlink.py`. `plan_tool.py` imports it.
- `engine.json`, `cbridge.config.example` and `operator/install.sh` carry `OWNER/PROJECT` placeholders. `engine.json` is
  a seed file: installed once, never overwritten by an update.
- New: allowlist packaging, artifact verification, `engine/bin/update.sh`, CI and tag-triggered release workflows.
- Structure only (not shipped): `gateway/read/{reference,production}`, `conformance/`, `variants/object-storage/`,
  `docs/decisions/`, `docs/pilot/`, `docs/END-TO-END.md`.
- New (not shipped): `gateway/write`, the proposed Cloudflare write gateway for Class B agents, as a typechecked and
  bundle-checked scaffold; extra release deny rules for Worker files; a `write-gateway` CI job.
- Product neutrality: removed all project-specific (Castiel) references from shipped documentation, prompts, examples,
  and machine metadata. Compatibility field migrated from `implements_abstract` to `protocol` with value
  `build-engine/0.5`.
- Packaging is built from the tracked files under `template/` and refuses a dirty tree, a manifest line that is
  declared twice or under case folding, a symlink, a tracked generated file, and an output directory inside the
  packaged tree. The same commit builds byte-identical artifacts whatever the builder's umask is. The managed engine
  metadata was renamed from `engine/ENGINE.json` to `engine/release.json` (nothing has been released, so no consumer
  migration is needed).
- Verification is independent and static: `release/verify.sh` no longer runs the artifact's code. The payload's own
  test suite is a separate, explicit step (`--test-payload`) that the build side opts into. The verifier now refuses a
  checksum sidecar that describes another file, a duplicate archive member, a release manifest that contradicts
  itself, an allowlist that contradicts itself, and a gateway copy that has been renamed or indented. Paths are
  checked component by component, so a file name that contains two dots is no longer rejected.
