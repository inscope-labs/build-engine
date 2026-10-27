# Phase 2, Stage 2.4: install and update hardening

- Branch: `phase-2/2.4-harden-install-update`
- Date: 2026-10-26
- Closes: F0-015, R0-009, R0-010, F0-040 to F0-045; closes the updater parts of F0-014 and F0-016; mitigates F0-013 (see register).

## Plan tasks

| Task | Result | Evidence in `tests/test_update_hardening.sh` |
|---|---|---|
| 2.4.1 First install into an empty repository | Works from the repo root or any subdirectory; `--root` for non-git directories; refuses outside git; `--dry-run` creates nothing; an unrecorded file at a managed path blocks the install | section "2.4.1" |
| 2.4.2 Update from the previous release: clean, modified, untracked, missing, newly introduced files | Clean files update; untracked consumer files survive; a locally deleted managed file is restored; a new managed file that exists locally is a conflict; re-running is a no-op | "2.4.2 / 2.4.6" |
| 2.4.3 Seed files only if absent, never overwritten | Edited seed kept across updates; seed new in a release created only when absent; deleted seed re-created | "2.4.3" |
| 2.4.4 Modified managed files are conflicts; no partial update unless `--force` | Conflict leaves the whole tree and the lock byte-identical; `--force` applies everything; a dropped file edited locally is a conflict | "2.4.4" |
| 2.4.5 Removed files, lock corruption, missing lock entries, checksum, wrong version, malformed manifests, interruption, recovery | 7 lock-damage variants, missing lock entry, missing/short/foreign checksum, unknown and mislabelled version, downgrade, 16 hostile manifest or archive cases, recovery paths | "2.4.5", "malformed manifests and hostile archives" |
| 2.4.6 Never commit, push, merge or alter consumer plan data | HEAD, index and branches unchanged; `plans/` data byte-identical after an update | "2.4.2 / 2.4.6" |
| 2.4.7 All-or-nothing | Staging, backup journal, atomic swaps, lock last, rollback on failure, automatic recovery after SIGKILL, concurrent-run protection | "2.4.7" |

## Behaviour changes operators will notice

- A downgrade now needs `--allow-downgrade`.
- A damaged `.build-engine.lock` stops the run with instructions instead of a shell error.
- Symlinks, a directory where a file belongs, and a file where a directory belongs are refused before any change, even with `--force`.
- The updater requires bash 4.4+ and says so clearly; macOS stock bash is not supported.
- After a hard kill, the next run reports `recovered from an interrupted update` and restores the previous state.

## Evidence

- `tests/test_update_hardening.sh`: 148 passed, 0 failed. Run against the previous `update.sh` the same suite failed 58 of 147 checks, which is where the register entries come from.
- `tests/test_update.sh` (which now also runs the hardening suite, so CI covers it without a workflow change): 22 original checks pass; one original check needed `--allow-downgrade`, because it asks for 0.5.0 while 0.5.1 is installed.
- `release/test-release.sh` 22/22; `release/package.sh` then `release/verify.sh`: OK (41 files); shellcheck: no warnings on `update.sh` or the tests; shipped tool tests and reference gateway tests pass.
- Test hooks in `update.sh` (`BUILD_ENGINE_TEST_INTERRUPT`, `BUILD_ENGINE_TEST_BASH_MAJOR`, `BUILD_ENGINE_TEST_CASE_INSENSITIVE`) only make a run stop earlier or refuse; they are documented in the script header.

## Not done here

- F0-013 rename: the operator has not yet named the new lowercase file. The updater already prevents silent overwrite on case-insensitive filesystems.
- `release/package.sh` GNU `tar` dependency and `verify.sh` path checks: Phase 3.
- Not exercised on a real Termux device or on bash 4.4 specifically; CI runs one bash version (R0-016).
- `CHANGELOG.md` untouched (release-candidate time).
