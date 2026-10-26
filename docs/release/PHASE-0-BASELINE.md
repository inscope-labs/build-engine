# Build Engine — Phase 0 Baseline Execution Record

- Date: 2026-10-26
- Source: `main` at `ee654cddeb9bd00043230942d89c8df955ea3afc`, VERSION `0.5.0`. This commit adds only `RELEASE-PLAN.md` over the earlier inspected `b45e8008adcaa179165abf24880e8eda0eb7c515` (verified with `git diff --stat`).
- Environment: Ubuntu 24 container, Python 3.12.3, Node v22.22.2, npm 10.9.7, fresh `git clone` (tags: none).
- Plan reference: Stage 0.1.3. Nothing was fixed before recording; working tree was clean after the run.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `python3 -m unittest discover -s template/engine/tools -v` | 0 | 70 tests OK |
| 2 | `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py' -v` | 0 | 15 tests OK |
| 3 | `release/test-release.sh` | 0 | 21 passed, 0 failed |
| 4 | `tests/test_update.sh` | 0 | 22 passed, 0 failed |
| 5 | `release/package.sh dist` | 0 | `dist/build-engine-v0.5.0.tar.gz` |
| 6 | `release/verify.sh dist/build-engine-v0.5.0.tar.gz` | 0 | `verify: OK (41 files, version 0.5.0)` |
| 7 | `(cd gateway/write && npm ci && npm run typecheck && npm run check:bundle)` | 0 | typecheck OK; bundle dry run completed |
| 8 | `release/verify.sh dist/build-engine-v0.5.0.tar.gz --release` | **1** | `ENGINE.json implements_abstract is UNSET` (expected; F0-001) |

Notes:
- Command 8 is an addition to the plan's list. Argument order matters: `--release` must follow the artifact (usage: `verify.sh ARTIFACT.tar.gz [--release]`).
- "Tests OK" for the write gateway means typecheck and bundle only. The handler still returns HTTP 501 (F0-004).
- The 12 manifest entries include directories (e.g. `engine/tools`, `operator`, `docs`), which expand to the 41 archive files; no discrepancy.
- Not covered here: branch/tag protection, required checks, Actions permissions (R0-004, needs admin access); archive adversarial cases (R0-002).
- CI run `actions/runs/40317887672` also passed but was for the earlier commit; re-check Actions for `ee654cd` and for this PR.
