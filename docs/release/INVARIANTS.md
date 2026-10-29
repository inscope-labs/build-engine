# Build Engine 0.5.0 Basic: invariant registry

- Scope: the load-bearing components of the 0.5.0 **Basic, Class A-only** release
- Derived at: branch `docs/0.5.0-invariant-registry`, stacked on PR #26 (`phase-3/3.2-harden-verification-resolved`, merge commit `9b4ab35` over `main` @ `c180a88`)
- Date: 2026-10-28
- Status: **Draft for operator review.** Statuses record what was observed, not what is intended.

## 1. What this is

An invariant is a statement that must hold for 0.5.0 to be safe to ship and to install. Each entry names the **mechanism** that enforces it and the **evidence** that the mechanism works, so a reader can tell a property that is guarded by a failing test from one that merely appears in a document. It is the registry that the release gate, a future change review and the 0.6.0 plan should be checked against.

Not in scope: Class B (read gateway, write gateway, conformance harness, deployment, pilot). Those invariants belong to the 0.6.0 Standard registry. Where a Class B surface touches the Basic payload (SCP-08, PIP-07) it is recorded here.

## 2. Method and limits

- Built by reading the code that enforces each property: `release/package.sh`, `verify.sh`, `set-version.sh`, `template/engine/bin/update.sh`, `template/operator/cbridge`, `template/engine/tools/plan_tool.py` and `ctxlink.py`, the two workflows, the shipped docs and the decision records. Evidence names are test names from `release/test-release.sh`, `tests/test_update_hardening.sh` and the plan-tool unit tests.
- Executed on the merged tree at `9b4ab35`: `release/test-release.sh` 94 passed, 0 failed; `tests/test_update.sh` 150 + 22 passed, 0 failed; `package.sh` 41 files (42 archive entries); `verify.sh --test-payload` OK; `verify.sh --release` fails only on the undated changelog (intended, decision Q7). `tests/test_cbridge.sh` was run standalone: 28 passed, 8 failed, all eight because `jq` is missing in this sandbox.
- Test names were matched by reading them; not every test body was read. A status of ENFORCED means a mechanism exists and a test in a **gated** suite (run by `ci.yml` and `release.yml`) asserts it.
- Defect ids follow the register. The Stage 3.2 verifier findings were renumbered F0-065..F0-069 in PR #26 because F0-040..F0-045 were already used on `main`.

### Status legend

| Status | Meaning |
|---|---|
| ENFORCED | A mechanism exists and a gated test asserts it. |
| ENFORCED-UNGATED | A mechanism and a test exist, but no workflow runs the test. |
| MECHANISM-ONLY | A mechanism exists; no test asserting it was found. |
| CONVENTION | A rule held by process or documentation; no mechanism. |
| LIMITATION | A known, documented limitation, accepted or awaiting a decision. |
| GAP | Required for Basic and not currently holding or not enforced. Action needed. |

## 3. Summary

| Category | ENFORCED | ENFORCED-UNGATED | MECHANISM-ONLY | CONVENTION | LIMITATION | GAP | Total |
|---|---|---|---|---|---|---|---|
| SCP Release scope and isolation | 7 | 0 | 0 | 0 | 0 | 1 | 8 |
| INT Artifact integrity and determinism | 5 | 0 | 0 | 0 | 2 | 0 | 7 |
| PTH Path and name safety | 1 | 1 | 0 | 1 | 0 | 0 | 3 |
| VER Verification model | 5 | 0 | 1 | 0 | 0 | 0 | 6 |
| VRS Version and compatibility | 2 | 0 | 0 | 2 | 0 | 0 | 4 |
| UPD Consumer install and update | 8 | 0 | 1 | 0 | 0 | 0 | 9 |
| BRG Operator bridge (Class A) | 0 | 6 | 0 | 2 | 0 | 2 | 10 |
| PLN Plan and order tooling | 9 | 0 | 1 | 0 | 0 | 0 | 10 |
| SEC Security boundaries and honest scope | 1 | 1 | 0 | 1 | 2 | 1 | 6 |
| PIP Release pipeline | 1 | 0 | 4 | 1 | 1 | 2 | 9 |
| GOV Governance and operator authority | 1 | 0 | 0 | 3 | 1 | 1 | 6 |
| DOC Documentation truth | 0 | 0 | 0 | 2 | 0 | 2 | 4 |
| **All** | **40** | **8** | **7** | **12** | **6** | **9** | **82** |

## 4. Gaps and decisions that block or shape the release

Lists every GAP, LIMITATION and CONVENTION entry. GAP items need action before or alongside 0.5.0; LIMITATION and CONVENTION items need a recorded decision or an accepted risk. The eight ENFORCED-UNGATED entries are all resolved by one action (BRG-09, wire the bridge suite into the workflows). MECHANISM-ONLY entries are flagged in their own sections.

