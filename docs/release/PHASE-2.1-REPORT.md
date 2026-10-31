# Phase 2, Stage 2.1: metadata and documentation consistency

- Branch: `phase-2/2.1-metadata-docs`, based on `main` @ `121f2e4`
- Date: 2026-10-26
- Closes: register F0-019 (stale post-Stage-1.2 status text). Also corrects stale statements surfaced by Stages 1.3 and 1.4.

## Tasks

| Task | Result |
|---|---|
| 2.1.1 Synchronise version sources and compatibility metadata | Already consistent after Stage 1.2; verified: `VERSION`, `template/engine/VERSION` and `ENGINE.json.engine_version` are all `0.5.0`; `protocol` is `build-engine/0.5`; `COMPATIBILITY.md` agrees. No change needed. |
| 2.1.2 Changelog | **Deliberately not changed.** `## 0.5.0 - unreleased` stays until release-candidate time (Stage 7.1). |
| 2.1.3 Stale links, placeholders, contradictions, outdated examples | Corrected `README.md`, `docs/STATUS.md`, `docs/END-TO-END.md`, `docs/RELEASING.md`, `docs/ARCHITECTURE.md`, `docs/pilot/README.md`, and four gateway READMEs. Removed the object-storage variant rows (rejected in Stage 1.3). Replaced "abstract PROJECT" wording and the `UNSET` compatibility row. Relative-link check across all Markdown: 0 broken. |
| 2.1.4 Distinguish implemented / reference / scaffold / not deployed / unsupported | One legend of status words, used identically in `README.md`, `docs/STATUS.md`, `docs/END-TO-END.md`. The write gateway is described with its measured state (46 of 48 source files and 32 of 32 test files are stubs; Worker answers 501). |
| 2.1.5 Shipped docs must not imply an unavailable endpoint | `template/docs/CONTEXT-EXPORT.md` now states which parts ship, which are reference only and what is not available; its decisions section records Stage 1.3 outcomes instead of "decisions needed from you". `SETUP.md` section 6, `SECURITY.md`, `DECISIONS.md` A5 and `engine/AGENTS.md` say no gateway is deployed in this version. |

## Evidence

- `release/test-release.sh`: 22 passed, 0 failed. `tests/test_update.sh`: 22 passed, 0 failed.
- `release/package.sh` then `release/verify.sh`: `verify: OK (41 files, version 0.5.0)`. Shipped docs changed, and the content rules still pass.
- Shipped tool tests: 70 OK.
- Grep for the stale phrases in the register's F0-019 list and the Stage 1.3 supersessions returns nothing outside `docs/release/`, `CHANGELOG.md` and the release plan.

## Not done here, and why

- F0-013 (`ENGINE.json` / `engine.json` collision): waiting for the operator to name the new lowercase file. Docs reference `ENGINE.json` unchanged until then.
- Prose that still uses a single project as the worked example in `template/docs/`, `engine/AGENTS.md` and prompts remains a known gap (README gap 8); it is neutral-naming work for a later pass, not a status inconsistency.
