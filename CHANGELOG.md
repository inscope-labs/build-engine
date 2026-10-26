# Changelog

## 0.5.0 - unreleased
- Repository created from `inscope-labs/castiel-dev@88d77d5` (engine v0.4.0). Nothing has been released from it yet.
- The context gateway (`ctxgate.py`) is split out of the engine and lives under `gateway/`, which is never packaged. What
  the engine needs (the link scheme and `mint`) ships as `engine/tools/ctxlink.py`. `plan_tool.py` imports it.
- `engine.json`, `cbridge.config.example` and `operator/install.sh` carry `OWNER/PROJECT` placeholders. `engine.json` is
  a seed file: installed once, never overwritten by an update.
- New: allowlist packaging, artifact verification, `engine/bin/update.sh`, CI and tag-triggered release workflows.