| ID | Status | What is missing | Needed |
|---|---|---|---|
| SCP-08 | GAP | `template/docs/CONTEXT-EXPORT.md` declares the link scheme, `ctxlink.py` and the `plan_tool.py` integration 'implemented and shipped'. Minting is unit-tested when configured (`test_plan_tool*.py`, `test_ctxlink.py`). No gate asserts that the shipped seed default is empty. | Operator decision: keep minting in Basic (inert by default) or remove it; add a gate asserting `gateway.base`/`gateway_template` are empty in the seed. |
| INT-06 | LIMITATION | Documented in the defect register (F0-017). Must be stated in the release notes (decision Q8). | State in the release notes (decision Q8). |
| INT-07 | LIMITATION | Documented flow in `update.sh` header. Not in the defect register as a distinct finding. | State in the release notes; consider a verify step in the documented bootstrap. |
| PTH-02 | CONVENTION | No cross-implementation equivalence test. | Optional: one cross-implementation equivalence test. |
| VRS-03 | CONVENTION | Format and match tested (VER-05). The 0.6.0 identifier is an open decision. | Decide the 0.6.0 protocol identifier at 0.6.0 planning (D6). |
| VRS-04 | CONVENTION | Verified 2026-10-28 and again at 9b4ab35: 0 tags on origin. | Operator discipline; protection is GOV-01. |
| BRG-01 | CONVENTION | Documented; not mechanically testable from this repo. |  |
| BRG-02 | GAP | `tests/test_cbridge.sh` runs with `CBRIDGE_NO_GH` set, which skips the check by design. Two weaknesses: the bypass is an environment variable in shipped production code, and the check itself is not exercised end to end. | Decide whether the `CBRIDGE_NO_GH` privacy-check bypass stays in shipped code; test the real check end to end. |
| BRG-09 | GAP | Executed at 9b4ab35 in a sandbox without `jq`: 28 passed, 8 failed (all eight are `jq` missing). Not executed in full. GitHub-hosted runners include `jq`, so wiring it in would be expected to pass; that is unproven. | Wire `tests/test_cbridge.sh` into `ci.yml` and `release.yml` (runners have `jq`). |
| BRG-10 | CONVENTION | Documentation alignment pending (README, STATUS, END-TO-END). | Document the route in README/STATUS/END-TO-END. |
| SEC-01 | CONVENTION | Documented. |  |
| SEC-04 | LIMITATION | Documented in `docs/SECURITY.md`. | None; documented. |
| SEC-05 | LIMITATION | Documented limitation; see BRG-08 and GOV-01. | None; documented. |
| SEC-06 | GAP | `SETUP.md` section 6, `SECURITY.md`, `CONTEXT-EXPORT.md`, `engine/AGENTS.md` are Class-A-safe. `AGENT-WORKER-PROMPT.md` still offers 'your HTTPS GET gateway if the order lists gateway URLs' as a live option. No test asserts this invariant. | Edit `AGENT-WORKER-PROMPT.md` (approved, decision Q9). |
| PIP-04 | GAP | Open defect F0-023. | F0-023: make publication depend on `ci` passing. |
| PIP-05 | GAP | Open defect F0-023. | F0-023: narrow `contents: write` to the publish step, pin actions to SHAs, require the tag at the tip of `main`. |
| PIP-07 | LIMITATION | Workflow YAML. A coupling to record: either accept it or scope the Basic release job to shipped code. | Accept the coupling, or scope the Basic release job to shipped code. |
| PIP-09 | CONVENTION | Observed repeatedly in Stage 5.5 and #18 history. |  |
| GOV-01 | LIMITATION | `branches/main/protection` returned 404 on 2026-10-28. By decision Q10 this is skipped for 0.5.0 and accepted as an open risk, to be recorded in writing in the register. | Record the accepted risk in writing in the register (decision Q10). |
| GOV-02 | CONVENTION | Process. |  |
| GOV-04 | CONVENTION | Documentation alignment pending (README, STATUS, END-TO-END, `PHASE-1.1-PRODUCT-CONTRACT.md` amendment). | Complete the documentation alignment (DOC-01, DOC-02). |
| GOV-05 | CONVENTION | This registry's own status column applies it. |  |
| GOV-06 | GAP | No check. A one-line duplicate-heading check would close it. | Add a duplicate-heading check on the defect register. |
| DOC-01 | GAP | Verified at 9b4ab35: `README.md` lines 72, 75 and 77 still say the production read gateway, the write gateway and remote revoke/audit are 'required for 0.5.0'; `docs/STATUS.md` and `docs/END-TO-END.md` still describe the gateways as scaffold/not started without a Basic deferral. | Doc pass on README, STATUS, END-TO-END. |
| DOC-02 | GAP | Decision given 2026-10-28 (Q1); amendment not yet written into the contract. | Write the dated operator decision into the product contract. |
| DOC-03 | CONVENTION | Notes extraction fails if there is no entry. |  |
| DOC-04 | CONVENTION | Shipped docs are accurate (SEC-06 lists the one exception). |  |

## 5. Release scope and isolation (SCP)

