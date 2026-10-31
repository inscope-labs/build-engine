# Phase 3, Stage 3.1: validate allowlist packaging

- Branch: `phase-3/3.1-allowlist-packaging`, based on `main` @ `99a5a73` (after Stage 2.3)
- Date: 2026-10-27
- Closes: register F0-011, F0-012, F0-013 (packaging half), F0-018 (modes half)
- Raises and closes: F0-036 to F0-039 (found while auditing the packaging path; see the register, addendum A3)
- Scope note: this stage touches `release/package.sh` and the inputs of the artifact. `release/verify.sh` was changed
  only where the F0-013 rename forced it; the verifier's own hardening is Stage 3.2.

## Tasks

| Task | Result |
|---|---|
| 3.1.1 Audit every line in `release/manifest.txt` for existence, ownership mode and intended inclusion | Done - the line-by-line audit is below. All 12 lines resolve, each path has exactly one ownership mode, and the 12 lines together cover all 40 tracked files under `template/` exactly once. Nothing tracked in `template/` is unreachable by the allowlist, and nothing is shipped that the allowlist does not name. |
| 3.1.2 Reject duplicate paths, conflicting managed/seed declarations, absolute paths, traversal, symlinks, special files and unexpected generated files | Done, with evidence below. The manifest is validated before the expansion, so a bad line is refused by name and by line number. Two of these checks did not exist before (F0-036, F0-039) and one was dead code. |
| 3.1.3 Confirm the generated RELEASE-MANIFEST hashes every packaged file and matches the actual contents exactly | Done. The manifest is written from the staged tree and then checked back against it: the path sets are compared and the counts must agree, so the manifest can never describe a different set than the artifact holds. The self-test re-reads the manifest out of the finished artifact and re-hashes every file. |
| 3.1.4 Verify repeated builds from the same commit produce byte-identical archives and checksums | Done. The modes are normalised (0644, or 0755 when the git index says 100755), the mtime, owner, member order and gzip header are fixed. The same commit builds byte-identical artifacts under umask 022 and umask 002, and in a group-writable checkout. |
| 3.1.5 Ensure package output is not accidentally included in its own input or stale artifacts are not mistaken for current output | Done. An output directory inside `template/` is refused (F0-038), the previous artifact is removed before the build starts and the new one is moved into place only when it is complete, so a failed build leaves nothing that looks like an artifact (F0-037). |

## The allowlist, line by line (3.1.1)

| # | Mode | Path | Kind | Files | Shipped mode | Intended inclusion |
|---|------|------|------|-------|--------------|--------------------|
| 1 | managed | `engine/AGENTS.md` | file | 1 | 0644 | Agent guidance for the installed engine. Replaced on update. |
| 2 | managed | `engine/VERSION` | file | 1 | 0644 | The engine's version stamp. Replaced on update. |
| 3 | managed | `engine/release.json` | file | 1 | 0644 | Machine metadata (`engine_version`, `protocol`). Replaced on update. Was `engine/ENGINE.json` (F0-013). |
| 4 | managed | `engine/bin` | dir | 1 | 0755 | `engine/bin/update.sh`, the consumer's install/update path. |
| 5 | managed | `engine/prompts` | dir | 2 | 0644 | The supervisor and worker prompts. |
| 6 | managed | `engine/schemas` | dir | 7 | 0644 | The JSON schemas the plan tooling validates against. |
| 7 | managed | `engine/templates` | dir | 6 | 0644 | The plan templates, including the `tasks/.gitkeep` placeholder. |
| 8 | managed | `engine/tools` | dir | 5 | 0644 | The shipped Python tools and their tests. |
| 9 | seed | `engine/engine.json` | file | 1 | 0644 | The consumer's own configuration. Seeded once, never overwritten. |
| 10 | managed | `operator` | dir | 4 | 0644, 0755 x2 | The operator bridge: `cbridge` and `install.sh` (executable), the config example and the README. |
| 11 | managed | `docs` | dir | 10 | 0644 | The shipped documentation. |
| 12 | managed | `plans/README.md` | file | 1 | 0644 | The plans directory the consumer works in. |

40 files in total, each covered once. The only ownership question in the file is line 9: the seed is the consumer's
configuration and must never be replaced by an update - that is what `seed` means, and it is the reason line 3 could
not keep the name `engine/ENGINE.json`.

## What changed

- **`release/package.sh` (rewritten).** The artifact is now built from the tracked file list (`git ls-files`) rather
  than from `find`, and the build refuses to run on a dirty tree. The manifest is validated line by line before
  anything is expanded. Only regular files are packaged; a symlink, a special file or a tracked generated file is
  refused. The staged files get explicit modes, so the umask cannot reach the artifact. The output directory is
  checked against the packaged tree, and the artifact is written atomically.
- **`template/engine/ENGINE.json` → `template/engine/release.json`** (F0-013), with `release/manifest.txt`,
  `release/set-version.sh`, `release/verify.sh`, `release/test-release.sh`, `README.md`, `COMPATIBILITY.md`,
  `docs/ARCHITECTURE.md`, `docs/STATUS.md` and `docs/release/REQUIREMENT-TRACEABILITY.md` updated. The consumer's seed
  file `engine/engine.json` is untouched, so no consumer migration is needed.
- **`template/operator/install.sh`** is now tracked as 100755 and ships executable (F0-018).
- **`release/test-release.sh`** now runs inside a git checkout (a copy that is committed), because a release is built
  from a committed tree. Every test that plants something commits it, so the build reaches the gate the test is about
  instead of stopping at the dirty-tree gate. 22 checks became 42.
