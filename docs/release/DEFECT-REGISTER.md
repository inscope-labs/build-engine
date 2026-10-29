# Build Engine — Phase 0 Defect Register

- Repository: `https://github.com/inscope-labs/build-engine`
- Baseline branch: `main`
- Inspected baseline commit: `b45e8008adcaa179165abf24880e8eda0eb7c515` (remote review); local command baseline run at `ee654cddeb9bd00043230942d89c8df955ea3afc` (adds only `RELEASE-PLAN.md`; see `PHASE-0-BASELINE.md`)
- Version: `0.5.0`
- Baseline date: 2026-10-26
- Status: **Addendum A2 (extended audit) submitted for operator review; the original register was merged in PR #1**
- Addendum date: 2026-10-26; audited commit `35172ab` (main after Phase 1 PRs #2-#5)
- Addendum A5 (Stage 3.1, allowlist packaging), 2026-10-27: F0-036 to F0-039 found and closed; F0-011, F0-012, F0-013 and F0-018 closed. Baseline commit `99a5a73` (main after Stage 2.3).
- Addendum A6 (Stage 3.2, independent verification), 2026-10-27: F0-065 to F0-069 found and closed; F0-010, F0-013 (verification half) and F0-016 closed. Baseline commit `3149df0` (Stage 3.1).

## Status and evidence rules

- **CONFIRMED** means supported by the inspected source or CI evidence.
- **RISK TO TEST** means plausible and material but not demonstrated as a defect by an executed test.
- **DESIGN DECISION** means a product/security choice that must be resolved or explicitly accepted.
- **NOT VERIFIED** means access or execution evidence was unavailable. It must not be treated as either a pass or a failure.

Severity: **S1** blocks the relevant release or advertised capability; **S2** is a material reliability, security, or consistency gap; **S3** is lower-priority improvement. No S0 finding was established by this remote baseline review.

## A. Confirmed findings

### F0-001 — Abstract compatibility metadata is unset
- Severity: S1 for the release gate.
- Status: CONFIRMED.
- Evidence: `template/engine/ENGINE.json` has `"implements_abstract": "UNSET"`; `COMPATIBILITY.md` documents that `release/verify.sh --release` fails while the value is unset.
- Consequence: a release-mode verification pass cannot be claimed.
- Required resolution: establish the intended abstract framework/product compatibility identifier and exact version from an authoritative specification or explicit operator decision; update schema, docs, tooling, and tests consistently if the product contract changes.
- Owner: operator for the compatibility decision; implementation owner for the resulting edits.
- Planned phase: Phase 1 (compatibility/product decision), then Phase 2/7 as applicable.
- Closure evidence: authoritative decision recorded; metadata and docs agree; relevant tests pass; release verifier accepts the intended value.

### F0-002 — Changelog still identifies 0.5.0 as unreleased
- Severity: S1 for publication, not for baseline triage.
- Status: CONFIRMED.
- Evidence: `CHANGELOG.md` begins with `## 0.5.0 - unreleased`.
- Consequence: the documented release gate is not satisfied; changing the heading prematurely would falsely imply release readiness or publication.
- Required resolution: update the entry only when the release contents and release date/status are approved and the release gate is actually satisfied.
- Owner: release maintainer/operator.
- Planned phase: Phase 2 for release-preparation edits and Phase 7 for final publication/status.
- Closure evidence: dated, accurate entry tied to the approved release contents and release process.

### F0-003 — Production read gateway is not implemented/deployed
- Severity: S1 for a claim of complete end-to-end Class B operation.
- Status: CONFIRMED.
- Evidence: `docs/END-TO-END.md` marks the production read path not started and its decisions open; `docs/STATUS.md` describes production directories as structure/design placeholders.
- Consequence: the production Class B context retrieval path cannot be claimed operational.
- Required resolution: resolve the relevant architecture decisions, implement and deploy the production path, and pass staging acceptance tests.
- Owner: implementation team and operator for decisions/hosting approvals.
- Planned phase: Phase 4.
- Closure evidence: conformance tests and a staging test proving only the authorized file at the pinned reference is returned; deployment and revocation/audit behaviour evidenced.

### F0-004 — Write gateway is scaffold-only
- Severity: S1 for agent-side submission capability.
- Status: CONFIRMED.
- Evidence: `gateway/write/src/index.ts` returns HTTP 501; `gateway/write/README.md` identifies implementation/tests as scaffold or stubs.
- Consequence: agent-side gateway submission is not operational.
- Required resolution: implement authorization/task binding, routing, quotas, staging, idempotent commit, sealing/closure, revocation and audit semantics; add real adversarial and integration tests.
- Owner: implementation team; operator for unresolved security/product decisions.
- Planned phase: Phase 5.
- Closure evidence: deployed integration tests for allowed and denied operations, task isolation, retries, audit, revocation, and recovery.

### F0-005 — Shared conformance vectors and executable harness are incomplete
- Severity: S2, blocking conformance claims.
- Status: CONFIRMED.
- Evidence: `conformance/signing-vectors.json` has an empty vector collection/stub status; `conformance/harness/README.md` describes a proposed runner rather than a completed harness.
- Consequence: implementations do not yet share an executable, common conformance gate.
- Required resolution: define machine-readable vectors including whitespace and non-ASCII cases, implement the runner, and exercise the signer, reference gateway, and production implementation against common behavioural requirements.
- Owner: implementation team.
- Planned phase: Phase 3 and integration work in Phase 6, according to the implementation plan.
- Closure evidence: non-empty vectors, meaningful runner assertions, and passing cross-implementation conformance results.

### F0-006 — Real end-to-end pilot has not started
- Severity: S1 for a claim of complete end-to-end readiness.
- Status: CONFIRMED.
- Evidence: `docs/END-TO-END.md` and `docs/pilot/README.md` identify the pilot as not started/planning only.
- Consequence: no evidence yet demonstrates the complete workflow with a real disposable task/repository.
- Required resolution: run and preserve a staging pilot covering context retrieval, delivery, operator review, publish/reconcile, revoke/closure, and audit inspection.
- Owner: implementation team and operator/pilot owner.
- Planned phase: Phase 6.
- Closure evidence: repeatable pilot record, test outputs, audit evidence, and documented unresolved issues.

### F0-007 — Product-specific compatibility contract is not reconciled with the broader product identity
- Severity: S2.
- Status: CONFIRMED.
- Evidence: `COMPATIBILITY.md` names an abstract Castiel framework; `ENGINE.json` leaves the mapping unset; the wider repository is named Build Engine and consumer configuration uses generic placeholders. Decision 0004 notes proposed prefixes are Castiel-specific/configurable.
- Consequence: a partial rename or an invented version value could leave metadata and documentation inconsistent.
- Required resolution: decide whether Build Engine is intentionally Castiel-specific or product-neutral. If specific, identify the exact abstract version. If neutral, define and migrate a generic compatibility identifier atomically.
- Owner: operator/product owner for the decision; implementation owner for changes.
- Planned phase: Phase 1.
- Closure evidence: recorded decision and consistent metadata, docs, schemas, tooling, and tests.

## A2. Additional confirmed findings (extended audit, 2026-10-26)

Added after the operator asked for a register that omits no known defect. Method and coverage are in section G. IDs continue the F0 series. "Executed" means a command was run and its output inspected in a throwaway copy of the repository; "source" means confirmed by reading the code.

### F0-008 — Main CI is red: Stage 1.2 stripped executable bits from three release scripts
- Severity: S1 (gate integrity). Status: CONFIRMED (executed; fixed in this PR).
- Evidence: commit `6bb3f10` changed `release/verify.sh`, `release/test-release.sh`, `release/set-version.sh` from 100755 to 100644. CI run on `3e8a8ed` and `35172ab` failed at "Release machinery self-test" (5 of 21 checks passing; "Permission denied"). The consumer update test also failed (6 of 22). PRs #4 and #5 merged on red because `main` is unprotected (R0-004). A second, stale assertion remained: the self-test still expected the old `UNSET abstract version` message after the field migration.
- Resolution (this PR): modes restored; the gate test split into an undated-changelog negative test and an UNSET-protocol negative test. Local result after fix: self-test 22/22, update test 22/22.
- Owner: implementation. Planned phase: fixed in this PR; permanent guard (mode check in CI/self-test) in Stage 3.3.1 / 3.4.3.
- Closure evidence: CI green on this PR and on `main` after merge.

### F0-009 — Write gateway is a scaffold at file level, not just a 501 handler (extends F0-004)
- Severity: S1 for the approved release scope (write gateway is mandatory per Stage 1.4). Status: CONFIRMED (executed count, 2026-10-26).
- Evidence:
  - `gateway/write/src`: 48 files; 46 contain only a comment and `export {}`; the other 2 (`index.ts`, `session/task-session.ts`) are handlers that return HTTP 501.
  - `gateway/write/tests`: 32 `.ts` files (unit, integration, chaos, load, helpers); all 32 contain only a comment and `export {}`. No test of any kind exists.
  - `gateway/write/scripts`: 4 files, 4 stubs (`check-token-scope`, `mint-root-url`, `seed-test-repo`, `verify-log-hygiene`).
  - `gateway/write/ci/*.yml`: 6 stub workflows (unit, integration, lint, load, chaos, deploy-gate). They sit outside `.github/workflows/`, so none of them can run.
  - `package.json` has no `test` script and no test runner or Miniflare/Workers test dependency; only `typescript`, `wrangler`, `@cloudflare/workers-types`. CI "write gateway" job runs typecheck and a bundle dry run only, which pass on empty files.
  - `src/config/type-policy.json` and the three `tests/fixtures/*.json` files are `_status: scaffold` placeholders; `src/config/quotas.json` still carries the "KB undefined" note that Stage 1.4.8 decided (KiB, bytes authoritative) but the file was not updated.
  - `.dev.vars.example` names are marked PROVISIONAL; `wrangler.toml` is marked "not deployable yet".
- Consequence: no write-gateway behaviour exists or is tested; passing typecheck/bundle says nothing about function. Ownership is Phase 5 (below), not Phase 2/3.
- Owner: implementation team. Planned phase: Phase 5 - 5.1 (contract), 5.2 (core/session), 5.3 (GitHub commit), 5.4 (audit/ops, scripts), 5.5 (all test stubs, runner, CI wiring); deploy-gate wiring also 5.4.6.
- Closure evidence: Phase 5 exit gate: "No 501 handler or placeholder source/test stubs remain in any feature claimed as supported", plus passing suites.

### F0-010 — `verify.sh` executes code from the artifact it is verifying
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: step 7 of `release/verify.sh` runs `python3 -m compileall` and `python3 -m unittest discover` inside the extracted payload. A planted `engine/tools/test_*.py` wrote a marker file outside the extraction directory during `verify.sh`, and the script still reported OK.
- Consequence: running the independent verifier on an untrusted or tampered artifact executes that artifact's code with the verifier's privileges; verification is not independent of the thing verified.
- Required resolution: perform all static/integrity checks first and treat payload tests as a separate, explicitly sandboxed or opt-in step; never run payload code as part of default verification of a downloaded artifact.
- Owner: implementation. Planned phase: Phase 3 - Stage 3.2.7 (verify independently), 3.4.1 (negative test).
- Closure evidence: a negative test with a planted payload test proving verification does not execute it.
- **Closed in Stage 3.2** (`PHASE-3.2-REPORT.md`): the payload's own test suite is no longer part of the default
  verification. `release/verify.sh` performs only static checks; running the payload's tests is an explicit,
  separate step (`--test-payload`) that the build side opts into and that a consumer never does. The static checks
  that remain - the shell syntax check and `compileall` - parse the payload, they do not execute it. Self-test: "the
  payload tests are run when they are asked for", "verification does not execute the payload" (a planted payload test
  that writes a marker file outside the extraction directory; the marker must not appear).