What may and may not enter the 0.5.0 artifact. The Basic boundary: Class A only; no Class B service.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| SCP-01 | Only tracked files covered by `release/manifest.txt` enter the artifact; anything not listed is excluded by default. | `package.sh` (tracked-file list, manifest expansion); `verify.sh` step 6 ('not allowlisted'). | `release/test-release.sh`: 'clean tree packages', 'a variants tree is caught' | ENFORCED | G-09 |
| SCP-02 | `release/forbidden.txt` is an independent second layer: a file the allowlist permits is still refused if a forbidden path/content rule matches. | `verify.sh` step 7. | `release/test-release.sh`: 'a variants tree is caught even when the allowlist allows it', 'a conformance tree is caught even when the allowlist allows it' | ENFORCED | G-09 |
| SCP-03 | No gateway service code, conformance tree, variants tree, Worker config (`wrangler.toml`, `.dev.vars`), `node_modules` or key material is in the artifact, including renamed, indented or binary-embedded copies. | `forbidden.txt` path rules + content rules (matched with `grep -a`). | `release/test-release.sh`: 'clean artifact has no gateway file', 'an indented copy of the gateway code is caught', 'a copy of the gateway entry point is caught', 'a renamed copy of the conformance vectors is caught', 'a credential in a binary file is caught'. Archive scan at 9b4ab35: 0 matches over 42 entries. | ENFORCED | G-09, F0-042 (now F0-067) |
| SCP-04 | A dirty or partly untracked `template/` (or modified manifest) refuses to package; the artifact never reflects whatever the working tree happens to hold. | `package.sh` porcelain check + `git ls-files -s` as the only file source. | `release/test-release.sh`: 'an untracked file in template/ stops packaging', 'a locally modified file stops packaging', 'a dirty tree stops the build' | ENFORCED | G-01, F0-036..F0-039 |
| SCP-05 | Only regular files are packaged; symlinks, devices, fifos and directory entries are refused at build and at verification. | `package.sh` per-file checks; `verify.sh` step 3. | `release/test-release.sh`: 'symlink stops packaging', 'an archive with a symlink/hardlink/fifo/device/directory entry is refused' | ENFORCED |  |
| SCP-06 | Generated or local files (`__pycache__`, `.pyc`, `node_modules`, `.env*`, key/token files, archives, `.git`, editor droppings) may not be tracked in `template/`; they are refused, not silently dropped. | `package.sh` `is_generated`; `forbidden.txt`. | `release/test-release.sh`: 'a tracked generated file stops packaging', 'a tracked node_modules tree stops packaging' | ENFORCED | F0-039 (3.1) |
| SCP-07 | The artifact ships exactly three executables (`operator/cbridge`, `operator/install.sh`, `engine/bin/update.sh`); every other file is mode 0644. | `package.sh` mode normalisation (git index mode 100755 only); `verify.sh` step 3 mode whitelist. | `release/test-release.sh`: 'the artifact ships exactly the three executables', 'every packaged file ships 0644 or 0755' | ENFORCED | F0-018 |
| SCP-08 | Class B service code is absent, but Class B client-side link minting is present by design: `engine/tools/ctxlink.py` ships in every release and `plan_tool.py` can mint signed links when `context.gateway.base` or `gateway_template` is set. It must be inert by default. | Seed `engine.json` ships `gateway.base` and `gateway_template` empty; `with_gateway()` returns the order unchanged when both are empty. | `template/docs/CONTEXT-EXPORT.md` declares the link scheme, `ctxlink.py` and the `plan_tool.py` integration 'implemented and shipped'. Minting is unit-tested when configured (`test_plan_tool*.py`, `test_ctxlink.py`). No gate asserts that the shipped seed default is empty. | GAP | Decision needed: confirm minting stays in Basic (ships, undeployed) or is removed. Add a gate asserting the empty default. |

## 6. Artifact integrity and determinism (INT)

The artifact is exactly what the commit says it is, and says so verifiably.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| INT-01 | The same commit builds byte-identical artifacts regardless of umask, checkout modes or builder. | `package.sh`: sorted file list, fixed mtime/owner, `gzip -n`, explicit modes. | `release/test-release.sh`: 'packaging is reproducible', 'a group-writable checkout builds the same bytes', 'a different umask builds the same bytes' | ENFORCED | G-11 |
| INT-02 | The `.sha256` sidecar holds exactly one line, names the artifact it accompanies, and matches it. | `verify.sh` step 1; `update.sh` checksum check. | `release/test-release.sh`: 'a missing checksum sidecar is refused', 'a sidecar that describes another file is refused', 'a tampered artifact fails its checksum'; `tests/test_update_hardening.sh`: 'checksum file naming another file is refused' | ENFORCED | F0-040 (now F0-065) |
| INT-03 | `engine/RELEASE-MANIFEST` lists every packaged file exactly once with a 64-hex sha256 and a `managed\|seed` mode, and nothing else; it carries the artifact's version in its header. | `package.sh` generation + path-set cross-check; `verify.sh` step 8 and 9. | `release/test-release.sh`: 'the release manifest lists every packaged file', 'every release manifest hash matches the packaged file', and the duplicate / malformed hash / bad mode / unexpected field / missing file / no header refusals | ENFORCED | F0-043 (now F0-068) |
| INT-04 | A failed build never leaves a file that looks like a finished artifact; output is written atomically and the previous output is removed first. | `package.sh` temp file + `mv`, early `rm -f`. | `release/test-release.sh`: 'a failed build leaves no artifact behind', 'an output directory inside the packaged tree is refused' | ENFORCED | F0-037, F0-038 |
| INT-05 | No two paths in the allowlist, the archive or the release manifest are equal under case folding; the artifact installs on a case-insensitive filesystem. | `package.sh`, `verify.sh` (allowlist, archive, manifest), `update.sh` (case-insensitive FS refusal). | `release/test-release.sh`: 'a case-folded duplicate is refused', 'an allowlist with a case-folded duplicate is refused'; `tests/test_update_hardening.sh`: 'the real release has no case-colliding paths...' | ENFORCED | F0-013 |
| INT-06 | The checksum sidecar proves integrity only, not publisher authenticity: anyone who can replace the tarball can replace the sidecar. No signature or attestation exists. | None (by design for 0.5.0). | Documented in the defect register (F0-017). Must be stated in the release notes (decision Q8). | LIMITATION | F0-017 |
| INT-07 | First install is trust-on-first-use: the documented bootstrap extracts `update.sh` from the artifact and runs it before any checksum has been checked; the checksum is then verified by that same code. | None. `update.sh` then verifies the checksum and manifest before touching the repository. | Documented flow in `update.sh` header. Not in the defect register as a distinct finding. | LIMITATION | F0-017 (related) |

