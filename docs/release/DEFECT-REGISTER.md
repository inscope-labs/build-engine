# Build Engine — Phase 0 Defect Register

- Repository: `https://github.com/inscope-labs/build-engine`
- Baseline branch: `main`
- Inspected baseline commit: `b45e8008adcaa179165abf24880e8eda0eb7c515` (remote review); local command baseline run at `ee654cddeb9bd00043230942d89c8df955ea3afc` (adds only `RELEASE-PLAN.md`; see `PHASE-0-BASELINE.md`)
- Version: `0.5.0`
- Baseline date: 2026-10-26
- Status: **Addendum A2 (extended audit) submitted for operator review; the original register was merged in PR #1. Stage 4.3 added F0-030 to F0-032 and Stage 5.2 added F0-033, Stage 5.3 added F0-034 and Stage 5.4 added F0-035 and Stage 5.5 added F0-063 and F0-064 (closed)**
- Addendum date: 2026-10-26; audited commit `35172ab` (main after Phase 1 PRs #2-#5)
- Addendum A5 (Stage 3.1, allowlist packaging), 2026-10-27: F0-036 to F0-039 found and closed; F0-011, F0-012, F0-013 and F0-018 closed. Baseline commit `99a5a73` (main after Stage 2.3).
- Addendum A6 (Stage 3.2, independent verification), 2026-10-27: F0-065 to F0-069 found and closed; F0-010, F0-013 (verification half) and F0-016 closed. Baseline commit `3149df0` (Stage 3.1).
- Stage 4.3 addendum: 2026-10-27; F0-030 to F0-032, found by the operational checks of Stage 4.3 and closed in it
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
- Status: CONFIRMED. **Implementation closed in Stage 4.2** (2026-10-27); **deployment still open** (Stage 4.3).
- Evidence: `docs/END-TO-END.md` marks the production read path not started and its decisions open; `docs/STATUS.md` describes production directories as structure/design placeholders.
- Consequence: the production Class B context retrieval path cannot be claimed operational.
- Required resolution: resolve the relevant architecture decisions, implement and deploy the production path, and pass staging acceptance tests.
- Update (Stage 4.2): the decisions are closed (0001 hosting, 0003 link lifetimes) and the implementation exists — `gateway/read/production` is a Cloudflare Worker that passes the shared conformance suite over real HTTP (58 cases, 0 failed) and whose resource controls are tested separately. It has **not** been deployed: no route, no environment separation, no deploy gate, no operator runbook. Those are Stage 4.3, and the real pilot is Stage 6.
- Update (Stage 4.3): the deployment surface exists — three separated environments with a generated configuration (`ops/environments.json` → `wrangler.toml`), a deploy gate that publishes nothing until every check has passed, the operational checks (cold start, provider failures, expiry, revocation, key rotation), the isolation proof and the operator runbook. The gateway has **still** not been deployed: no environment has been published, because the Cloudflare-side steps need the operator's account and the configuration still carries the operator's placeholders (the repository and the production host). The real pilot is Stage 6.
- Owner: implementation team and operator for decisions/hosting approvals.
- Planned phase: Stage 4.2 (done), Stage 4.3 (done — the deployment surface; the publication itself needs the operator), Stage 6 (the pilot).
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
- Severity: S3. Status: CONFIRMED (executed: pyflakes); **closed in Stage 4.2** (2026-10-27).
- Evidence: `gateway/read/reference/ctxgate.py:30` imports `ctxlink.SCHEME` and `ctxlink.mint` without using them.
- Resolution (Stage 4.2): the health payload added in Stage 4.2 uses `SCHEME`, and `mint` is the re-export the reference tests mint links through (`gateway/read/reference/test_ctxgate.py` calls `cg.mint`). Both imports are therefore used. The original finding was right that the file was untidy and wrong that both imports were dead: removing `mint` broke the 15 reference tests, which is how it was caught rather than shipped.
- Owner: implementation. Planned phase: Stage 4.2 (done).
- Closure evidence: `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` runs 15 tests, OK.

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

### F0-024 — A context path may contain control characters
- Severity: S2. Status: CONFIRMED by source; **closed in Stage 4.1** (2026-10-26).
- Evidence: `ctxlink.safe_path()` rejected `\x00`, `\\`, absolute paths, and the `.`/`..`/empty components, but accepted any other control character. A path such as `a\nb` or `a\x01b` was therefore mintable and served, and the path is written into the audit log and used to build the source request. A port written in another language, reading the rules in prose rather than from the code, had no way to know this was intended.
- Consequence: a path that is awkward to represent in a URL, a log line or a header can reach the gateway; the scheme had no single written rule for it, so "any implementation must reproduce" was not actually testable.
- Resolution (Stage 4.1): the path rule is now written normatively in `conformance/SCHEME.md` section 5 and says that a path must contain no character in `U+0000`-`U+001F` or `U+007F`. `ctxlink.safe_path()` was tightened to match, which is a strict subset of the paths it accepted before: no previously minted legitimate link is affected. `gateway/read/reference/ctxgate.py` imports the same function, so the client and the gateway cannot drift apart.
- Owner: implementation. Planned phase: Stage 4.1 (done).
- Closure evidence: vectors `I15`-`I19` in `conformance/signing-vectors.json` (NUL, newline, control character, DEL, trailing slash) are refused by the shipped client; `template/engine/tools/test_ctxlink.py` asserts the rule in the shipped copy; `conformance/test_conformance.py` fails if the shipped test and the shared vectors disagree.

### F0-025 — The scheme had no written normative description
- Severity: S2. Status: CONFIRMED by source; **closed in Stage 4.1** (2026-10-26).
- Evidence: the scheme existed as prose in `template/docs/CONTEXT-EXPORT.md` sections 5 and 6, as a docstring in `template/engine/tools/ctxlink.py`, and as two vectors in two different places. `conformance/signing-vectors.json` was `{"vectors": []}` with the note "stub: to be filled when code work starts", and `conformance/harness/` held one README. `behaviours.md` stated that the reference gateway's behaviour mapping was "not yet recorded".
- Consequence: "any implementation must reproduce the signing vectors" and "a production port must pass appendix B" were both unfalsifiable. A port had to read Python to learn the encoding rules, and the rules that mattered most (per-segment percent-decoding, no Unicode normalisation, the order of the verification checks) were not written down anywhere at all.
- Resolution (Stage 4.1): `conformance/SCHEME.md` is now the normative description of the scheme — message construction, signature encoding, field rules, path rules, URL encoding, the order of the verification checks, the response and audit formats, and the conformance requirements including the test clock. The vectors file is complete (17 valid, 19 invalid) and was produced by an implementation independent of the shipped client, cross-checked against OpenSSL, and then compared with the shipped client.
- Owner: implementation. Planned phase: Stage 4.1 (done).
- Closure evidence: `conformance/harness/run.py` executes the vectors and the B1-B10 cases; `conformance/test_conformance.py` is the CI gate; the suite was itself checked against thirteen deliberate defects in the reference gateway (an off-by-one in the expiry comparison, a path check written as a substring glob, the signature check moved after the expiry check, per-reason refusal bodies, the allow-prefix ignored, the pinned commit ignored, the TTL and revocation checks disabled, the size limit disabled, a wrong hash header, POST allowed, the audit path dropped) and every one is caught by a named case.

### F0-026 — The production read gateway's per-order abuse cooldown was unreachable code
- Severity: S2 (a resource control that was documented as existing and did not). Status: CONFIRMED (executed: the abuse-control test observed no cooldown); **closed in Stage 4.2** (2026-10-27).
- Evidence: `gateway/read/production/src/state.ts` computed a per-order cooldown in the early gate, but `src/rules.ts` called that gate before the link was parsed, so it was always given the placeholder order `"-"` and the per-order branch could never be taken. A flood of forged links produced a flat sequence of 403s and no cooldown, and the audit trail showed no `cooldown` reason at all.
- Consequence: the abuse control the deployment documents (an order under attack is put in a cooldown) was not in force. The per-IP and global budgets were, so a flood was still bounded, but the per-order control was a claim without an implementation behind it.
- Resolution (Stage 4.2): the cooldown is now a timestamped marker on the order, set when the order collects more than `REFUSAL_BURST` refusals, and checked in the late gate next to the order's request budget. The refusal count is maintained in the same Durable Object.
- Owner: implementation. Planned phase: Stage 4.2 (done).
- Closure evidence: `python3 test/run-abuse-controls.py` — the order in a cooldown is refused with 429, and the audit trail carries the `cooldown` reason.

### F0-027 — The refusal burst counted a forger's attempts against the order the forger named
- Severity: S2 (a denial-of-service against a legitimate work order). Status: CONFIRMED (source, in the first implementation of Stage 4.2); **closed in Stage 4.2** (2026-10-27).
- Evidence: the first implementation of the refusal burst compared a request's attempt count for an order against that order's success count, so a difference above the burst was treated as abuse against that order. The order in an unverified link is a string the caller chooses: a caller that sent forged links naming a victim's order would have pushed that order into a cooldown and locked out its legitimate holder.
- Resolution (Stage 4.2): the burst counts only refusals that happened AFTER the signature was verified (`expired`, `ttl-too-long`, `revoked`, `path-denied`, `not-found`, `too-large`, `rate-limited` and the upstream errors). A refusal before verification (`malformed`, `unknown-key`, `bad-signature`) is never counted against an order, and the per-order request budget is likewise only spent after the signature verifies. A forged flood is bounded by the per-IP and global budgets instead.
- Owner: implementation. Planned phase: Stage 4.2 (done).
- Closure evidence: `python3 test/run-abuse-controls.py` asserts both directions — an order that collects authenticated refusals is cooled down, and an order named only in forged links is NOT cooled down and still serves a valid link.

### F0-028 — The Cloudflare Workers runtime normalises path segments before the Worker sees them
- Severity: S3 (a platform behaviour with a documentation consequence, not a defect in this repository's code). Status: CONFIRMED by source; **closed in Stage 4.2** (2026-10-27) by documentation.
- Evidence: the Workers runtime resolves ".." and "%2e%2e" segments out of the request target before the request reaches the Worker. A traversal attempt therefore arrives as a path that no longer contains the traversal, and the Worker refuses it as `bad-signature` rather than as `malformed`. The outcome is unchanged (403, nothing served); only the audit reason differs from the one the scheme names.
- Resolution (Stage 4.2): the case in `conformance/cases/behaviours.json` accepts either reason, `conformance/SCHEME.md` records that the normalisation is the platform's and that the scheme itself never normalises a path, and `docs/release/PHASE-4.2-CLOSEOUT.md` states it plainly. A port on a platform that does not normalise reports `malformed`; the suite does not pretend the two are the same.
- Owner: implementation. Planned phase: Stage 4.2 (done).
- Closure evidence: the conformance run passes with the traversal case green, and the scheme says why.

### F0-029 — The reference gateway did not report the policy it was enforcing
- Severity: S2 (a conformance claim that could not be checked). Status: CONFIRMED by source; **closed in Stage 4.2** (2026-10-27).
- Evidence: the reference gateway enforced a clock-skew tolerance, a maximum lifetime and a maximum size, but reported none of them. A harness could therefore not tell whether a port's expiry decision was right or merely convenient, and the conformance suite had no way to assert the ceilings that the operator's decisions set.
- Resolution (Stage 4.2): the policy became a declared part of the scheme. `conformance/SCHEME.md` now specifies the skew tolerance (decision 0003, at most 120 s), the maximum lifetime (at most 259200 s, 72 h) and the `/healthz` contract; the reference gateway reports its effective policy on `/healthz`; the harness reads the policy from `/healthz` and asserts the ceilings independently of what the gateway claims. The production Worker does the same, so the two are directly comparable.
- Owner: implementation. Planned phase: Stage 4.2 (done, amending Stage 4.1's spec).
- Closure evidence: `python3 conformance/harness/run.py all --reference` runs 94 checks, 0 failed, and the harness fails if a gateway declares a tolerance above the ceiling.

### F0-030 — The gateway failed open when the state store could not be read, and served revoked orders
- Severity: **S1** (a revoked capability kept working). Status: CONFIRMED (source, found by the Stage 4.3 operational checks); **closed in Stage 4.3** (2026-10-27).
- Evidence: `gateway/read/production/src/index.ts` built the state client with `if (!response.ok) return { action: "allow", reason: "ok" }` — a comment claimed this failed open "on the abuse controls only", but the same call path carried the **revocation** check. The Durable Object's own handler answers `500 state error: ...` when its storage throws (`src/state.ts`), and the client's `!response.ok` branch turned that into "allow". The order was therefore served with no revocation check at all. The same branch also made the per-IP and global budgets advisory. A gateway that cannot read its own revocation list was reading it as an empty one, and an empty revocation list is indistinguishable from a live one.
- Consequence: a revoked work order kept serving files whenever the state store was unhealthy — a storage error, a deployment in flight, a Durable Object restart. The exit gate of Phase 4 ("revocation takes effect within the documented bound") could not be claimed, and G-07 (fail closed on stale authorization and on unverifiable state) was not met.
- Resolution (Stage 4.3): the state channel was extracted to `src/state-client.ts` and **fails closed**. An unreadable state store, a state store that answers with an error, and a state store that answers with something that is not a decision all produce the action `state-unavailable`, and the rules layer refuses the request with `503` and the reason `state-unavailable`. There is no path from a state-store failure to "allow". The audit record for such a refusal is written to the platform log, because the ring is unreachable too, so that a refusal during an outage is not lost. The Worker also no longer lets an unexpected exception escape as a stack trace: it is answered with `500 internal-error` and audited.
- Owner: implementation. Planned phase: Stage 4.3 (done).
- Closure evidence: `test/unit/state-client.test.ts` asserts that an erroring, an unreachable and a malformed state store all produce `state-unavailable` and never `allow`; `python3 test/run-staging-checks.py` exercises the deployed behaviour, and the operational checks are part of the deploy gate and of CI.

### F0-031 — The operator channel reported a revocation that had not been stored
- Severity: S2 (an operator believes a capability is dead when it is alive). Status: CONFIRMED (source); **closed in Stage 4.3** (2026-10-27).
- Evidence: `POST /admin/revoke` called the Durable Object and **ignored the answer**, then returned `{"revoked": "<order>"}` with status 200. If the state store refused or could not be reached, the operator was told the order was revoked when nothing had been stored. `/admin/audit` and `/admin/metrics` had the same shape: the error text of a failed state call was returned with status 200 as if it were the trail.
- Consequence: the operator's single most important action — killing a leaked capability — could report success while doing nothing. An operator who sees "revoked" stops watching that order, and the capability stays alive.
- Resolution (Stage 4.3): the operator channel goes through `callStateAdmin()`, which reports what the state store actually confirmed. A revoke that was not stored is a failure with `503`, and the runbook says so in three places: a failed revoke means **the order is still live**, and it must be revoked again.
- Owner: implementation. Planned phase: Stage 4.3 (done).
- Closure evidence: `test/unit/state-client.test.ts` asserts that a revoke the store refused is reported as a failure and a revoke it accepted is reported as done.

### F0-032 — The test harness left the Cloudflare runtime running after every run
- Severity: S3 (a resource leak, with a sting in it). Status: CONFIRMED (executed: the process table after a run); **closed in Stage 4.3** (2026-10-27).
- Evidence: `test/localenv.py` stopped the `npx wrangler` process it had started and nothing else. `wrangler` starts the Cloudflare runtime in a process group of its own, so the runtime survived the launcher, kept the port, kept the binary open and kept running after the test had finished. The Stage 4.3 staging check, which restarts the Worker to observe a key rotation, was **answered by the old Worker**: the new one could not bind the port, and the check was reading the settings it had before the "restart". The first run of the key-rotation checks failed for that reason.
- Consequence: the test suite left the machine dirty, a "restart" was not a restart, and `npm ci` could not remove `node_modules` because the runtime still held its binaries open — which broke the deploy gate at its first step.
- Resolution (Stage 4.3): `test/procs.py` stops a whole process tree, and both harnesses use it. The staging harness asserts that the port was released before it starts again, so a restart that is not a restart fails loudly instead of quietly.
- Owner: implementation. Planned phase: Stage 4.3 (done).
- Closure evidence: after the conformance, abuse, staging and isolation runs the process table holds no live runtime; `npm ci` completes over the existing `node_modules`; and the key-rotation checks pass against a Worker that was really restarted.

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

## A8. Additional confirmed findings (Stage 5.5 — the write gateway's real test suite, 2026-10-27)

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
| Production Class B read gateway | **REQUIRED for the first release (operator decision 2026-10-26; Stage 1.3)** | **Implemented and conformance-proven as of 2026-10-27 (Stage 4.2)** — `gateway/read/production`, a Cloudflare Worker that passes the shared conformance suite over real HTTP (58 cases, 0 failed) with its resource controls tested separately. **Not deployed**: route, environment separation, deploy gate and operator runbook are Stage 4.3. |
| Agent-side write gateway | **REQUIRED for the first release (operator decision 2026-10-26; Stage 1.4)** | Scaffold only; Phase 5. |
| Shared conformance harness | **REQUIRED** (gates the read gateway exit, Stage 4.1) | **Complete as of 2026-10-26** — `conformance/SCHEME.md`, 17 valid + 19 invalid signing vectors, 53 executable cases for B1-B10, a runner that drives any gateway over HTTP and any signer over a JSON-lines contract, and a CI gate. See `docs/release/PHASE-4.1-CLOSEOUT.md`. The production port must still pass it (Stage 4.2). |
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
| F0-003 | Phase 4.2 (implementation, done) + 4.3 (deployment, done) | Production read gateway: the port exists and passes conformance; Stage 4.3 added the environments, the deploy gate, the operational checks and the runbook. **The gateway is still not deployed** — no environment has been published |
| F0-004, F0-009 | Phase 5 (5.1-5.5) | Write gateway, all stub source/tests/scripts/CI; exit gate forbids stubs. **5.5 closed the last of them** — the chaos tests, the CI wiring and the three operator scripts are implemented; the deployment and the pilot (Phase 6) remain |
| F0-063 | Phase 5 (5.5.4) | The staging operations did not apply the path rules; found by the adversarial input suite, closed in the same stage |
| F0-064 | Phase 2 / Phase 3.1 | `main`'s release manifest named a file that did not exist and had the two metadata roles the wrong way round, so the packaging failed and `main`'s CI was red; the rename and the role correction are Stage 3.1's work, applied in the same stage that found it |
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
| F0-021, F0-022 | Stage 4.2 (lint, done) / 3.3.2 (dependencies) | Lint closed; the read gateway is pinned to clean versions, the write gateway still carries F0-022's advisories (Phase 5) |
| F0-024, F0-025 | Stage 4.1 (closed 2026-10-26) | Path rule, normative scheme description |
| F0-026, F0-027 | Stage 4.2 (closed 2026-10-27) | The per-order cooldown was unreachable; the refusal burst counted a forger's attempts against the named order |
| F0-028, F0-029 | Stage 4.2 (closed 2026-10-27) | Workers path normalisation; the policy is now declared and checkable |
| F0-030, F0-031, F0-032 | Stage 4.3 (closed 2026-10-27) | The state channel failed open and a revoke could be reported that had not happened; the test harness left the runtime running |
| R0-002 | Phase 3.2.1, 3.2.3, 3.4.1 | Remaining adversarial cases |
| R0-004 | Phase 3.3.7 (or earlier by operator) | Branch/tag protection absent |
| R0-005 to R0-007 | Phase 1.4 (decided) + 5 | Implementation and tests |
| R0-011 | Stage 5.1 and 2.3 (to be added to the plan), 6.2 | Needs operator approval of the plan change |
| F0-050 to F0-059, F0-061, F0-062 | Phase 2.2 (PR #10 plus this follow-up) | Closed; F0-060 and R0-020 belong to Phase 4 |
| R0-008 | Stage 4.3 (partly closed) + Phase 5 | The read gateway's deployment defaults are now pinned: `ops/environments.json` is the single source, `wrangler.toml` is generated from it, production is not exposed on workers.dev, and the gate refuses a drifted configuration. The write gateway's defaults are still open |

## G. Audit method and coverage (what "complete" can and cannot mean)

This register lists every defect known at the audited commit. It cannot prove that no other defect exists; it records what was examined so gaps are visible, and the process is that any later finding is appended here with an ID, evidence and owning stage before it is fixed (G-03, G-10).

Examined in A2: all of `release/*` (read in full, edge cases executed), `template/engine/bin/update.sh` (read in full), both GitHub workflows, `gateway/write` (every source, test, script, CI, config and package file inventoried), `docs/` and `template/` links (no broken relative links found), shell static analysis (shellcheck: no warnings at warning level on `release/`, `tests/`, `update.sh`, `install.sh`, `cbridge`), Python static analysis (pyflakes: 2 unused imports; bandit: no medium-or-higher issue in shipped code), `npm audit`, Phase 1 documents against each other.

Run and passing at the audited commit after this PR's fix: shipped tool tests (70), reference gateway tests (15), release self-test (22), update test (22), package, verify, write-gateway typecheck and bundle.

Not audited line by line (covered only by their existing tests and static analysis): `template/engine/tools/plan_tool.py` (1236 lines), `template/operator/cbridge` (309 lines), `template/engine/tools/ctxlink.py`, `gateway/read/reference/ctxgate.py`. Stages 2.2.1 and 2.3.1 are the dedicated audits for these; anything they find is appended as F0-0xx.

Not verifiable from this environment: macOS behaviour (F0-014), environment approvals and the default workflow token permission (R0-004).


---

## Addendum A7 — Operator decisions for Basic closeout (2026-10-29)

Recorded answers to the decision questionnaire; authority for closing remaining Basic items.

### F0-002 — Changelog dated
- Status: **CLOSED** for RC preparation.
- Heading set to `## 0.5.0 - 2026-10-29`. Entry lists only Basic functionality and states Class B is deferred to 0.6.0.

### F0-023 — Release workflow gates
- Status: **CLOSED** (implementation in `release.yml` / `ci.yml`).
- Operator answers: depend on CI success for the tagged commit (yes); pin Actions to immutable SHAs (yes); tip-of-main tag check (yes); do **not** narrow `permissions: contents: write` to the publish step only (no); failed gate publishes nothing (yes).
- Implementation: SHA-pinned `actions/checkout`, `setup-python`, `setup-node`; tip equality check against `origin/main`; `gh api` check that `ci.yml` completed with `success` for `GITHUB_SHA` before package/verify/publish.

### R0-011 — Class A delivery route
- Status: **RESOLVED for Basic**.
- Operator decision D2: operator-side `cbridge upload` is the sole documented delivery route for Class A deliverables in 0.5.0. The submissions-to-consumer transfer path (automated Supervisor Agent transfer) is explicitly deferred to 0.6.0 and does not block 0.5.0. Agent-side submission through the write gateway is unsupported in 0.5.0 and must be stated plainly in shipped and maintainer documentation.

### R0-004 — Repository protection policy (operator/admin action)
- Status: **POLICY RECORDED; settings not yet applied**.
- Operator decision D7 (2026-10-29):
  - `main`: require pull requests before merge; require the `ci` status check; disallow force-pushes; allow deletions.
  - Tags matching `v*`: no creation restriction.
  - Actions: no selected-actions allow-list; no repository-level SHA-pinning mandate (workflow-level pinning still applied per F0-023).
  - Timing: create the `v0.5.0` tag **first**; apply branch protection afterward.
- These settings cannot be applied from repository code. An admin must configure them in GitHub repository settings after the tag exists. Evidence of configuration should be recorded here when done.

### Class B landing (D3) and deployment (D4)
- Do **not** merge Class B branches (`phase-4/*`, `phase-5/*`) until after 0.5.0 is released.
- First real gateway deployment is deferred and pre-authorised for 0.6.0 Standard only.

### Publication (D5 / G-12)
- Annotated tag `v0.5.0` authorised on the approved `main` commit once Basic exit gates pass; publish only via `release.yml` (no bypass).
- Release notes framing: “Basic — Class A only. Supported environments: Linux and Termux/Android. No production gateway is deployed. Class B (read/write gateways, remote revocation/audit, pilot) is planned for 0.6.0 Standard.”
- Published artifact and tag are immutable.

### Protocol identifier for 0.6.0 (D6)
- Conventional `build-engine/0.6`.

## Addendum A8 — Publication record for 0.5.0 (2026-10-29)

- `v0.5.0` tag created on `main` at `c95ae51` (CI green); published by `release.yml` run 40879890746. Release: https://github.com/inscope-labs/build-engine/releases/tag/v0.5.0. Release notes were rewritten after publication to the approved Basic framing (they are not generated from the changelog alone).
- R0-004 applied after the tag: `main` protected (pull request required with zero approvals, required check `test`, force-push blocked, deletion allowed, administrators not enforced). No tag restriction and no Actions allow-list, per the operator policy in A7. **Accepted open risk, recorded in writing by operator decision:** no required reviews and administrators can bypass.
- Independent smoke test of the published asset: checksum OK; `verify.sh --release` OK; clean install into an empty repository adds 41 files; re-run reports 40 unchanged and 1 kept seed.