### F0-011 — Packaging includes untracked files from `template/` and verification passes them
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: untracked files `template/docs/.scratch-local.txt` and `template/engine/tools/local-notes.txt` were included in the tarball (43 files vs 41) and `verify.sh` reported OK. `package.sh` expands manifest directories with `find`, not from the git index; verify only matches path/content patterns.
- Consequence: a local build can ship stray files, including secrets that are not credential-shaped. CI builds from a clean checkout, which mitigates but does not remove the local-build path (the operator builds from Termux).
- Required resolution: package from tracked files only (`git ls-files`) or refuse a dirty template tree; add a negative test.
- Owner: implementation. Planned phase: Phase 3 - 3.1.2, 3.1.5, 3.4.1.
- Closure evidence: dirty-tree test fails closed; positive test packages the clean tree.
- **Closed in Stage 3.1** (`PHASE-3.1-REPORT.md`): the artifact is built from `git ls-files` under `template/`, and a
  modified, deleted, staged or untracked file under `template/` (or a modified manifest) fails the build with the
  offending paths named. Executed at the baseline: an untracked `template/docs/.scratch-local.txt` was packaged and
  `verify.sh` reported OK; after the change the same file stops the build. Self-test: "an untracked file in template/
  stops packaging", "a locally modified file stops packaging".

### F0-012 — Tarball bytes depend on the builder's umask
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: the same git tree packaged under umask 022 and under a group-writable checkout (umask 002) produced two different SHA-256 values. Modes are copied from the working tree.
- Consequence: Stage 3.1.4 "byte-identical rebuilds" fails across environments; Termux's stricter default umask will likely produce a different artifact from CI. The release contract's "deterministic tarball" claim is not met.
- Required resolution: normalise modes in the archive (explicit 0644/0755 from the manifest or git mode) rather than inheriting them.
- Owner: implementation. Planned phase: Phase 3 - 3.1.4.
- Closure evidence: identical hashes across at least two umasks, tested in `test-release.sh`.
- **Closed in Stage 3.1** (`PHASE-3.1-REPORT.md`): the staged files are given explicit modes from the git index
  (0644, or 0755 when the index says 100755) and the generated release manifest is given 0644 as well - a shell
  redirect was the last umask-dependent byte in the archive. Executed at the baseline: the same commit built under
  umask 022 and under umask 002 produced two different SHA-256 values; after the change they are identical.
  Self-test: "a group-writable checkout builds the same bytes", "a different umask builds the same bytes".