## 7. Path and name safety (PTH)

One rule, three implementations. A path is safe when relative and every component is a plain name.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| PTH-01 | A path is refused if it is absolute, has an empty, `.` or `..` component, or contains a backslash (archive members) or whitespace (manifest lines). A name that merely contains two dots (`notes..v2.md`) is accepted. | Component-wise check in `package.sh`, `verify.sh` (`safe_component_path`) and `update.sh` (`safe_path`, which additionally restricts the character set). | `release/test-release.sh`: traversal, dot, empty-component, backslash and 'two dots' tests; `tests/test_update_hardening.sh`: 'manifest/archive: parent traversal', 'dot component', 'absolute path', 'backslash path' | ENFORCED | F0-016 |
| PTH-02 | The three implementations stay equivalent. The comments say 'keep in step'; nothing compares them mechanically. | Review discipline and the per-script tests above. | No cross-implementation equivalence test. | CONVENTION | F0-016, G-11 |
| PTH-03 | `cbridge upload` refuses a zip whose listing contains an absolute path or any `..` substring; this is a stricter, substring rule than PTH-01. | `cbridge` `cmd_upload`. | `tests/test_cbridge.sh`: 'zip with .. paths rejected' (not gated, see BRG-09). | ENFORCED-UNGATED | Intentionally stricter; would reject `a..b` names inside submissions. |

## 8. Verification model (VER)

Independent, static, fail-closed verification of a finished artifact.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| VER-01 | By default `verify.sh` never executes code from the artifact. Running the payload's own tests is an explicit opt-in (`--test-payload`) used only by jobs that built the artifact themselves. | `verify.sh` step 11; `ci.yml` and `release.yml` pass `--test-payload`. | `release/test-release.sh`: 'verification does not execute the payload', 'the payload tests run when they are asked for' | ENFORCED | F0-010 |
| VER-02 | The verifier's only inputs beyond the artifact are `release/manifest.txt` and `release/forbidden.txt`; with `--release` it also reads the repository's version sources and `CHANGELOG.md`. | `verify.sh` header and structure. | Structural; covered indirectly by the suite. | MECHANISM-ONLY | F0-044 (now F0-069) |
| VER-03 | The verifier fails closed on bad policy input: an allowlist that declares a path twice, repeats a path under case folding, or holds an unsafe path is refused. | `verify.sh` step 6. | `release/test-release.sh`: 'an allowlist that declares a path twice is refused', '...case-folded duplicate...', '...unsafe path...' | ENFORCED | F0-044 (now F0-069), G-07 |
| VER-04 | The archive is a readable gzip tar; every member is regular, safely named, not duplicated and not case-colliding; the extracted tree matches the listing. | `verify.sh` steps 2 to 5. | `release/test-release.sh`: truncated archive, duplicate member and hostile-member tests | ENFORCED | F0-041 (now F0-066) |
| VER-05 | `--release` gate: `VERSION`, `template/engine/VERSION`, `release.json` `engine_version` and the artifact version agree; `protocol` is `build-engine/<major>.<minor>` matching the release version; `COMPATIBILITY.md` has a row for that version and protocol; the changelog has a dated `## X.Y.Z - YYYY-MM-DD` entry; the retired `implements_abstract` key is rejected (with or without `--release`). | `verify.sh` steps 9, 6b and 12. | `release/test-release.sh`: 'release gate refuses an undated changelog entry', 'the retired implements_abstract key is rejected', 'a malformed protocol value is refused', 'a protocol that disagrees with the release version is refused', 'a missing COMPATIBILITY.md row is refused', 'a COMPATIBILITY.md row with a different protocol is refused' | ENFORCED | F0-002, Stage 1.2 |
| VER-06 | Consumers do not receive `verify.sh`. Consumer-side assurance is `update.sh`'s own checks (checksum, manifest, entry types, paths, version, downgrade). The 'verify before you install' story is maintainer-side plus these. | `update.sh` (see UPD-05). | `tests/test_update_hardening.sh` | ENFORCED | G-07 |

## 9. Version and compatibility (VRS)

One version, one protocol identifier, one mechanism that moves them together.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| VRS-01 | `release/set-version.sh X.Y.Z` is the only sanctioned way to change the version. It updates `VERSION`, `template/engine/VERSION`, `release.json` (`engine_version`, `protocol`), the `COMPATIBILITY.md` row and the changelog heading, and is idempotent. | `set-version.sh`. | `release/test-release.sh`: 'set-version.sh syncs VERSION, release.json, COMPATIBILITY.md and CHANGELOG.md (idempotent)', 'a patch bump keeps the protocol and adds its own COMPATIBILITY.md row' | ENFORCED | G-11 |
| VRS-02 | `release.json` (managed) and `engine.json` (seed) differ by more than case. The retired `ENGINE.json` name and the `implements_abstract` key do not return. | Manifest; `verify.sh` step 6b; INT-05. | `release/test-release.sh`: the retired-key tests | ENFORCED | F0-013, F0-014 (decision 2026-10-28) |
| VRS-03 | 0.5.0 declares `protocol = build-engine/0.5`. For 0.6.0 the identifier is re-examined, not derived by default. | `verify.sh` (format and match); decision D6. | Format and match tested (VER-05). The 0.6.0 identifier is an open decision. | CONVENTION | D6 |
| VRS-04 | A published version is immutable. No `v0.5.0` tag or release exists today; if one appears, stop and redesignate. Defects are fixed in a new version. | `release.yml` triggers on new tags only. Nothing prevents tag deletion or force-moves (see GOV-01). | Verified 2026-10-28 and again at 9b4ab35: 0 tags on origin. | CONVENTION | G-04, G-12 |

