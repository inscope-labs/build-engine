# Changelog

## 0.5.0 - 2026-10-29
- **Basic — Class A only.** Supported environments: Linux and Termux/Android. No production gateway is deployed. Class B (read/write gateways, remote revocation/audit, pilot) is planned for 0.6.0 Standard.
- Operator-side `cbridge upload` is the documented delivery route for Class A deliverables. Agent-side submission through the write gateway is unsupported in this release. The submissions-to-consumer transfer path is deferred to 0.6.0 (R0-011).
- Repository created as a product-agnostic engine extracted from an earlier scaffold. First published as 0.5.0 on 2026-10-29.
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
- Stage 1.2 conformance: `release/verify.sh` rejects the retired `implements_abstract` key and, in `--release` mode,
  requires `protocol` of the form `build-engine/<major.minor>` matching the release version, with a matching
  `COMPATIBILITY.md` row. `release/set-version.sh` now also updates `release.json` (including `protocol`), the
  `COMPATIBILITY.md` row and the `CHANGELOG.md` heading. `template/operator/install.sh` is executable again (CI fix).