### F0-013 — Managed `engine/ENGINE.json` and seed `engine/engine.json` differ only by case
- Severity: S2. Status: CONFIRMED (source: `release/manifest.txt` lines 9 and 15, both files present in `template/engine/`).
- Evidence: the two names collide on case-insensitive filesystems (default macOS and Windows volumes, FAT/exFAT and some Android storage). One cannot check out both; an install or update could overwrite the seed (consumer configuration) with managed metadata or the reverse.
- Consequence: potential loss of consumer-owned configuration, contradicting G-04.
- Operator decision 2026-10-26: names are to be lowercase. Literal lowercase of `ENGINE.json` equals the seed `engine.json`, so the managed file needs a distinct lowercase name (**pending confirmation; proposed `engine/release.json`**). No consumer migration is needed because nothing has been released.
- Required resolution: rename the managed file (touches `release/manifest.txt`, `set-version.sh`, `verify.sh`, `test-release.sh`, and five docs); add a case-fold duplicate check to packaging and verification.
- Owner: operator (decision), implementation. Planned phase: decision in Phase 2.4 planning; implementation 2.4 and 3.1.2.
- Closure evidence: no two manifest paths equal under case folding; update test covers migration.
- **Closed (2026-10-28):** the operator decided managed `engine/release.json` (renamed from `ENGINE.json`) and seed `engine/engine.json`. No two manifest paths differ only by case any more; a guard test in `release/test-release.sh` keeps it that way. Nothing had been released, so no consumer migration was needed.
- Defence in depth (Phase 2.4): `update.sh` also refuses any future release whose paths differ only by case when the filesystem ignores case, so nothing could be silently overwritten (tested with a simulation hook).
- **Closed in Stage 3.1** (`PHASE-3.1-REPORT.md`): the managed metadata file is `template/engine/release.json` - the
  name proposed in the Phase 1.1 product contract, confirmed by the operator on 2026-10-28; the packaging side of the
  check is in place (a case-folded duplicate is refused) and the verification side is Stage 3.2.3. `release/manifest.txt`,
  `set-version.sh`, `verify.sh`, `test-release.sh`, `README.md`, `COMPATIBILITY.md`, `docs/ARCHITECTURE.md`,
  `docs/STATUS.md` and `docs/release/REQUIREMENT-TRACEABILITY.md` were updated. The seed file `engine/engine.json` is
  unchanged, so no consumer migration is needed. Executed at the baseline: both names were in one artifact.
- **The verification half was closed in Stage 3.2**: `release/verify.sh` now refuses an allowlist that declares a
  path twice or two paths equal under case folding, and refuses a release manifest that lists a path twice or two
  paths equal under case folding. Self-test: "an allowlist that declares a path twice is refused", "an allowlist
  with a case-folded duplicate is refused".

### F0-014 — Shipped shell tooling requires bash 4+ and GNU tools, but the draft contract named macOS as a primary target
- Severity: S2. Status: CONFIRMED by source; not executed on macOS.
- Evidence: `engine/bin/update.sh` uses `declare -A` (not in the bash 3.2 that macOS ships) and requires `sha256sum`; `release/package.sh` uses GNU `tar` options (`--sort`, `--mtime`, `--owner`, `--numeric-owner`) and `sha256sum`; the operator README describes `cbridge` as a Termux script.
- Consequence: the documented supported environments and the real requirements disagree. The redrafted Stage 1.1 contract states the requirement explicitly.
- Operator response 2026-10-26: asked for an explanation. Default applied: macOS is not claimed as supported (revisit on request).
- Required resolution: state the requirement (bash >= 4, GNU coreutils/tar) and add a preflight check with a clear error so unsupported shells fail clearly.
- Owner: operator (environment decision), implementation. Planned phase: Phase 1.1 contract (this PR), Phase 2.4 preflight.
- Closure evidence: preflight test on an older-bash stub; docs state the requirement.
- **Updater part closed in Phase 2.4** (`PHASE-2.4-REPORT.md`): `update.sh` checks for bash 4.4+ and every required tool before doing anything and fails with a clear message; macOS is documented as not supported. `release/package.sh` still needs GNU `tar` (Phase 3).

### F0-015 — `update.sh` is not transactional
- Severity: S2. Status: CONFIRMED by source; interruption not executed.
- Evidence: the apply loop copies files one by one and writes `.build-engine.lock` only at the end. An interrupted update leaves some files at the new version with the lock still describing the old one; the next run classifies those files as "edited locally" conflicts.
- Consequence: recoverability gap; the operator would be pushed to `--force`. Stage 2.4.7 requires all-or-nothing behaviour or a staged backup/rollback.
- Owner: implementation. Planned phase: Phase 2.4 - 2.4.4, 2.4.5, 2.4.7.
- Closure evidence: interrupted-update test that recovers without `--force`.
- **Closed in Phase 2.4:** `update.sh` stages new files and backs up every changed file in `.build-engine.txn/` before touching the tree, swaps files atomically, writes the lock last, and rolls back on failure. A hard kill is recovered automatically on the next run. Proven by interruption tests after every step and by SIGKILL tests (`tests/test_update_hardening.sh`).

### F0-016 — Path checks use the substring glob `*..*` (confirms R0-001)
- Severity: S3 (latent: no current file name contains `..`). Status: CONFIRMED (executed).
- Evidence: `docs/notes..v2.md` packaged successfully and was then rejected by `verify.sh` ("unsafe path in tar"). The same pattern appears in `package.sh:22`, `verify.sh:30` and three places in `update.sh`.
- Consequence: a legitimate file name containing two consecutive dots passes packaging and then blocks release, and would also make `update.sh` refuse the artifact.
- Required resolution: reject only a `..` path component (split on `/`), keep rejecting real traversal; add positive and negative tests.
- Owner: implementation. Planned phase: Phase 3 - 3.2.2, 3.4.2; and 2.4 for `update.sh`.
- Closure evidence: safe `a..b` name accepted; `../x` and `a/../b` rejected, in all three scripts.
- **Closed in Stage 3.2** (`PHASE-3.2-REPORT.md`): all three scripts now validate a path component by component
  instead of by substring - `release/package.sh`, `release/verify.sh` and the shipped `engine/bin/update.sh`. A name
  that merely contains two dots is accepted by all three, a `..` component is refused by all three. The three
  implementations are kept identical on purpose, and the self-test covers the packer, the verifier and the consumer
  side.
- (The `update.sh` part was closed first, in Phase 2.4; Stage 3.2 closed the packer and verifier parts.)

### F0-017 — Checksum sidecar proves integrity, not authenticity or provenance
- Severity: S3. Status: CONFIRMED by design (source).
- Evidence: `verify.sh` and `update.sh` check the tarball against a `.sha256` file published beside it. Anyone able to replace the tarball can replace the sidecar. No signature or attestation exists.
- Consequence: an updater cannot detect a replaced release; documentation must not describe the checksum as tamper-proof.
- Required resolution: Stage 3.3.8 provenance (source commit, version, checksum, workflow run). Claim no cryptographic attestation unless generated and verified; document the limitation plainly.
- Owner: implementation/operator. Planned phase: Phase 3 - 3.3.8; wording in Phase 2.1.4.
- Closure evidence: provenance record published; docs state exactly what the checksum does and does not prove.

### F0-018 — Shipped file modes are inconsistent: `operator/cbridge` and `operator/install.sh` are 0644
- Severity: S3. Status: CONFIRMED (executed: `tar tv`).
- Evidence: `engine/bin/update.sh` ships 0755 while `operator/cbridge` and `operator/install.sh` ship 0644; `update.sh` preserves modes with `cp -p`. The operator README instructs `chmod +x` after download.
- Consequence: the vendored copies cannot be run directly; the documented flow works only because it fetches a separate copy.
- Required resolution: decide the intended modes, set them explicitly (ties to F0-012), and make docs match.
- Owner: implementation. Planned phase: Phase 2.3 / 2.1.3 (docs), 3.1.4 (modes).
- Closure evidence: tarball modes match the manifest-declared modes; docs agree.
- **Partly closed in Stage 3.1** (`PHASE-3.1-REPORT.md`): `operator/cbridge` was already executable (Stage 2.3);
  `operator/install.sh` is now tracked as 100755 and ships 0755, and the shipped modes are normalised for every file
  (0644, or 0755 when the git index says 100755) - the policy is written down in `release/manifest.txt` and
  `docs/RELEASING.md`. Self-test: "the artifact ships exactly the three executables", "every packaged file ships 0644
  or 0755". The documentation side (the operator README telling the reader to `chmod +x` after download) is still open
  and belongs to Stage 2.1.3.

