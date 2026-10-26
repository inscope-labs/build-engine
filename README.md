# build-engine

Source of the **build-engine**: the plan/implementation system (plans, work orders, operator bridge, prompts)
that private `<project>-dev` repositories use to drive work into a public project. This repository is the one
place the engine is developed. Consumers (such as `inscope-labs/castiel-dev`) never copy from it by hand: they
install a **release artifact** with `engine/bin/update.sh`.

## Layout

| Path | Role | In a release? |
|---|---|---|
| `template/` | The product. Its contents map 1:1 onto a consumer repository root (`engine/`, `operator/`, `docs/`, `plans/README.md`). | yes, by allowlist only |
| `gateway/` | The signed-link context gateway (`ctxgate.py`) and its tests. | **never** |
| `release/` | Allowlist (`manifest.txt`), deny rules (`forbidden.txt`), `package.sh`, `verify.sh`, `set-version.sh`, self-test. | no |
| `tests/` | Consumer install/update flow test. | no |
| `docs/` | Maintainer docs (`ARCHITECTURE.md`, `RELEASING.md`) and `proposals/`. | no |
| `.github/workflows/` | `ci.yml` (every push/PR), `release.yml` (on a `vX.Y.Z` tag). | no |
| `VERSION`, `CHANGELOG.md`, `COMPATIBILITY.md` | One version, its history, and which abstract castiel version it implements. | no (the version is stamped into the artifact) |

## Common tasks

```
python3 -m unittest discover -s template/engine/tools     # shipped engine tests
python3 -m unittest discover -s gateway -p 'test_*.py'    # gateway tests (not shipped)
release/test-release.sh                                   # does the release pipeline catch what it must?
tests/test_update.sh                                      # install + update flow on a throwaway repo
release/package.sh && release/verify.sh dist/build-engine-v$(cat VERSION).tar.gz
```

Cutting a release: `docs/RELEASING.md`. Installing one into a consumer: the header of `template/engine/bin/update.sh`.

## Status

Set up from `inscope-labs/castiel-dev@88d77d5` (engine v0.4.0), now version 0.5.0 and **unreleased**.

Known gaps, in the order they matter:

1. `implements_abstract` is `UNSET`: a release build refuses to publish until the abstract castiel version is recorded.
2. The prose in `template/docs/`, `engine/AGENTS.md` and `engine/prompts/` is still written around Castiel as the worked
   example. Machine-read config (`engine.json`, `cbridge.config.example`, `install.sh`) is already placeholder-based.
3. GitHub settings are not configured from here: branch protection on `main`, tag protection for `v*`.
4. The gateway is a proof of concept; a production gateway is not built (see `template/docs/CONTEXT-EXPORT.md`).
