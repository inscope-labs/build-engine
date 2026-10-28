# Build Engine — Phase 0 Defect Register

- Repository: `https://github.com/inscope-labs/build-engine`
- Baseline branch: `main`
- Inspected baseline commit: `b45e8008adcaa179165abf24880e8eda0eb7c515` (remote review); local command baseline run at `ee654cddeb9bd00043230942d89c8df955ea3afc` (adds only `RELEASE-PLAN.md`; see `PHASE-0-BASELINE.md`)
- Version: `0.5.0`
- Baseline date: 2026-10-26
- Status: **Addendum A2 (extended audit) submitted for operator review; the original register was merged in PR #1. Stage 5.2 added F0-033 (closed), Stage 5.3 added F0-034 (closed), Stage 5.4 added F0-035 (closed) and Stage 5.5 added F0-063 and F0-064 (both closed)**
- Addendum date: 2026-10-26; audited commit `35172ab` (main after Phase 1 PRs #2-#5)
- Stage 5.2 addendum: 2026-10-27; F0-033, found by the concurrency test of Stage 5.2 and closed in it
- Stage 5.3 addendum: 2026-10-27; F0-034, found while the commit was being implemented and closed in it
- Stage 5.4 addendum: 2026-10-27; F0-035, found by the sentinel injection and closed in it
- Stage 5.5 addendum: 2026-10-27; F0-063, found by the adversarial input suite of Stage 5.5 and closed in it; F0-064, `main`'s release manifest, found when the Stage 5.5 branch merged `main` and closed in it

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
- Status: CONFIRMED. **The core request and session lifecycle is implemented in Stage 5.2 and the GitHub delivery in Stage 5.3** (2026-10-27); the remaining chaos tests, the audit stream and the CI wiring are Stage 5.5 and Stage 5.4.
- Evidence: `gateway/write/src/index.ts` returned HTTP 501; `gateway/write/README.md` identified implementation/tests as scaffold or stubs.
- Consequence: agent-side gateway submission is not operational.
- Required resolution: implement authorization/task binding, routing, quotas, staging, idempotent commit, sealing/closure, revocation and audit semantics; add real adversarial and integration tests.
- Owner: implementation team; operator for unresolved security/product decisions.
- Planned phase: Phase 5.
- Closure evidence: deployed integration tests for allowed and denied operations, task isolation, retries, audit, revocation, and recovery.
- Update (Stage 5.2): the contract was specified in Stage 5.1 and the **core is now implemented**: the Worker routes and authenticates, the Durable Object holds the session, and staging, sequencing, replay, quotas, the type policy, the writer lease, the seal, the operator revocation and closure, the hypermedia links and the redacted audit record all work. 171 tests pass against the real Worker and the real Durable Object. What is still missing is the GitHub delivery (Stage 5.3 — the `commit` route answers the documented `501 not-implemented`), the full adversarial and chaos suite (Stage 5.5), and the deployment (Stage 5.4.6). The gateway is **not deployed**, and the Phase 5 exit gate is not met.
- Update (Stage 5.5): the delivery (Stage 5.3) and the audit, privacy and operations (Stage 5.4) are implemented, and the **test suite and the CI wiring are now real**. 362 tests pass: the unit suite covers every module that had none (the authorisation policy, the tombstones, the seal, the rate limit, the error mapping, the counters, the status view, the encodings and the retry policy), the integration suite drives the real Worker and the real Durable Object through the whole protocol including the cross-task refusals, the chaos suite covers the Durable Object eviction, the Worker isolate eviction and every row of the provider's status table, the load suite fills the published quota and concurrency envelope to its edges, and the log-hygiene check plants a sentinel in the capability URL and the signature as well as in the three secrets and the payload. The CI gates are wired: four gates on every pull request (typecheck and bundle, unit, integration, and the log-hygiene and credential-boundary gate) and three on a schedule (the load suite, the chaos suite, and a staging rehearsal that builds the bundle and publishes nothing). **No stub remains in `gateway/write`** — the test inventory guard fails the build if one appears. What is still missing is the **deployment** and the **pilot**: the gateway has never been deployed and has never spoken to the real GitHub, so the Phase 5 exit gate is still not met.

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
- Update (Stage 5.4): the audit, the privacy and the operations are implemented. `/admin/audit` is no longer a `501`: the durable audit stream is a second Durable Object class, one instance per order, and the object **rebuilds** every record from the fields it is handed through the same fixed-schema gate, so a bug in the Worker cannot put a secret into the store. The log-hygiene check plants a sentinel in every place a secret could be and drives the whole protocol with them in place; the same driver backs the unit test and `scripts/verify-log-hygiene.ts`, which is the deploy gate. The operator runbook is written. The deploy workflow is triggered by a push to `main` or by hand, its credentials come from a protected environment, and the gate fails if a pull-request-triggered workflow holds one. `gateway/write/src` is 54 files and **none of them is a stub any more**: the four Stage 5.3 modules (`commit/commit.ts`, `commit/github-client.ts`, `commit/retry.ts`, `commit/selection.ts`) are implemented, and the `commit` route no longer answers `501 not-implemented` — it delivers to the provider, and the seal precondition (`409 seal-requires-commit`) is now reachable through the agent route. `gateway/write/tests` has 37 files and 221 tests pass, including a mock provider that is a **real HTTP server on loopback**, so the shipped client is exercised end to end rather than against a re-implementation. The remaining test stubs are the two Stage 5.5 chaos ones (`tests/chaos/do-eviction.test.ts`, `tests/chaos/isolate-eviction.test.ts`). The `ci/*.yml` files are still stubs and still sit outside `.github/workflows/`; the CI wiring is Stage 5.5.8. The gateway is **not deployed**; there is no provider credential in any environment the gateway has been run with.
- Update (Stage 5.2): the file-level count has changed and the remaining stubs are named. `gateway/write/src` is 52 files: 48 are implemented and 4 remain Stage 5.3 stubs (`commit/commit.ts`, `commit/github-client.ts`, `commit/retry.ts`, `commit/selection.ts`), each of which says so in its first lines and states what Stage 5.3 will implement. `gateway/write/tests` has 30 test files, 20 of them real and 171 tests passing; the 10 that remain stubs are the Stage 5.3 (commit, retries, GitHub mock) and Stage 5.5 (chaos, GitHub helpers) ones. `package.json` now has a `test` script that runs the Node test runner with type stripping — the same runner the read gateway uses since Stage 4.2 — and `tsconfig.test.json` typechecks the tests. `src/config/type-policy.json` is authored, `src/config/quotas.json` no longer carries the "KB undefined" note, and `.dev.vars.example` and `wrangler.toml` name the settings the code actually reads. The `ci/*.yml` files are still stubs and still sit outside `.github/workflows/`; the CI wiring is Stage 5.5.8.

### F0-033 — The Durable Object's handlers interleaved, so a concurrent write was applied more than once
- Severity: S1 for the staging invariants (one writer, one chunk, one sequence number). Status: **CONFIRMED and CLOSED in Stage 5.2** (2026-10-27).
- Evidence: found by `tests/load/concurrent-writers.test.ts`, which issued eight concurrent appends of the same chunk (`seq=1`, same hash) against one task. The file ended up 48 bytes instead of 6: every one of the eight requests read the same `last_seq`, decided that the chunk was new, and applied it. The Durable Object is single-threaded, but a handler that awaits something that is not a storage operation — a SHA-256 digest, a text decoder — yields, and the next request's handler starts in the meantime.
- Consequence: the sequence, replay and quota rules all assume that a request's read of the session state and its write of it are atomic. Without that, a retry storm from an agent (or a proxy) could corrupt a file and inflate the byte budget, while every individual response looked like a success.
- Required resolution: serialise the Durable Object's request handlers explicitly, so that each one runs to completion before the next one starts. That is what makes the session's state transitions atomic, which is what the contract's sections 2.5, 6.2 and 7.1 assume.
- Resolution (Stage 5.2): the `TaskSession` class now holds a request queue, and every internal route runs through it. The concurrency test asserts that exactly one writer is admitted, that a chunk applied concurrently is applied once, and that the accepted bytes are counted once.
- Owner: implementation. Planned phase: Stage 5.2 (done).
- Closure evidence: `tests/load/concurrent-writers.test.ts` — 3 tests; and the full suite of 171 tests passes with the queue in place.

### F0-034 — The type policy's reasons were passed through as error codes, and three of them were not codes
- Severity: S2. Status: **CONFIRMED and CLOSED in Stage 5.3** (2026-10-27).
- Evidence: `src/policy/type-policy.ts` produced three failure reasons that are not in the error catalogue: `denied-name`, `denied-extension` and `binary`. The callers passed the reason straight through as `error.code` — `src/staging/append.ts` (`code: typeCheck.reason`) and `src/session/task-session.ts` (`code: typeCheck.reason`). An undefined code is treated as a server fault by `errorSpec`, so a request that the policy refused was answered **500**. An agent that appended to a file whose name the policy denies, or sent a NUL byte, was told that the *gateway* had failed, when the *request* was what the policy refused. The status-codes test did not catch it, because it checks that the catalogue and the code table agree — and both of them were right; the leak was between the policy and the catalogue.
- Consequence: three client-side refusals were reported as server faults, which is the one thing a monitoring dashboard and a retry policy both read incorrectly. A retry policy that retries 500s would have retried a request that could never succeed.
- Required resolution: map the policy's reasons onto catalogue codes in one place, inside the policy that produces them, and never pass a reason through as a code.
- Resolution (Stage 5.3): `typeFailureCode()` in `src/policy/type-policy.ts` maps every reason onto a catalogue code (`denied-name` and `denied-extension` → `type-not-allowed`, `binary` → `not-text`), and the two callers use it. A test asserts that the binary refusal's code is `not-text` **and** that it is a code the gateway knows.
- Owner: implementation. Planned phase: Stage 5.3 (done).
- Closure evidence: `tests/unit/staging/append.test.ts` — the binary case; and the full suite of 221 tests passes.

### F0-035 — A failure body echoed a parameter name the client had invented
- Severity: S3. Status: **CONFIRMED and CLOSED in Stage 5.4** (2026-10-27).
- Evidence: `src/session/task-session.ts` built two error messages from a query parameter's name: `the parameter "<name>" is not part of this operation` (`unknown-parameter`) and `the parameter "<name>" was given more than once` (`repeated-parameter`). The name is client-supplied text, and protocol section 10.3 requires a failure response to contain no "query value that the client supplied verbatim". The stricter reading of that sentence includes a parameter's name, and the same sentence is the one the rest of the design rests on: the response body is built from a fixed schema so that a value that is not in the schema has no path into it. An exception for the message text was not written down anywhere, and it is exactly the kind of exception that grows.
- Consequence: a client-supplied string reached a response body. The body is JSON with `Content-Type: application/json` and `X-Content-Type-Options: nosniff`, so it is not a script-injection vector, and the string is the client's own — so nothing was disclosed. The cost is the exception itself: the one place where the fixed-schema rule did not hold.
- Required resolution: a failure message may name a parameter **the contract defines** — a fixed set — and never one the client invented. `unknown-parameter` names the operation's own parameters; `repeated-parameter` names the repeated parameter only when the contract defines it.
- Resolution (Stage 5.4): both messages were changed, the contract's section 10.3 now states the rule, and the transport-hygiene test drives four failure paths and asserts that none of them echoes a query value.
- Owner: implementation. Planned phase: Stage 5.4 (done).
- Closure evidence: `tests/integration/transport-hygiene.test.ts` — the failure-body case; and the sentinel injection, which scans every failure body for every planted sentinel.

### F0-010 — `verify.sh` executes code from the artifact it is verifying
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: step 7 of `release/verify.sh` runs `python3 -m compileall` and `python3 -m unittest discover` inside the extracted payload. A planted `engine/tools/test_*.py` wrote a marker file outside the extraction directory during `verify.sh`, and the script still reported OK.
- Consequence: running the independent verifier on an untrusted or tampered artifact executes that artifact's code with the verifier's privileges; verification is not independent of the thing verified.
- Required resolution: perform all static/integrity checks first and treat payload tests as a separate, explicitly sandboxed or opt-in step; never run payload code as part of default verification of a downloaded artifact.
- Owner: implementation. Planned phase: Phase 3 - Stage 3.2.7 (verify independently), 3.4.1 (negative test).
- Closure evidence: a negative test with a planted payload test proving verification does not execute it.

### F0-011 — Packaging includes untracked files from `template/` and verification passes them
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: untracked files `template/docs/.scratch-local.txt` and `template/engine/tools/local-notes.txt` were included in the tarball (43 files vs 41) and `verify.sh` reported OK. `package.sh` expands manifest directories with `find`, not from the git index; verify only matches path/content patterns.
- Consequence: a local build can ship stray files, including secrets that are not credential-shaped. CI builds from a clean checkout, which mitigates but does not remove the local-build path (the operator builds from Termux).
- Required resolution: package from tracked files only (`git ls-files`) or refuse a dirty template tree; add a negative test.
- Owner: implementation. Planned phase: Phase 3 - 3.1.2, 3.1.5, 3.4.1.
- Closure evidence: dirty-tree test fails closed; positive test packages the clean tree.

### F0-012 — Tarball bytes depend on the builder's umask
- Severity: S2. Status: CONFIRMED (executed).
- Evidence: the same git tree packaged under umask 022 and under a group-writable checkout (umask 002) produced two different SHA-256 values. Modes are copied from the working tree.
- Consequence: Stage 3.1.4 "byte-identical rebuilds" fails across environments; Termux's stricter default umask will likely produce a different artifact from CI. The release contract's "deterministic tarball" claim is not met.
- Required resolution: normalise modes in the archive (explicit 0644/0755 from the manifest or git mode) rather than inheriting them.
- Owner: implementation. Planned phase: Phase 3 - 3.1.4.
- Closure evidence: identical hashes across at least two umasks, tested in `test-release.sh`.

### F0-013 — Managed `engine/ENGINE.json` and seed `engine/engine.json` differ only by case
- Severity: S2. Status: CONFIRMED (source: `release/manifest.txt` lines 9 and 15, both files present in `template/engine/`).
- Evidence: the two names collide on case-insensitive filesystems (default macOS and Windows volumes, FAT/exFAT and some Android storage). One cannot check out both; an install or update could overwrite the seed (consumer configuration) with managed metadata or the reverse.
- Consequence: potential loss of consumer-owned configuration, contradicting G-04.
- Operator decision 2026-10-26: names are to be lowercase. Literal lowercase of `ENGINE.json` equals the seed `engine.json`, so the managed file needs a distinct lowercase name (**pending confirmation; proposed `engine/release.json`**). No consumer migration is needed because nothing has been released.
- Required resolution: rename the managed file (touches `release/manifest.txt`, `set-version.sh`, `verify.sh`, `test-release.sh`, and five docs); add a case-fold duplicate check to packaging and verification.
- Owner: operator (decision), implementation. Planned phase: decision in Phase 2.4 planning; implementation 2.4 and 3.1.2.
- Closure evidence: no two manifest paths equal under case folding; update test covers migration.

### F0-014 — Shipped shell tooling requires bash 4+ and GNU tools, but the draft contract named macOS as a primary target
- Severity: S2. Status: CONFIRMED by source; not executed on macOS.
- Evidence: `engine/bin/update.sh` uses `declare -A` (not in the bash 3.2 that macOS ships) and requires `sha256sum`; `release/package.sh` uses GNU `tar` options (`--sort`, `--mtime`, `--owner`, `--numeric-owner`) and `sha256sum`; the operator README describes `cbridge` as a Termux script.
- Consequence: the documented supported environments and the real requirements disagree. The redrafted Stage 1.1 contract states the requirement explicitly.
- Operator response 2026-10-26: asked for an explanation. Default applied: macOS is not claimed as supported (revisit on request).
- Required resolution: state the requirement (bash >= 4, GNU coreutils/tar) and add a preflight check with a clear error so unsupported shells fail clearly.
- Owner: operator (environment decision), implementation. Planned phase: Phase 1.1 contract (this PR), Phase 2.4 preflight.
- Closure evidence: preflight test on an older-bash stub; docs state the requirement.

### F0-015 — `update.sh` is not transactional
- Severity: S2. Status: CONFIRMED by source; interruption not executed.
- Evidence: the apply loop copies files one by one and writes `.build-engine.lock` only at the end. An interrupted update leaves some files at the new version with the lock still describing the old one; the next run classifies those files as "edited locally" conflicts.
- Consequence: recoverability gap; the operator would be pushed to `--force`. Stage 2.4.7 requires all-or-nothing behaviour or a staged backup/rollback.
- Owner: implementation. Planned phase: Phase 2.4 - 2.4.4, 2.4.5, 2.4.7.
- Closure evidence: interrupted-update test that recovers without `--force`.

### F0-016 — Path checks use the substring glob `*..*` (confirms R0-001)
- Severity: S3 (latent: no current file name contains `..`). Status: CONFIRMED (executed).
- Evidence: `docs/notes..v2.md` packaged successfully and was then rejected by `verify.sh` ("unsafe path in tar"). The same pattern appears in `package.sh:22`, `verify.sh:30` and three places in `update.sh`.
- Consequence: a legitimate file name containing two consecutive dots passes packaging and then blocks release, and would also make `update.sh` refuse the artifact.
- Required resolution: reject only a `..` path component (split on `/`), keep rejecting real traversal; add positive and negative tests.
- Owner: implementation. Planned phase: Phase 3 - 3.2.2, 3.4.2; and 2.4 for `update.sh`.
- Closure evidence: safe `a..b` name accepted; `../x` and `a/../b` rejected, in all three scripts.

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

## A5. Additional confirmed findings (Stage 5.5 — the write gateway's real test suite, 2026-10-27)

Two findings. The first was found by the adversarial input suite that Stage 5.5 added (plan task 5.5.4); the
second was found by the merge of `main` into the Stage 5.5 branch, and it was already breaking `main` itself.
Both were reproduced by execution before the fix, and both are closed in the same stage. The evidence is a
transcript, not a narrative.

### F0-063 — The staging operations did not apply the path rules

- Severity: S2. Status: CONFIRMED (executed) and CLOSED in Stage 5.5.
- Evidence: the contract validates the `path` parameter of `create`, `append`, `replace`, `read` and `delete`
  against the path rules of section 5.1 (protocol section 4.2, "the `path` parameter"), and the error catalogue
  defines `malformed-path` (400) for exactly that failure. The implementation applied those rules in **one** place
  only: `src/commit/selection.ts`, at the commit. `checkPath` was called from nowhere else in `src/`, so a path
  that failed a rule was accepted by every staging operation and refused only three steps later, at the commit.
- Reproduction, against the pre-fix code, with a capability for one task and a probe that creates each path:

      CREATE ../escape.md     -> 200 ok
      CREATE .git/config.md   -> 200 ok
      CREATE a/../b.md        -> 200 ok
      CREATE /abs.md          -> 200 ok
      CREATE notes/na~me.v1..2.md -> 200 ok      (legal: a component may contain ".." as a substring)
      INVENTORY: ["../escape.md",".git/config.md","/abs.md","a/../b.md","notes/na~me.v1..2.md"]

- Consequence: an agent could stage a traversal path, an absolute path or a hidden path. The blast radius was
  bounded — the commit's selection refuses such a path, so nothing ever escaped the task folder — but the
  consequence was still real: the staged file took a file slot and a byte budget out of the published envelope,
  and the agent was told nothing until the commit refused it with a code the contract had already assigned to the
  staging operations. The placeholder rule (protocol section 12.3, "a `create` of `.keep`, or of any hidden path,
  is refused by the path rules") was enforced only by accident, by the type policy, under the wrong code.
- Required resolution: apply the path rules at the operation that carries the path, and refuse the path there with
  `malformed-path` and a message that does not echo the path (the rule from F0-035).
- Owner: implementation. Planned phase: Stage 5.5 (5.5.4).
- Closure evidence: `src/session/task-session.ts` checks the path with `checkPath` before the operation runs, and
  `tests/integration/adversarial-inputs.test.ts` drives thirteen paths that fail a rule through all five
  operations that carry a path and asserts `400 malformed-path` for each, asserts that a refused path takes no
  slot and leaves no file behind, and asserts that the paths the rules accept — including
  `notes/na~me.v1..2.md` — still work. The contract was clarified at the same time (protocol section 5.1 now
  says where the rules are enforced and why), and the error catalogue now points at the contract's path rules
  rather than promising that its own help link lists them.

### F0-064 — `main`'s release manifest named a file that does not exist, and had the two metadata roles the wrong way round

- Severity: S1 for the release pipeline. Status: CONFIRMED (executed) and CLOSED in Stage 5.5.
- Evidence: the Stage 1.1 change (PR #21, merged as `8a9279d`) rewrote `release/manifest.txt` to
  `managed engine/engine.json` and `seed engine/release.json`, and adopted the names `engine/engine.json` (the
  consumer's configuration) and `engine/release.json` (the machine metadata). It did **not** rename
  `template/engine/ENGINE.json` to `template/engine/release.json` — the Stage 1.1 closeout says the physical
  rename "remains a Phase 2 task" — and it **swapped the roles** of the two files: the machine metadata is the
  file that is replaced on every update (managed), and the consumer's configuration is the file that is installed
  only if absent (seed).
- Reproduction, on a pristine checkout of `main` @ `1348f99`:

      $ release/package.sh dist
      package: manifest lists 'engine/release.json' but template/engine/release.json does not exist
      rc=1

      $ release/test-release.sh
      4 passed, 18 failed
      $ bash tests/test_update.sh
      5 passed, 17 failed

- Consequence: **the packaging did not work at all**, so the artifact could not be built, and every downstream
  check that needs an artifact failed with it. `main`'s CI has been red since the Stage 1.1 merge; the three
  most recent runs on `main` (`40617447829`, `40617334926`, `40612975602`, `40612873665`) all failed, and the
  failing step is "Release machinery self-test" — while the write-gateway job passed. The run before the Stage
  1.1 merge (`40523784995`) passed. Every branch derived from `main` inherits the breakage.
- Required resolution: complete the rename the Stage 1.1 decision asked for — `template/engine/ENGINE.json` becomes
  `template/engine/release.json` — put the two files back in their proper roles (`managed engine/release.json`,
  `seed engine/engine.json`), and update the readers: `release/set-version.sh`, `release/verify.sh`,
  `release/test-release.sh`, `README.md`, `COMPATIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md` and
  `docs/STATUS.md`. The rename is the same one Stage 3.1 performs (register F0-013); the roles are the half of it
  that Stage 3.1's manifest also carries.
- Owner: implementation. Planned phase: Phase 2 / Phase 3.1 (the rename and the role correction were already
  implemented on `phase-3/3.1-allowlist-packaging`; this finding is the merge of that work into a branch that
  descends from `main`).
- Closure evidence: on the Stage 5.5 branch, `release/package.sh dist` builds the artifact,
  `release/verify.sh` answers `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0)`, the artifact
  contains `engine/VERSION`, `engine/engine.json` and `engine/release.json` and no gateway, conformance or
  variants path, `release/test-release.sh` is 22 passed / 0 failed and `tests/test_update.sh` is 22 passed /
  0 failed. The seed and the managed file are now in the roles the shipped `update.sh` and the consumer flow
  assume.

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

### R0-010 — Updater path handling around symlinks and empty parents
- Severity: S3; Status: RISK TO TEST (source only).
- Evidence: `cp -p` writes through a symlinked destination directory; `rmdir -p` removes empty ancestor directories of dropped files, which may include consumer-owned empty directories.
- Required action: refuse symlinked managed paths; remove only directories the lock file recorded.
- Planned phase: Phase 2.4 (2.4.2, 2.4.5).

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
| F0-004, F0-009 | Phase 5 (5.1-5.5) | Write gateway, all stub source/tests/scripts/CI; exit gate forbids stubs. **5.5 closed the last of them** — the chaos tests, the CI wiring and the three operator scripts are implemented; the deployment and the pilot (Phase 6) remain |
| F0-063 | Phase 5 (5.5.4) | The staging operations did not apply the path rules; found by the adversarial input suite, closed in the same stage |
| F0-064 | Phase 2 / Phase 3.1 | `main`'s release manifest named a file that did not exist and had the two metadata roles the wrong way round, so the packaging failed and `main`'s CI was red; the rename and the role correction are Stage 3.1's work, applied in the same stage that found it |
| F0-005 | Phase 4.1 | Vectors and harness |
| F0-006 | Phase 6 | Real pilot |
| F0-008 | This PR + 3.3.1/3.4.3 | Fix now, guard later |
| F0-010 to F0-012, F0-016, F0-017, F0-023 | Phase 3 | Packaging, verify, workflow |
| F0-013, F0-014, F0-015, R0-009, R0-010 | Phase 2.4 | Install/update (F0-013/F0-014 need operator decisions) |
| F0-018 | Phase 2.3 / 3.1.4 | Modes |
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