### F0-019 — Stale post-Stage-1.2 status text (compatibility field)
- Severity: S2 for documentation accuracy (Stage 2.1.3/2.1.4). Status: CONFIRMED (source).
- Evidence: `ENGINE.json` now carries `protocol: build-engine/0.5`, but `README.md` lines 192 and 202 and `docs/STATUS.md` lines 5, 21 and 127 still say `protocol`/`implements_abstract` is `UNSET` or must still be recorded; `docs/STATUS.md:21` still describes an "Abstract-PROJECT mapping".
- Consequence: contradictory status claims in the repository's own documents.
- Owner: documentation. Planned phase: Phase 2 - 2.1.3, 2.1.4. (2.1.2 stays out until release-candidate time.)
- Closure evidence: grep for stale terms returns only intentional uses (the `UNSET` sentinel in `COMPATIBILITY.md`).
- **Closed in Phase 2.1** (`PHASE-2.1-REPORT.md`): stale text corrected; the grep for stale terms is clean outside this register, the changelog and the plan.

### F0-020 — Stage 1.1 product contract contradicted the later decisions and is still marked DRAFT
- Severity: S1 for the Phase 1 exit gate. Status: CONFIRMED (source).
- Evidence: the merged `PHASE-1.1-PRODUCT-CONTRACT.md` says the write gateway "is out of scope" and the Class B path is not part of the first release; Stages 1.3 and 1.4 record the operator's decision that both gateways are in scope and mandatory. The contract also says the `implements_abstract` decision is still open.
- Resolution (this PR): contract redrafted to match the operator decision; approval still required.
- Owner: operator (approval). Planned phase: Phase 1.1 (re-submitted here); Phase 2 may not start until approved.
- Closure evidence: operator approval recorded on the redrafted contract.

### F0-021 — Reference gateway lint
- Severity: S3. Status: CONFIRMED (executed: pyflakes).
- Evidence: `gateway/read/reference/ctxgate.py:30` imports `ctxlink.SCHEME` and `ctxlink.mint` without using them.
- Owner: implementation. Planned phase: Phase 4 (reference/production alignment). Not shipped.

### F0-022 — Write-gateway development dependencies carry known advisories
- Severity: S3 (dev tooling only; `npm audit --omit=dev` reports 0). Status: CONFIRMED (executed: `npm audit`).
- Evidence: 3 advisories (1 high, 2 moderate) via `wrangler 4.149.0` -> `miniflare` -> `undici`, including denial-of-service and subresource-integrity issues in `undici`; `npm audit` lists `wrangler@4.153.0` as the fixed version, which is newer than the pin.
- Owner: implementation. Planned phase: Phase 3 - 3.3.2 (dependency audit), and 5.5.1 when the test runner is pinned.
- Closure evidence: clean `npm audit` at the chosen pins or a documented accepted exception.

### F0-023 — Release workflow does not enforce all gates it relies on (confirms R0-003)
- Severity: S2. Status: CONFIRMED (source: `.github/workflows/release.yml`).
- Evidence: the release job re-runs tests but not the shell-syntax or write-gateway checks, has no `needs` dependency on the `ci` workflow, grants `contents: write` for the whole workflow, and its tag check (`merge-base --is-ancestor`) accepts any commit reachable from `main`, not only its tip. Third-party actions in both workflows are pinned to mutable tags (`actions/checkout@v4`, `actions/setup-python@v5`, `actions/setup-node@v4`), not commit SHAs.
- Owner: implementation/administrator. Planned phase: Phase 3 - 3.3.3, 3.3.4, 3.3.5, 3.3.6, 3.3.7.
- Closure evidence: a tag on a commit with failed or missing CI publishes nothing, shown by a dry-run test.

## A4. Additional confirmed findings (Stage 2.2 plan/order tooling audit, follow-up to PR #10, 2026-10-26)

IDs F0-050 onward, to avoid collisions with parallel branches. Every item was reproduced by execution against `main` before the fix (probes and a schema-wide fuzz), and each now has a regression test in `template/engine/tools/test_plan_tool_hardening.py`; run against the pre-fix tools those tests produced 22 failures and 16 errors. PR #10 had already made `write_json` atomic, aligned `safe_rel` and required a 40-hex ref in `context_urls`; items marked "(partly #10)" were completed here.

### F0-050 — A task file with a duplicate id was silently ignored
- Severity: S2. Status: CONFIRMED (executed) and CLOSED. Evidence: two files declaring the same `id` loaded as one task and `check` passed. Resolution: reported as an error by `check`; `order`, `render` and `next` refuse.

### F0-051 — Only `write_json` was atomic (partly #10)
- Severity: S2. Status: CONFIRMED and CLOSED. Evidence: `PLAN.md`, `CONCURRENCY.md`, order files and the plan scaffold were still written in place. Resolution: all writes go through an atomic temp-file-and-rename helper that preserves file mode and creates parent directories.

### F0-052 — Concurrent `order --write` runs lost work orders
- Severity: S2. Status: CONFIRMED (executed: in 19 of 20 paired runs one order was overwritten because both took the same submission id) and CLOSED. Resolution: a per-plan lock held by every writing command (waits up to `PLAN_LOCK_TIMEOUT`, default 15 s, then reports clearly) and exclusive creation of order files.

### F0-053 — A failure part-way through a multi-file command left partial state
- Severity: S2. Status: CONFIRMED (executed) and CLOSED. Evidence: with the second task save failing, `order --write --start` left the order file and one task in progress. Resolution: a rollback transaction restores every file already written (also for `decide`; `new` is built in a temporary directory and moved into place; the plan counter is bumped last).

### F0-054 — `order` accepted moving refs and mislabelled the result as pinned (partly #10)
- Severity: S1 for the "pinned context" invariant. Status: CONFIRMED (executed) and CLOSED. Evidence: `--ref main` and `--plan-ref main` were accepted. Resolution: both must be full 40-hex commit ids; `context_ref_pinned` is always true because nothing else is accepted; gateway link minting can no longer meet an unpinned ref.

### F0-055 — Order hashes came from the working tree, not the pinned commit
- Severity: S2. Status: CONFIRMED (executed: an uncommitted edit changed the hash, which no longer matched the file served at the pinned commit) and CLOSED. Resolution: hashes and "current file" edit items are computed from `git cat-file blob <ref>:<path>`; an uncommitted file is not offered; a non-git target is refused.

### F0-056 — `order` did not validate the plan (partly #10)
- Severity: S2. Status: CONFIRMED (executed) and CLOSED. Evidence: a plan with a schema-invalid `plan.json`, or a context path `../secret.txt`, still produced an order and hashed a file outside the target checkout. Resolution: `order`, `render` and `next` refuse a plan that fails `check`; context paths are validated again where the URL is built.

### F0-057 — Wrong-typed input crashed with raw tracebacks and unstable exit codes
- Severity: S2. Status: CONFIRMED (executed: a fuzz of every schema field with wrong types or removed fields, run across `check`, `render`, `next`, `plans`, `order`, found crashes in several commands, including non-object entries in `decisions.json`, a non-list `tasks` in `SUBMISSION.json`, and `render` on a schema-invalid plan) and CLOSED. Resolution: loaders and `check_plan` validate shape first; unexpected errors print one clear line and exit 70 (`PLAN_DEBUG=1` shows the traceback); exit codes are documented (0, 1, 2, 70, 130). The fuzz is now a permanent test.

### F0-058 — Trailing newlines were accepted in identifiers
- Severity: S2. Status: CONFIRMED (executed) and CLOSED. Evidence: `$` anchors accepted `x\n` as a plan id (creating a directory) and `ref + "\n"` in `ctxlink.mint`, which produced a link containing a newline. Resolution: full-match semantics everywhere; control characters are rejected in link paths.

### F0-059 — Link lifetime was unbounded
- Severity: S2. Status: CONFIRMED (executed: ttl 0, -5 and 1,000,000,000 minted) and CLOSED. Resolution: `ctxlink.mint` accepts 1 to 259200 seconds (decision 0003, 72 hours) and `plan_tool` validates `ttl_seconds` even for orders without links.