## 10. Consumer install and update (UPD)

`update.sh`: all-or-nothing, never silently overwrites consumer-owned files, never commits.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| UPD-01 | All or nothing: new files are staged, every file about to change is backed up in `.build-engine.txn/`, and a failure or interruption restores the previous state. A killed process is recovered by the next run. | `update.sh` journal, `rollback`, commit marker. | `tests/test_update_hardening.sh`: 'interrupted after file N/7' (N = 1, 3, 6, 7), 'hard kill after step N' (N = 2, 3, 8), 'a kill after the commit marker keeps the finished update' | ENFORCED | G-04, Stage 2.4 |
| UPD-02 | Managed files are replaced as a set. A locally edited, deleted-and-unrecorded or untracked-collision managed file is a conflict; nothing is touched unless `--force`. | `update.sh` conflict pass. | `tests/test_update_hardening.sh`: 'a locally edited managed file blocks the whole update', '...no other file was updated...', 'a new managed file that already exists locally is a conflict', '--force applies everything...' | ENFORCED | G-04 |
| UPD-03 | Seed files (`engine/engine.json`) are installed only when absent and never overwritten; an edited seed is kept. | `update.sh` seed handling. | `tests/test_update_hardening.sh`: 'an edited seed is never overwritten', 'a deleted seed is re-created from the release' | ENFORCED | G-04 |
| UPD-04 | Consumer-owned data survives: untracked files, `plans/` data and configuration are untouched; dropping `plans/README.md` never removes the consumer's `plans/` directory. | `update.sh` prune logic. | `tests/test_update_hardening.sh`: 'consumer-owned plan data is untouched', 'untracked consumer files survive', 'dropping plans/README.md never removes the consumer's plans/ directory' | ENFORCED | G-04, F0-044 (updater) |
| UPD-05 | `update.sh` refuses, changing nothing: checksum mismatch or missing sidecar; non-regular, unsafe or duplicate manifest/archive entries; a file not in the manifest or a manifest entry not in the artifact; an artifact whose version differs from the requested one; a downgrade without `--allow-downgrade`; a corrupt lock; a symlinked or non-directory target path; a case-colliding release on a case-insensitive filesystem; malformed `--version` and `--repo`. | `update.sh` preflight and staging checks. | `tests/test_update_hardening.sh`: the 'manifest/archive: ...', 'corrupt lock (...)', 'a downgrade is refused', 'an artifact whose contents are another version is refused', 'a managed directory that is a symlink is refused', 'bad --version/--repo' groups | ENFORCED | G-07, F0-040..F0-045 (updater) |
| UPD-06 | One updater at a time per repository; a live update blocks a second, concurrent runs end in one consistent state. | `update.sh` lock/pid handling. | `tests/test_update_hardening.sh`: 'a live update in progress blocks a second one', 'concurrent runs end in one consistent installed state' | ENFORCED |  |
| UPD-07 | `update.sh` never commits, stages, branches or pushes. | `update.sh` (no git writes). | `tests/test_update_hardening.sh`: 'nothing was committed or staged', 'no commit, no staging, no branch change' | ENFORCED | G-12 |
| UPD-08 | Unsupported environments are refused early with a clear message: bash older than 4.4 (including macOS stock bash 3.2) and missing GNU tools. Supported: Linux and Termux. | `update.sh` preflight. | `tests/test_update_hardening.sh`: 'bash older than 4.4 is refused with a clear message', 'bash 4.0 to 4.3 are refused too', 'a missing sha256sum is reported with an install hint' | ENFORCED | F0-014 (decision Q3) |
| UPD-09 | `update.sh` copies, hashes and compares payload files but does not execute any payload file other than itself. | No `bash`/`sh`/`python`/`source` invocation of extracted files found by grep. | Grep only; no test asserts it. | MECHANISM-ONLY | F0-010 (spirit) |

## 11. Operator bridge (Class A) (BRG)