- **`tests/test_update.sh`** builds its two releases from a committed checkout, for the same reason.

## Evidence

Baseline: `main` @ `99a5a73`, unmodified. Every baseline claim below is an executed command, not a reading of the
source.

| # | Baseline behaviour (executed) | After Stage 3.1 |
|---|-------------------------------|------------------|
| E1 | A path declared both `managed` and `seed` built successfully; the release manifest listed it once, as `managed` (F0-036) | `package: manifest line 33: 'engine/VERSION' is declared as 'managed' and as 'seed' (a path may not be both managed and seed)`, exit 1 |
| E2 | With the file size capped, the build failed and left a 65536-byte `dist/build-engine-v0.5.0.tar.gz` behind (F0-037) | The failed build left `dist/` empty: `no artifact survives a failed build` |
| E3 | Building into `template/docs/dist` twice produced an artifact containing the previous artifact and its sidecar (F0-038) | `package: the output directory (...) is inside the packaged tree (...): the artifact would be packaged into itself`, exit 1 |
| E4 | An untracked `template/docs/.scratch-local.txt` was packaged, and `verify.sh` reported `OK (44 files)` (F0-011) | `package: the template tree and the manifest must be committed and clean: ?? template/docs/.scratch-local.txt`, exit 1 |
| E5 | The same commit built under umask 022 and under umask 002 produced two different SHA-256 values (F0-012) | Both produce `41299ce29ba463c17d85ca892189f67a733706d46d8afe65a6db00944d6e79a1` |
| E6 | A tracked `template/docs/junk.pyc` was silently dropped from a successful build (F0-039) | `package: 'docs/junk.pyc' is a generated or local file and must not be tracked in template/`, exit 1 |
| E7 | A manifest path with a `..` component was refused by the substring rule | Refused by component rule as well: `path 'engine/../engine/tools' has a '..' component` |
| E9 | The artifact contained both `engine/ENGINE.json` and `engine/engine.json` (F0-013) | The artifact contains `engine/release.json` and `engine/engine.json`: two distinct lowercase names |
| - | The artifact shipped `operator/install.sh` as 0644 (F0-018) | The three scripts ship 0755, every other file 0644; `files with any other mode: 0` |

Test suites, all run and inspected:

- `release/test-release.sh`: **42 passed, 0 failed** (was 22). The 20 new checks cover the untracked and modified
  tree, the duplicate / conflicting / case-folded declaration, the absolute path, the traversal component, the
  whitespace path, the unknown mode, the symlink, the tracked generated file, the tracked `node_modules` tree, the
  output directory inside the packaged tree, the failed-build residue, the umask and checkout-mode independence, the
  release-manifest completeness, the per-file hashes, and the shipped modes.
- `tests/test_update.sh`: **22 passed, 0 failed** (unchanged count; the two releases are now built from a committed
  checkout).
- `python3 -m unittest discover -s template/engine/tools`: 79 tests, OK.
- `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'`: 15 tests, OK.
- `release/package.sh dist` then `release/verify.sh dist/build-engine-v0.5.0.tar.gz`: `verify: OK
  (build-engine-v0.5.0.tar.gz: 41 files, version 0.5.0)`.

## Decisions the operator should confirm

- **The new name of the managed metadata file.** F0-013 needs a managed name that does not collide with the seed file
  under case folding. The Phase 1.1 product contract proposed `engine/release.json` and left the name "pending
  operator confirmation"; that proposal is what this stage implements, so the case-fold check in 3.1.2 could actually
  ship. If a different lowercase name is preferred, it is one line in `release/manifest.txt`, one `git mv` and the
  references listed above - nothing has been released, so the change is still cheap.
- **Packaging now needs a git checkout.** That is the direct consequence of F0-011's own resolution ("package from
  tracked files only (`git ls-files`) or refuse a dirty template tree"): both halves need git. A release built by hand
  from a source tarball is no longer possible, and a build from a dirty tree is refused rather than silently shipping
  the working tree. The release workflow and CI both package from a checkout, so neither is affected.

## Not done here, and why

- **F0-016 (the `..` substring rule) is left in place on purpose.** `release/package.sh` still refuses a path that
  contains `..` anywhere, not only as a path component, because `release/verify.sh` and `template/engine/bin/update.sh`
  apply the same substring rule. Relaxing it in one file would make the packaging pipeline produce an artifact that
  its own verifier refuses - the baseline behaviour documented in the register. The three files have to change
  together, which is Stage 3.2.2 with Stage 2.4's `update.sh`. The manifest path check now validates components
  individually, so the strict rule is the only one left and it is the one that will be relaxed.
- **F0-010 (the verifier executes the payload it verifies) is Stage 3.2.7**, not this stage.
- **F0-013's verification half is Stage 3.2.3**: `verify.sh` still compares artifact paths against the manifest with
  a literal match and does not yet check for case-folded duplicates.
- **F0-018's documentation half is Stage 2.1.3**: the operator README still tells the reader to `chmod +x` after
  downloading, which is no longer needed for `install.sh`.
- **R0-004 (no branch or tag protection) is untouched** - it is repository configuration, not code, and belongs to
  Stage 3.3.7.
- **Stage 3.4.1 (a negative test for every check) is not complete.** This stage added the negative tests for the
  packaging path it changed; the verifier's own checks still have the coverage they had.