### F0-060 — Reference gateway default maximum link lifetime contradicts decision 0003
- Severity: S3. Status: CONFIRMED (source: `ctxgate.py` defaults `max_ttl` to 7 days). Not changed here; belongs to Phase 4 (`gateway/read`), which has open PRs.

### F0-061 — Identifier arguments were used unvalidated inside file paths
- Severity: S3. Status: CONFIRMED and CLOSED. Evidence: `links`, `check-submission` and `--rework-of` accepted `../` forms. Resolution: order and submission ids must match `NNNNN-SNNN`; order files read back from disk are schema-validated.

### F0-062 — Product-specific wording remained in the shipped tool
- Severity: S3. Status: CONFIRMED and CLOSED. A docstring, a comment and an error message named one project; they are neutral now.

### R0-018 — The plan lock is per machine
- Severity: S3; Status: ACCEPTED, documented. It prevents two processes on one machine from corrupting a plan; it does not coordinate two machines, where git merge conflicts remain the safety net.

### R0-019 — A pinned commit that was never pushed cannot be detected offline
- Severity: S3; Status: ACCEPTED. `order` proves the commit and files exist in the local checkout, not that the remote has them; agents would get 404s.

### R0-020 — Path normalisation (Unicode form, case) is not specified for links
- Severity: S3; Status: OPEN, owned by the conformance vectors (Stage 4.1). The signing test now compares against an independent implementation for spaces, accents, `%`, `+`, `?`, `#`, emoji and 20-level paths and agrees.

## A3. Additional confirmed findings (Stage 2.4 install/update audit, 2026-10-26)

IDs F0-040 onward are used here to avoid collisions with entries added by parallel branches. Evidence: the new `tests/test_update_hardening.sh` run against the previous `update.sh` failed 58 of 147 checks; the items below are the ones demonstrated by execution.

### F0-040 — The updater wrote through a symlinked managed directory, outside the repository
- Severity: S1. Status: CONFIRMED (executed) and CLOSED in Phase 2.4.
- Evidence: with `docs` a symlink to a directory outside the repository, the previous `update.sh` installed 10 files into that outside directory.
- Resolution: managed and seed paths, and every directory component, are checked before any change; symlinks, directories where files belong and files where directories belong are refused, even with `--force`.

### F0-041 — An artifact whose contents are a different version than requested was accepted
- Severity: S2. Status: CONFIRMED (executed) and CLOSED.
- Evidence: a 0.5.1 artifact packaged as `v0.5.9` installed, recorded `version=0.5.9` in the lock while `engine/VERSION` said 0.5.1.
- Resolution: the artifact's `engine/VERSION` must equal the requested version.

### F0-042 — Release manifests and archives were validated too loosely
- Severity: S2. Status: CONFIRMED (executed) and CLOSED.
- Evidence: unknown modes, duplicate paths, `a/./b`, backslash paths, short or uppercase hashes and an empty manifest were all accepted by the previous updater.
- Resolution: strict manifest parsing (64 lowercase hex, mode `managed` or `seed`, safe unique paths, non-empty), plus the existing non-regular-entry and unlisted-file checks, all tested with crafted archives.

### F0-043 — A damaged lock file caused a cryptic shell error instead of a clear refusal
- Severity: S3. Status: CONFIRMED (executed) and CLOSED.
- Resolution: the lock is parsed strictly; any damage stops the run before changes, with recovery instructions. Seven damage variants are tested.

### F0-044 — Pruning removed the consumer's `plans/` directory
- Severity: S2. Status: CONFIRMED (executed) and CLOSED.
- Evidence: a release that drops `plans/README.md` made the previous updater remove an otherwise empty `plans/` through `rmdir -p`.
- Resolution: only nested directories (depth 2 or more) that release files emptied are pruned.

### F0-045 — Option values were not validated
- Severity: S3. Status: CONFIRMED (executed) and CLOSED.
- Evidence: `--repo --web`, `--repo a/b/c`, `--repo '../x'` and an empty `--version` were accepted or produced raw shell errors.
- Resolution: `--repo` must be `OWNER/NAME`; empty or missing option values report "needs a value".

### R0-016 — Residual risks of the updater transaction
- Severity: S3; Status: ACCEPTED, documented. After a hard kill, `.build-engine.txn/` stays in the working tree (untracked) until the next run recovers it, so it must not be committed; the live-process check uses the saved process id and can be wrong across PID namespaces; the bash 4.4+ requirement is tested on this environment's bash only.
- Planned phase: Stage 3.3 (CI matrix) for the bash versions; documented in the README.

### R0-017 — `tests/test_cbridge.sh` (Stage 2.3) is not run by CI
- Severity: S2; Status: CONFIRMED (source: neither `.github/workflows/ci.yml` nor `release.yml` mentions it).
- Evidence: the 36-check operator-bridge suite added in Stage 2.3 exists but no workflow executes it, so a regression in `cbridge` would not turn CI red. (In an environment without `jq`, 8 of its checks fail identically on pristine `main`; that is an environment gap, not a defect.)
- Required action: run it from `tests/test_update.sh` (as done for the updater hardening suite) or add a CI step; make its `jq` dependency explicit in the CI job.
- Owner: implementation. Planned phase: Stage 3.3.1 / 3.4.3.

## A5. Findings from Stage 3.1 (allowlist packaging), 2026-10-27

Found while validating the packaging path for Stage 3.1, audited commit `99a5a73` (main after Stage 2.3). All four are
CONFIRMED by an executed baseline run (the commands and their output are in `docs/release/PHASE-3.1-REPORT.md`), and all
four are closed by that stage. They were not in A2 because A2 audited the baseline before this stage looked at
`release/package.sh` in detail.

### F0-036 — The duplicate/conflicting manifest declaration check never ran
- Severity: S2. Status: CONFIRMED (executed). **Closed in Stage 3.1.**
- Evidence: `release/package.sh` expanded the manifest into a `<mode> <path>` list and then ran
  `LC_ALL=C sort -u -k2` on it. `-u` removes every line whose *key* (the path) is already present, so a path declared
  twice was collapsed to one line **before** the check `sort "$WORK/files" | uniq -d | wc -l` ran - and that check
  could then never find a duplicate. A path declared as both `managed` and `seed` was silently resolved to one mode
  (`managed` sorts first), and the conflict was invisible.
- Executed at the baseline: appending `seed engine/VERSION` to the manifest produced a successful build whose release
  manifest listed `engine/VERSION` once, as `managed`.
- Consequence: the allowlist could not express the two things it is for - a single ownership mode per path, and a
  refusal when the same file is claimed twice. A seed file could be claimed as managed and the artifact would ship it
  as managed, overwriting consumer configuration on update.
- Required resolution: validate the manifest declarations before the expansion, and refuse a path that is declared
  twice, declared with two different modes, or equal to another path under case folding.
- Owner: implementation. Planned phase: Phase 3 - 3.1.2.
- Closure evidence: a duplicate, a managed/seed conflict and a case-folded duplicate are each refused with a message
  that names the path. Self-test: "a path declared twice is refused", "a path declared managed and seed is refused",
  "a case-folded duplicate is refused".

### F0-037 — A failed build left a partial artifact that looked like a finished one
- Severity: S2. Status: CONFIRMED (executed). **Closed in Stage 3.1.**
- Evidence: `release/package.sh` wrote the tarball straight into `$OUT/$NAME` with a shell redirect, and wrote the
  sidecar afterwards. A failure during the archive write left the truncated file in place under the exact name of the
  expected artifact, with no sidecar to mark it as incomplete.
- Executed at the baseline: with the file size capped (`ulimit -f 64`), the build failed and left a 65536-byte
  `dist/build-engine-v0.5.0.tar.gz` behind.