`cbridge`: the only component that crosses the public/private boundary.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| BRG-01 | `cbridge` is the only component that crosses the private/public boundary. Agents are given a token for the private repository only, never anything cbridge holds. | Architecture; `docs/SECURITY.md`; decision 0005. | Documented; not mechanically testable from this repo. | CONVENTION | Decision 0005 |
| BRG-02 | Commands that write private content refuse to run unless the private repository is confirmed private through the GitHub API. | `cbridge` `assert_private`. | `tests/test_cbridge.sh` runs with `CBRIDGE_NO_GH` set, which skips the check by design. Two weaknesses: the bypass is an environment variable in shipped production code, and the check itself is not exercised end to end. | GAP | Decide: keep as a documented test hook, or gate it behind an explicit test-only mechanism. |
| BRG-03 | `OUTBOX_URL` and `UPSTREAM_URL` may not equal `PRIVATE_URL`; upstream push is permanently disabled (`DISABLED-never-push-to-upstream`). | `cbridge` config assertions; `cmd_init`. | `tests/test_cbridge.sh`: 'upstream remote is read-only push' | ENFORCED-UNGATED |  |
| BRG-04 | `publish` pushes only the exact guarded SHA. The branch must be `task-<id>`, descend from upstream `main`, have commits beyond it, contain no merge commits, touch no denied path (`engine/`, `plans/`, `.github/` by default), match the optional allowlist, and leak no `DENY_TEXT` in commit messages or PR title/body. | `cbridge` `guard_task`, `cmd_publish`. | `tests/test_cbridge.sh` publish-guard checks (not gated). | ENFORCED-UNGATED | G-07, G-08 |
| BRG-05 | Secret patterns (`ghp_`, `github_pat_`, private-key blocks, `AKIA`) in a submission or in an outgoing diff are refused. | `cbridge` `SECRET_RE` in `cmd_upload` and `guard_task`. | `tests/test_cbridge.sh`: 'secret pattern in submission rejected' (not gated; needs `jq`). | ENFORCED-UNGATED | G-08 |
| BRG-06 | `cbridge` never merges and never publishes without an explicit operator step (`-y` is the operator's own opt-out of the prompt). | `cbridge` command set. | `tests/test_cbridge.sh`: 'no merge/auto-publish command in cbridge', 'publish without branch fails' | ENFORCED-UNGATED | G-12 |
| BRG-07 | `upload` accepts exactly one `SUBMISSION.json`, a safe `submission_id`, a matching `plan_id`, no symlinks; an existing submission id is immutable (new id required); `MANIFEST.sha256` and `UPLOAD.json` are generated by cbridge, not by the worker. | `cbridge` `cmd_upload`. | `tests/test_cbridge.sh`: 'duplicate upload rejected', 'MANIFEST.sha256 written', 'UPLOAD.json written' (8 of 36 checks need `jq`). | ENFORCED-UNGATED | R0-011, G-04 |
| BRG-08 | Private `main` must equal upstream (no commits that are not upstream's); divergence is reported and never forced. | `cbridge` `verify-main`, `sync`. | `tests/test_cbridge.sh`: resume/main checks (not gated). | ENFORCED-UNGATED | Class A tripwire |
| BRG-09 | The operator-bridge suite runs in CI and in the release job. | Nothing. `tests/test_cbridge.sh` is invoked by no workflow and not by `tests/test_update.sh`. | Executed at 9b4ab35 in a sandbox without `jq`: 28 passed, 8 failed (all eight are `jq` missing). Not executed in full. GitHub-hosted runners include `jq`, so wiring it in would be expected to pass; that is unproven. | GAP | F0-008 (follow-up), Stage 3.3.1 |
| BRG-10 | The recorded acceptance of the Class A delivery route: operator-side `cbridge upload` is the documented delivery path in 0.5.0; the submissions-to-consumer transfer is deferred to 0.6.0. | Decision Q2 (2026-10-28). | Documentation alignment pending (README, STATUS, END-TO-END). | CONVENTION | D2, R0-011 |

## 12. Plan and order tooling (PLN)

`plan_tool.py`: the only writer of plan state.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| PLN-01 | `plan_tool.py` is the only writer of plan state; status changes go through `set`; invalid transitions and cross-references are refused. | Tool design; `check` validation. | `template/engine/tools/test_plan_tool_hardening.py`: `test_invalid_state_transitions_and_cross_references` | ENFORCED |  |
| PLN-02 | State-changing commands hold a per-plan lock, write files atomically and restore already-written files if a multi-file operation fails part-way. | `plan_lock`, `Txn`, `write_text_atomic`. | `template/engine/tools/test_plan_tool_hardening.py` `TestAtomicity`: `test_interrupted_write_leaves_the_old_file_and_no_temp_files`, `test_new_failure_leaves_no_partial_plan_and_no_counter_bump`, `test_order_start_failure_rolls_back_order_file_and_task_state`, `test_decide_failure_rolls_back`, `test_concurrent_orders_get_distinct_ids_and_none_is_lost`, `test_lock_times_out_with_a_clear_message` | ENFORCED | F0-051, F0-052, F0-053 |
| PLN-03 | Context is delivered only as URLs pinned to a full 40-hex commit; a target file must exist at the pinned commit; hashes come from the pinned commit, not the working tree; moving refs are not accepted as pinned. | `context_urls`, `build_order`, `ctxlink.REF_RE`. | `template/engine/tools/test_plan_tool_hardening.py` `TestPinning`: `test_moving_refs_are_refused`, `test_hash_is_of_the_committed_file_not_the_working_tree`, `test_target_file_missing_at_the_pinned_commit_is_refused`, `test_not_a_git_checkout_is_refused`, `test_printed_order_claims_pinning_only_when_true` | ENFORCED | F0-054, F0-055 |
| PLN-04 | Identifiers and paths are validated (`safe_rel`, id patterns, no trailing newline); wrong-typed input gives a controlled error, not a traceback; exit codes are stable (0, 1, 2, 70, 130). | `validate`, `safe_rel`, `main`. | `template/engine/tools/test_plan_tool_hardening.py` `TestMalformedInput`: `test_wrong_typed_fields_give_errors_not_tracebacks`, `test_unexpected_errors_exit_70_without_a_traceback`, `test_exit_codes_are_stable`, `test_ids_with_trailing_newline_or_traversal_are_rejected`, `test_path_traversal_variants_in_task_paths`; `TestFuzzedShapes` | ENFORCED | F0-057, F0-058, F0-061 |
| PLN-05 | A `HALT` marker at the repo root or in the plan directory blocks every write. | `guard_halt`. | `template/engine/tools/test_plan_tool.py`: HALT tests (the marker blocks writes) | ENFORCED | G-12 |
| PLN-06 | `order` refuses an invalid plan; `check` validates structure, dependencies and cycles; duplicate task ids are not silently ignored. | `check_plan`, `find_cycles`, `_refuse_invalid`. | `template/engine/tools/test_plan_tool_hardening.py`: `test_duplicate_task_ids_are_an_error_not_silently_dropped`, `test_order_refuses_a_plan_that_fails_check`, `test_order_refuses_schema_invalid_plan_json` | ENFORCED | F0-050, F0-056 |
| PLN-07 | `check-submission` applies the mechanical parts of gates G1 and G2 to an uploaded submission (layout, UTF-8, no symlinks, no secrets, report headings). | `cmd_check_submission`. | `template/engine/tools/test_plan_tool.py` and `template/engine/tools/test_plan_tool_hardening.py`: `check-submission` tests | ENFORCED | Supervisor gates |
| PLN-08 | Signed links, when minted, exist only at print time and are never written into `orders/<id>.json`; the signing secret comes from the environment only; link lifetime is 1 second to 72 hours. | `with_gateway`, `ctxlink.MAX_TTL`. | `template/engine/tools/test_plan_tool.py`: `test_signed_gateway_links_are_minted_at_print_time_only` (order file contains no `gateway_url` or `/v1/k1/`; no secret means refusal), `test_links_needs_gateway_and_existing_order`; `template/engine/tools/test_plan_tool_hardening.py`: `TestSigningConsistency.test_ttl_bounds_and_cli`, `test_strict_validation_of_identifiers`, `test_signature_matches_an_independent_implementation_for_tricky_paths`, `test_gateway_misconfiguration_gives_clean_errors` | ENFORCED | Decision 0003, F0-059, F0-060 |
| PLN-09 | The plan tooling uses only the Python standard library. | Imports. | `python3 -m compileall` in `verify.sh` step 10; no third-party import in the file. | MECHANISM-ONLY |  |
| PLN-10 | The shipped plan tooling's own tests run in CI, in the release job and (on request) in `verify.sh --test-payload`. | `ci.yml`, `release.yml`, `verify.sh`. | Workflow YAML. | ENFORCED | G-06 |

## 13. Security boundaries and honest scope (SEC)

What Basic promises, and what it must not imply.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| SEC-01 | Class A (agent holds its own credential, uses the pinned raw URLs) and Class B (credential-free, GET only, via a gateway) remain strictly separate trust paths. In 0.5.0 only Class A is supported. | Decision 0005; `docs/SECURITY.md`. | Documented. | CONVENTION | Decision 0005, D1 |
| SEC-02 | Credentials never enter source, fixtures, artifacts, logs or audit records. | `forbidden.txt` credential-shape rules; `cbridge`/`plan_tool` secret scans; `.gitignore`; `is_generated`. | `release/test-release.sh`: 'a credential in a binary file is caught'; BRG-05 | ENFORCED | G-08 |
| SEC-03 | Worker output is untrusted. Hashes and provenance come from `cbridge upload`, not from `SUBMISSION.json` `worker.*` fields. | `cmd_upload` generation of `MANIFEST.sha256` and `UPLOAD.json`. | See BRG-07. | ENFORCED-UNGATED | G-07 |
| SEC-04 | Verification commands run on the operator/supervisor machine from plan files the operator controls; plan changes are reviewed like code. | None. | Documented in `docs/SECURITY.md`. | LIMITATION |  |
| SEC-05 | Direct pushes to private `main` on a free plan are detected, not prevented. | `cbridge verify-main`, supervisor G0. | Documented limitation; see BRG-08 and GOV-01. | LIMITATION | R0-004 |
| SEC-06 | The shipped consumer documentation and prompts make no claim that a gateway or an agent write path is available in this version. | Authoring discipline. | `SETUP.md` section 6, `SECURITY.md`, `CONTEXT-EXPORT.md`, `engine/AGENTS.md` are Class-A-safe. `AGENT-WORKER-PROMPT.md` still offers 'your HTTPS GET gateway if the order lists gateway URLs' as a live option. No test asserts this invariant. | GAP | Decision Q9 (edit approved) |

## 14. Release pipeline (PIP)

What runs before anything is published.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| PIP-01 | CI runs the shipped-engine tests, shell syntax checks (including `release/*.sh` and `tests/*.sh`), the release self-test, the consumer install/update flow, and a package-and-verify dry run with `--test-payload`. | `.github/workflows/ci.yml`. | Workflow YAML; CI green at c180a88 (main). | ENFORCED | G-06, G-10 |
| PIP-02 | Publication is triggered only by a `vX.Y.Z` tag. The tag must equal `VERSION`, and its commit must be an ancestor of `origin/main`. | `release.yml` first step. | Workflow YAML; no run has occurred. | MECHANISM-ONLY | F0-023 |
| PIP-03 | The release job re-runs the tests, packages, runs `verify.sh --release --test-payload`, requires a changelog entry for the version, and only then publishes the tarball and sidecar (`--verify-tag`). | `release.yml`. | Workflow YAML; dry-run equivalent in CI. | MECHANISM-ONLY | G-10, G-12 |
| PIP-04 | Publication depends on the `ci` workflow having passed on the tagged commit. | Nothing: `release.yml` has no `needs`/`workflow_run` link to `ci`. | Open defect F0-023. | GAP | F0-023 |
| PIP-05 | Write permission is limited to the publish step; third-party actions are pinned to immutable commit SHAs; the tag must point at the tip of `main` (not merely an ancestor). | Nothing: `contents: write` is workflow-wide, actions are `@v4`/`@v5`, the check is `merge-base --is-ancestor`. | Open defect F0-023. | GAP | F0-023 |
| PIP-06 | A failed gate publishes no asset and creates no misleading GitHub Release. | Step ordering in `release.yml` (publish is last). | Structural only; never exercised. | MECHANISM-ONLY | F0-023 |
| PIP-07 | The release job also runs tests of code that is never shipped (`gateway/read/reference`); a Class B test failure therefore blocks a Basic release. | `release.yml` Tests step; `ci.yml` also runs the write-gateway job. | Workflow YAML. A coupling to record: either accept it or scope the Basic release job to shipped code. | LIMITATION | Decision needed |
| PIP-08 | Every script a workflow invokes directly keeps its executable bit. | Git index modes (all `release/*.sh`, `tests/*.sh`, `cbridge`, `install.sh`, `update.sh` are 100755 at 9b4ab35). | Checked by hand; the red-main failure that originated F0-008 was exactly this. No test asserts it for `release/` and `tests/`; the artifact side is covered by SCP-07. | MECHANISM-ONLY | F0-008 |
| PIP-09 | CI runs only on pull requests whose base is `main` (and on pushes to `main`). A PR based on a feature branch runs nothing; retargeting does not re-trigger CI. | `ci.yml` triggers. | Observed repeatedly in Stage 5.5 and #18 history. | CONVENTION | Process rule |

## 15. Governance and operator authority (GOV)

The invariants that code cannot enforce.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| GOV-01 | `main` and `v*` tags are protected: PR required, `ci` required, tag creation restricted, Actions allow-listed and SHA-pinned. | Repository settings (none configured). | `branches/main/protection` returned 404 on 2026-10-28. By decision Q10 this is skipped for 0.5.0 and accepted as an open risk, to be recorded in writing in the register. | LIMITATION | R0-004, D7 |
| GOV-02 | Publication is operator-controlled: the operator approves the final artifact and release notes before the tag; the system prepares, validates and reports, and never publishes on its own. | Process; `release.yml` triggers only on a tag the operator pushes. | Process. | CONVENTION | G-12, D5 |
| GOV-03 | The changelog date is set at tag time, after the operator approves the artifact; until then the `--release` gate fails closed on the undated heading. | `verify.sh` `--release`. | `release/test-release.sh`: 'release gate refuses an undated changelog entry' | ENFORCED | F0-002, decision Q7 |
| GOV-04 | The 0.5.0 scope is Basic, Class A only. Class B work stays unmerged until `v0.5.0` is tagged and published; Class B blockers (R0-005, R0-007, credential scope, ephemeral staging, ambiguous retry outcomes, audit leakage) stay open in the register and are not closed by deferral. | Decisions D1, D3 (2026-10-28). | Documentation alignment pending (README, STATUS, END-TO-END, `PHASE-1.1-PRODUCT-CONTRACT.md` amendment). | CONVENTION | D1, D3, F0-020 |
| GOV-05 | The release record states only what has executed: no test is claimed as passed unless its command ran and its output was inspected. | Process (G-06). Evidence recorded in PR descriptions and phase reports. | This registry's own status column applies it. | CONVENTION | G-06 |
| GOV-06 | Defect and finding ids are unique across the register. | None. The Stage 3.2 branch reused F0-040..F0-044, already assigned on `main`; caught by hand and renumbered (F0-065..F0-069). | No check. A one-line duplicate-heading check would close it. | GAP | PR #26 |

## 16. Documentation truth (DOC)

Maintainer-facing documents must match the Basic scope once 0.5.0 ships.

| ID | Invariant | Enforced by | Evidence | Status | Refs |
|---|---|---|---|---|---|
| DOC-01 | `README.md`, `docs/STATUS.md` and `docs/END-TO-END.md` mark the read gateway, write gateway, remote revocation/audit and the pilot as 'not included in 0.5.0; planned for 0.6.0', using the status vocabulary (implemented / reference only / scaffold / not started / not deployed / unsupported). | Authoring discipline. | Verified at 9b4ab35: `README.md` lines 72, 75 and 77 still say the production read gateway, the write gateway and remote revoke/audit are 'required for 0.5.0'; `docs/STATUS.md` and `docs/END-TO-END.md` still describe the gateways as scaffold/not started without a Basic deferral. | GAP | F0-019, F0-020 |
| DOC-02 | `PHASE-1.1-PRODUCT-CONTRACT.md` is amended by an explicit, dated operator decision: Class B is out of scope for 0.5.0. | Operator decision record. | Decision given 2026-10-28 (Q1); amendment not yet written into the contract. | GAP | F0-020, D1 |
| DOC-03 | The changelog lists only delivered Basic functionality and states that Class B is deferred. | Authoring discipline; `release.yml` extracts notes from the dated entry. | Notes extraction fails if there is no entry. | CONVENTION | G-06 |
| DOC-04 | Each Class B-adjacent shipped sentence is accurate: Class B code exists in the source repository on branches, undeployed, and is not part of this release. | Authoring discipline. | Shipped docs are accurate (SEC-06 lists the one exception). | CONVENTION |  |

## 17. Maintenance rules

1. An invariant is added when a defect is closed by a mechanism, or when a decision creates a standing rule. Cite the defect or decision id.
2. A status may move up (toward ENFORCED) only with a named test in a gated suite. It moves down immediately if its test is removed, skipped or left out of the workflows.
3. Nothing moves to ENFORCED on the strength of a document. G-06 applies: a claim of enforcement needs a command that ran and an inspected result.
4. Released invariants are not edited for a published version. A 0.6.0 registry starts from this file and adds the Class B categories (gateway contract, signing, session lifecycle, audit, deployment).
5. The release owner reviews Section 4 before each tag; a GAP in Section 4 blocks the tag unless the operator records an explicit exception.