- Consequence: an operator or a workflow that picks up "the artifact" by name could publish or install a truncated
  archive. The missing sidecar makes `verify.sh` fail, but only if it is run.
- Required resolution: remove any previous artifact before the build starts, write the new one to a temporary file,
  and move it into place only when it is complete.
- Owner: implementation. Planned phase: Phase 3 - 3.1.5.
- Closure evidence: after a failed build the output directory holds no file named like the artifact. Self-test: "a
  failed build leaves no artifact behind".

### F0-038 — The output directory could sit inside the packaged tree
- Severity: S2. Status: CONFIRMED (executed). **Closed in Stage 3.1.**
- Evidence: `release/package.sh` accepted any output directory, including one under `template/`. Because the allowlist
  expansion used `find` over a manifest-listed directory, an artifact written there was picked up by the next build.
- Executed at the baseline: building into `template/docs/dist` twice produced an artifact that contained the previous
  artifact (`docs/dist/build-engine-v0.5.0.tar.gz`) and its sidecar.
- Consequence: the artifact could contain a previous artifact - a growing, self-referential archive, and a file that
  should never reach a consumer.
- Required resolution: refuse an output directory inside the packaged tree.
- Owner: implementation. Planned phase: Phase 3 - 3.1.5.
- Closure evidence: the build is refused with the two paths named. Self-test: "an output directory inside the packaged
  tree is refused".

### F0-039 — A tracked generated file was silently dropped from the artifact
- Severity: S3. Status: CONFIRMED (executed). **Closed in Stage 3.1.**
- Evidence: the expansion filtered `__pycache__` and `*.pyc` out of the file list, so a file that was **tracked** in
  `template/` simply disappeared from the artifact. The build reported success and said nothing about it.
- Executed at the baseline: a tracked `template/docs/junk.pyc` produced a successful build with no `.pyc` in the
  artifact and no warning.
- Consequence: the artifact and the repository disagreed, and the difference was invisible. A tracked `.pyc` is also a
  sign that a build artefact was committed by mistake.
- Required resolution: refuse a tracked file that must not be in a consumer artifact (a `.pyc`, a `node_modules/` tree,
  a `.env`, an archive, an editor backup) instead of quietly excluding it. A file that is merely untracked and ignored
  by `.gitignore` stays excluded without failing the build: `.gitignore` is the maintainer's own statement that the file
  is not part of the tree.
- Owner: implementation. Planned phase: Phase 3 - 3.1.2.
- Closure evidence: a tracked generated file stops the build with the path named. Self-test: "a tracked generated file
  stops packaging", "a tracked node_modules tree stops packaging".

## A6. Findings from Stage 3.2 (independent verification), 2026-10-27

Found while hardening the verifier for Stage 3.2, audited commit `3149df0` (Stage 3.1). All five are CONFIRMED by an
executed baseline run or by reading the verifier's own control flow, and all five are closed by that stage.

### F0-065 — The checksum sidecar did not have to describe the artifact it accompanied
- Severity: S2. Status: CONFIRMED (executed). **Closed in Stage 3.2.**
- Evidence: `release/verify.sh` ran `sha256sum -c "$base.sha256"`, which verifies whatever files the sidecar names.
  Nothing checked that the sidecar named *this* artifact, so a sidecar that described a different file - one that
  existed and matched - left the artifact itself unverified.
- Executed at the baseline: a sidecar naming a copy of the artifact under another name, with that copy present in the
  directory, produced `verify: OK (build-engine-v0.5.0.tar.gz: 41 files, version 0.5.0)`. The artifact had not been
  checked at all.
- Consequence: the checksum check could pass without the artifact ever being checked, which is exactly the
  guarantee the step exists to provide. (It is not an authenticity problem - F0-017 already records that the
  sidecar proves integrity, not provenance - but the step did not do what it said.)
- Required resolution: the sidecar must hold exactly one line, and that line must name the artifact being verified.
- Owner: implementation. Planned phase: Phase 3 - 3.2.1.
- Closure evidence: Self-test: "a sidecar that describes another file is refused", "a missing checksum sidecar is
  refused", "a tampered artifact fails its checksum".

### F0-066 — A duplicate archive member was only caught as a side effect, and the release manifest could be duplicated unnoticed
- Severity: S3. Status: CONFIRMED (executed). **Closed in Stage 3.2.**
- Evidence: the verifier compared the archive's member list with the release manifest's paths, so a member that
  appeared twice made the two lists differ and the artifact was refused - but with the message "artifact files and
  release manifest disagree", which describes a different problem. One member was excluded from that comparison:
  `engine/RELEASE-MANIFEST`, the file that describes the archive. A member duplicated under that name passed every
  check.
- Executed at the baseline: an archive with `engine/RELEASE-MANIFEST` listed twice and identical content produced
  `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0)` - a 41-file artifact, reported as 42 files,
  whose own description of itself was present twice.
- Consequence: the archive's contents were ambiguous, and the verifier's own report did not describe the archive it
  had checked. R0-002 listed the identical-content duplicate as untested; it is now tested and refused, for the
  right reason.
- Required resolution: refuse an archive that lists the same member name twice, and refuse two members that are
  equal under case folding.
- Owner: implementation. Planned phase: Phase 3 - 3.2.1.
- Closure evidence: Self-test: "a duplicate archive member is refused".

### F0-067 — The forbidden content rules could be bypassed
- Severity: S2. Status: CONFIRMED (executed). **Closed in Stage 3.2.**
- Evidence: two separate bypasses of `release/forbidden.txt`.
  (a) The gateway patterns were anchored to the start of a line (`^class Gateway[(:]`, `^def make_server\(`), so a
  copy of the gateway with the code indented - inside a class, a function, or simply re-indented - was not caught by
  any rule, and the gateway's own directory and file names no longer matched either.
  (b) The content rules were matched with `grep -rI`, which skips any file that contains a NUL byte. A credential
  placed in such a file was not detected at all.
- Executed at the baseline: an indented `class Gateway:` was not caught by any rule (`verify: OK`), and a file
  containing a NUL byte and a `ghp_` token was not caught either (`verify: OK`).
- Consequence: the second line of defence could be walked around by two small changes to a copied file.
- Required resolution: match the gateway patterns anywhere in a line, and match the content rules against binary
  files as well.
- Owner: implementation. Planned phase: Phase 3 - 3.2.4.
- Closure evidence: Self-test: "an indented copy of the gateway code is caught", "a copy of the gateway entry point
  is caught", "a credential in a binary file is caught".

### F0-068 — The release manifest inside the artifact was never validated for its own shape
- Severity: S3. Status: CONFIRMED (executed). **Closed in Stage 3.2.**
- Evidence: `release/verify.sh` compared the manifest's path set with the artifact's file set, so most contradictions
  between the two were caught - but as a set mismatch, and the message named a different problem. Executed at the
  baseline, one malformed manifest at a time:
  - a duplicated entry -> "artifact files and release manifest disagree" (caught, wrong diagnosis);
  - an entry with an extra field -> "manifest lists a file that is not in the artifact: docs/CONTEXT-EXPORT.md
    surprise" (caught, wrong diagnosis);
  - a malformed hash -> "hash mismatch: docs/CONTEXT-EXPORT.md" (caught, but the hash was never checked for being a
    hash);
  - two entries equal under case folding -> "artifact files and release manifest disagree" (caught, wrong diagnosis);
  - **a manifest with no header at all -> `verify: OK`** (accepted).
  Nothing validated the manifest's shape: the header was not required, the field count was not checked, and a hash
  was only ever compared, never parsed.
- Consequence: the manifest is the artifact's own description of itself, and the consumer's `update.sh` reads it. A
  contradiction was usually caught, but the tool never said what was wrong with it, and one contradiction - a manifest
  with no header - was not caught at all.
- Required resolution: validate the header, the field count, the hash format, the mode, the path shape, and the
  uniqueness of the entries (exactly and under case folding), each with its own message.
- Owner: implementation. Planned phase: Phase 3 - 3.2.3.
- Closure evidence: Self-test: "a release manifest with a duplicate entry is refused", "a release manifest with a
  malformed hash is refused", "a release manifest with a bad mode is refused", "a release manifest with an unexpected
  field is refused", "a release manifest listing a missing file is refused", "a release manifest without a header is
  refused".

### F0-069 — The allowlist was not validated by the verifier
- Severity: S3. Status: CONFIRMED (source). **Closed in Stage 3.2.**
- Evidence: `release/verify.sh` read `release/manifest.txt` and used it to decide what is allowed, but never checked
  the file itself. An allowlist that declared a path twice, or two paths equal under case folding, or an unsafe
  path, was used as a policy without complaint. Stage 3.1 made the packer refuse such a manifest; the verifier, which
  reads the same file independently, did not.
- Consequence: the verifier and the packer could disagree about what a manifest means, and the verifier - the tool a
  consumer runs - would accept a policy the packer would reject.
- Required resolution: the verifier validates its own policy input.
- Owner: implementation. Planned phase: Phase 3 - 3.2.3.
- Closure evidence: Self-test: "an allowlist that declares a path twice is refused", "an allowlist with a case-folded
  duplicate is refused", "an allowlist with an unsafe path is refused".

## B. Risks and verification gaps (not proven defects)

### R0-001 — Path validation may reject safe names containing `..`
- Status: **SUPERSEDED by F0-016** (now confirmed by execution). Original text retained in PR #1 history.

### R0-002 — Archive and manifest adversarial cases need executed evidence
- Severity: S2; Status: RISK TO TEST.
- Cases: duplicate archive entries; symlink, hardlink and special entries; duplicate manifest paths; omitted/unlisted files; malformed checksums; path normalization.
- Executed so far (A2): a duplicate archive member with different content is rejected by `verify.sh` (hash mismatch); a filename containing a newline makes `package.sh` fail closed (exit 2). **Still untested:** symlink/hardlink/special entries, truncated archives, duplicate manifest paths, malformed checksum lines, identical-content duplicate members.
- Required action: run or add negative tests for the remaining cases and record outputs (Stage 3.2.1, 3.2.3, 3.4.1).
- Planned phase: Phase 3.

### R0-003 — Release workflow dependency on all required CI checks is unproven
- Status: **SUPERSEDED by F0-023** (confirmed from workflow source).

### R0-004 — Repository branch/tag protections are absent; Actions settings permissive
- Severity: S2; Status: CONFIRMED (verified 2026-10-26 via GitHub API with an operator-supplied token).
- Evidence: `GET branches/main/protection` returned 404 "Branch not protected"; `GET rulesets` returned an empty list (so no tag rules either); `GET actions/permissions` returned `allowed_actions: all`, `sha_pinning_required: false`. Environment approvals and the default workflow-token permission were not checked.
- Consequence: nothing server-side enforces PRs, required checks or tag restrictions; plan R-10 and Stage 3.3.7 are unmet today. Plan G-05 (branch + PR per work package) is currently convention only.
- Required action: configure protection/rulesets for `main` and `v*` tags (require PR, required `ci` check, restrict tag creation) and evidence it; decide on Actions allow-list and SHA pinning (Stage 3.3.3).
- Owner: repository administrator. Planned phase: Phase 3 (3.3.7); may be done earlier.

### R0-005 — GET-based mutation may expose payloads or trigger unintended side effects
- Severity: S1 for production write-gateway acceptance; Status: DESIGN DECISION.
- Risk: query strings can be captured by logs, history, caches, prefetchers, and observability systems; GET semantics may be replayed or triggered unexpectedly.
- Required action: explicitly accept a documented residual risk with mitigations or redesign the protocol before production deployment.
- Planned phase: Phase 1 decision; Phase 5 implementation.

### R0-006 — Repository credential is not inherently folder-scoped
- Severity: S1 for production write-gateway threat model; Status: DESIGN RISK.
- Risk: server-side path checks do not limit a repository token's blast radius if compromised.
- Required action: assess a dedicated submission repository or isolated repository/branch and fixed server-enforced destination; document least privilege.
- Planned phase: Phase 1/5.
- Update (A2): Stage 1.4.6 originally chose the existing private repository with path allow-listing only. **Operator decision 2026-10-26: not accepted; Stage 1.4.6 amended to a dedicated isolated submissions repository and branch**, with the branch and task folder pre-created and never created by the gateway. Residual risk is now limited to the submissions repository. Closure evidence: Phase 5.1.6 contract and a credential-scope check (`scripts/check-token-scope.ts`) in Phase 5.

### R0-011 — Submissions-to-consumer transfer path and pre-creation tooling are undefined
- Severity: S1 for the approved workflow; Status: DESIGN GAP (consequence of the amended Stage 1.4.6).
- Evidence: with an isolated submissions repository, accepted deliverables must move into the private consumer repository, and the operator must create the submissions branch and the task folder (with a placeholder file) before issuing a work order. `RELEASE-PLAN.md` has no stage for either; `cbridge upload/sync` currently targets the consumer repository only.
- Required action: operator decision to add both items to the plan (Stage 5.1 contract and Stage 2.3 / 6.2 tooling); define placeholder-file handling and the error for a missing folder; test in the Phase 6 pilot.
- Owner: operator (plan change), implementation. Planned phase: Stage 5.1 and 2.3 (to be added), 6.2.

### R0-007 — Ephemeral staging and ambiguous commit outcomes need a recovery model
- Severity: S2; Status: DESIGN RISK.
- Risk: staging may disappear on isolate eviction; a timeout can occur after a provider commit succeeds but before the response arrives.
- Required action: define and test recovery states including not committed, committed-but-response-lost, sealed, revoked, and unknown/reconcile-required.
- Planned phase: Phase 5/6.

### R0-008 — Worker deployment defaults not pinned
- Severity: S2; Status: RISK TO TEST (source only).
- Evidence: `wrangler.toml` leaves `routes`/`workers_dev` unset ("intentionally unset until a deployment decision") and pins `compatibility_date = "2025-09-01"`. A first deploy could expose a public `workers.dev` URL by default, and the runtime date is over a year old.
- Required action: set `workers_dev` and routes explicitly per the staging/production decision; review and bump the compatibility date deliberately; test the dry-run output.
- Planned phase: Phase 4/5 deployment stages (5.4.6, 5.1.6).

### R0-009 — Updater can silently downgrade
- Severity: S3; Status: RISK TO TEST (source only).
- Evidence: `update.sh` records `LOCK_VERSION` but never compares it with the target version.
- Required action: refuse or warn on a lower version unless a flag is passed; add a test.
- Planned phase: Phase 2.4 (2.4.5 "wrong version").
- **Closed in Phase 2.4:** a downgrade is refused unless `--allow-downgrade` is passed (tested).

### R0-010 — Updater path handling around symlinks and empty parents
- Severity: S3; Status: RISK TO TEST (source only).
- Evidence: `cp -p` writes through a symlinked destination directory; `rmdir -p` removes empty ancestor directories of dropped files, which may include consumer-owned empty directories.
- Required action: refuse symlinked managed paths; remove only directories the lock file recorded.
- Planned phase: Phase 2.4 (2.4.2, 2.4.5).
- **Closed in Phase 2.4:** any managed path through a symlink, over a directory, or under a non-directory is refused before any change (even with `--force`); only nested directories that release files emptied are pruned, never top-level ones such as `plans/`.

## C. Release scope classification — proposed for operator approval

| Capability | Proposed classification | Reason / gate |
|---|---|---|
| Consumer package, checksum, artifact verification, install/update | REQUIRED FOR FIRST RELEASE | Existing release machinery and CI exercise this path; release-mode gate still blocked by F0-001/F0-002. |
| Operator-controlled plan/order/context-link tooling and `cbridge` workflow | REQUIRED FOR FIRST RELEASE, subject to acceptance tests | Core shipped workflow; verify against documented claims and consumer tests. |
| Production Class B read gateway | **REQUIRED for the first release (operator decision 2026-10-26; Stage 1.3)** | Not started; Phase 4. |
| Agent-side write gateway | **REQUIRED for the first release (operator decision 2026-10-26; Stage 1.4)** | Scaffold only; Phase 5. |
| Shared conformance harness | **REQUIRED** (gates the read gateway exit, Stage 4.1) | Current vectors/harness incomplete. |
| Real end-to-end pilot | **REQUIRED** (Phase 6) | Pilot not started. |
| Object-storage variant | REJECTED | Explicitly rejected in Stage 1.3. |

This table was a proposal in PR #1. The gateway, conformance and pilot rows now reflect the operator's decision recorded in Stages 1.3 and 1.4. No capability should be described as fully working unless its acceptance evidence exists or the capability is explicitly excluded/qualified in the release documentation.

## D. Baseline evidence recorded

- Inspected `main` commit: `b45e8008adcaa179165abf24880e8eda0eb7c515` (observed 2026-10-26).
- Version: `0.5.0`.
- Latest inspected GitHub Actions run: `https://github.com/inscope-labs/build-engine/actions/runs/40317887672`; both configured jobs passed, including tests, shell syntax, release machinery self-test, consumer install/update flow, package/verify dry run, write-gateway typecheck and bundle dry run.
- Release manifest: all 12 manifest entries existed in the inspected remote tree. This checks path presence only; it does not prove every archive edge case.
- No published GitHub releases were listed at the time of inspection.
- Local baseline commands were run on 2026-10-26 at `ee654cd`: all 7 documented commands exit 0 (exact commands, environment and results in `docs/release/PHASE-0-BASELINE.md`). This supersedes the earlier "not run" note.
- `release/verify.sh dist/build-engine-v0.5.0.tar.gz --release` was run locally: exit 1, `ENGINE.json implements_abstract is UNSET` (confirms F0-001 as executed evidence).
- Branch protection/settings: verified via API on 2026-10-26: main unprotected, no rulesets (see R0-004).

## E. Phase 0 closure conditions

Phase 0 is **not formally closed** until all of the following are satisfied:

1. This register and the requirement-to-test traceability document are committed to the repository: submitted in this PR; satisfied on merge.
2. ~~Baseline test evidence is recorded~~ DONE in this PR: `PHASE-0-BASELINE.md` records command, environment, exit code and output for all 7 commands. CI-step-to-command mapping is not yet independently verified.
3. Repository protection settings: now verified as absent (R0-004). Operator either configures them now or records an approved exception deferring to Phase 3.3.7.
4. Operator reviews and approves the defect register and proposed release scope, or records required changes.
5. Every finding is classified with an owner, planned phase, and closure evidence; no untested suspicion is represented as a confirmed defect.
6. Addendum A2 (extended audit) and the stage ownership index (section F) are reviewed by the operator.

No release-blocker metadata has been changed, no release has been published, and no later-phase implementation is claimed complete.

## F. Stage ownership index (every finding to the plan stage that closes it)

| Finding | Closed in | Notes |
|---|---|---|
| F0-001, F0-007 | Phase 1.2 (done) + 2.1.1 | Field migrated to `protocol`; remaining doc sync in F0-019 |
| F0-002 | Phase 2.1.2 / 7.1 | Only at release-candidate time |
| F0-003 | Phase 4 (4.1-4.3) | Production read gateway, conformance, deployment |
| F0-004, F0-009 | Phase 5 (5.1-5.5) | Write gateway, all stub source/tests/scripts/CI; exit gate forbids stubs |
| F0-005 | Phase 4.1 | Vectors and harness |
| F0-006 | Phase 6 | Real pilot |
| F0-008 | This PR + 3.3.1/3.4.3 | Fix now, guard later |
| F0-010, F0-017, F0-023 | Phase 3 | F0-010 **closed in Stage 3.2**; F0-017 and F0-023 stay (3.3.3-3.3.8) |
| F0-016 | Phase 3 - **closed in Stage 3.2** | The path check is component-wise in the packer, the verifier and the shipped updater |
| F0-011, F0-012, F0-013, F0-018 | Phase 3 - **closed in Stage 3.1** | Packaging: tracked sources, normalised modes, case-fold rule, shipped modes. F0-013's verification half stays in 3.2.3; F0-018's documentation half in 2.1.3 |
| F0-014, F0-015, R0-009, R0-010 | Phase 2.4 | Install/update (F0-014 needs an operator decision) |
| F0-036 to F0-039 | Phase 3 - **Stage 3.1** | Found and closed in Stage 3.1: dead duplicate check, partial artifact, output inside the packaged tree, silently dropped generated file |
| F0-065 to F0-069 | Phase 3 - **Stage 3.2** | Found and closed in Stage 3.2: misdirected sidecar, duplicate members, forbidden-rule bypasses, unvalidated release manifest, unvalidated allowlist |
| F0-040 to F0-045, R0-016 | Phase 2.4 | Closed; R0-016 accepted. (Updater findings. The Stage 3.2 verifier findings are F0-065 to F0-069.) |
| F0-019 | Phase 2.1.3-2.1.4 | Documentation |
| F0-020 | Phase 1.1 (this PR) | Needs operator approval |
| F0-021, F0-022 | Phase 4 / 3.3.2 | Lint and dev dependencies |
| R0-002 | Phase 3.2.1, 3.2.3, 3.4.1 | Remaining adversarial cases |
| R0-004 | Phase 3.3.7 (or earlier by operator) | Branch/tag protection absent |
| R0-005 to R0-007 | Phase 1.4 (decided) + 5 | Implementation and tests |
| R0-011 | Stage 5.1 and 2.3 (to be added to the plan), 6.2 | Needs operator approval of the plan change |
| F0-050 to F0-059, F0-061, F0-062 | Phase 2.2 (PR #10 plus this follow-up) | Closed; F0-060 and R0-020 belong to Phase 4 |
| R0-008 | Phase 5.4.6 / 5.1.6 | Deployment defaults |

## G. Audit method and coverage (what "complete" can and cannot mean)

This register lists every defect known at the audited commit. It cannot prove that no other defect exists; it records what was examined so gaps are visible, and the process is that any later finding is appended here with an ID, evidence and owning stage before it is fixed (G-03, G-10).

Examined in A2: all of `release/*` (read in full, edge cases executed), `template/engine/bin/update.sh` (read in full), both GitHub workflows, `gateway/write` (every source, test, script, CI, config and package file inventoried), `docs/` and `template/` links (no broken relative links found), shell static analysis (shellcheck: no warnings at warning level on `release/`, `tests/`, `update.sh`, `install.sh`, `cbridge`), Python static analysis (pyflakes: 2 unused imports; bandit: no medium-or-higher issue in shipped code), `npm audit`, Phase 1 documents against each other.

Run and passing at the audited commit after this PR's fix: shipped tool tests (70), reference gateway tests (15), release self-test (22), update test (22), package, verify, write-gateway typecheck and bundle.

Not audited line by line (covered only by their existing tests and static analysis): `template/engine/tools/plan_tool.py` (1236 lines), `template/operator/cbridge` (309 lines), `template/engine/tools/ctxlink.py`, `gateway/read/reference/ctxgate.py`. Stages 2.2.1 and 2.3.1 are the dedicated audits for these; anything they find is appended as F0-0xx.

Not verifiable from this environment: macOS behaviour (F0-014), environment approvals and the default workflow token permission (R0-004).
