BUILD ENGINE — STAGE 5.5 CLOSEOUT (write gateway: the real test suite and the CI gates)
Repository: https://github.com/inscope-labs/build-engine
Branch: phase-5/5.5-real-tests-and-ci-gates (stacked on phase-5/5.4-audit-operations, PR #16; base main)
Baseline: phase-5/5.4-audit-operations @ e87300f, merged with main @ 1348f99
Date: 2026-10-27
Version: 0.5.0 (unreleased)
Plan stage: RELEASE-PLAN.md Phase 5, Stage 5.5 (replace stub tests with real tests)

STATUS: STAGE 5.5 IS COMPLETE. The last two stubs in the module are gone — the Durable Object eviction test and the
isolate eviction test — and the CI gates are real: four gates on every pull request, three on a schedule, and a
staging rehearsal that publishes nothing. The unit suite now covers every module that had no test, the adversarial
suite covers the malformed and the cross-task cases, the chaos suite covers the evictions and every row of the
provider's status table, the load suite fills the published quota and concurrency envelope to its edges, and the
log-hygiene check plants a sentinel in the capability URL and the signature as well as in the three secrets and the
payload. **362 tests pass.** The stage also found and closed two defects: F0-063 (the staging operations did not
apply the path rules) and F0-064 (`main`'s release manifest named a file that does not exist, and `main`'s CI has
been red since the Stage 1.1 merge).

WHAT IS NOT IN THIS BRANCH, STATED PLAINLY. The gateway is NOT DEPLOYED. The deploy workflow has never been run, the
production environment has never been created, and the gateway has never been run against the real GitHub — every
provider behaviour in the suite is a mock. The pilot is Stage 6. The Phase 5 exit gate is therefore still not met,
and no write-gateway capability is claimed as operational.

WHAT STAGE 5.5 ASKED FOR, AND WHAT EXISTS NOW

  5.5.1  Pin a test runner compatible with the supported Node version and Workers/Miniflare APIs; resolve the
         previous npm 10 test-runner installation issue rather than leaving export {} test stubs.
         DONE, and the pin is now checked. The runner is Node 22's built-in one with type stripping — the
         decision Stage 5.2 made and Stage 5.4 recorded — and `package.json` now says so: `engines.node` is
         `>=22.18.0 <23` (type stripping is on by default from 22.18), and there are **five** runner scripts
         (`test`, `test:unit`, `test:integration`, `test:load`, `test:chaos`) so that each CI gate runs one
         suite rather than all of them.
         The pin is not a comment. `tests/unit/config/test-inventory.test.ts` reads the runner's globs out of
         `package.json` and checks that **every** test file in the repository is reachable from one of them. The
         trap that cost real time in Stage 5.2 — a glob that matches nothing is silent, and the suite reported 36
         passing tests while no unit test had run — is now a failing test rather than a story. The same file
         checks that **no file in `src/`, `scripts/` or `tests/` is a stub**: the Phase 5 exit gate's "no 501
         handler or placeholder source/test stubs remain in any feature claimed as supported" is a statement
         about the whole module, and it is now mechanical.

  5.5.2  Unit-test every auth, path, type, quota, sequence, tombstone, idempotency, seal, and error mapping
         module.
         DONE. The modules that had no unit test of their own now have one: the authorisation policy (the
         capability and session levels, the expiry boundary, the three closures), the tombstones (the live set
         and the released bytes), the seal (its precondition), the rate limit (the fixed window, and the rule
         that a refused request must not push the window's reset out), the error mapping (the error type, the
         envelope's fixed shape, the help link), the counters, the status view, the encodings (base64url and
         SHA-256, with the well-known digests as vectors) and the retry policy (every row of the table the module
         documents). The unit suite is 247 tests.

  5.5.3  Integration-test the Worker and Durable Object using a local harness and mocked GitHub API.
         DONE, and the harness is now honest about what it models. The integration suite (85 tests) drives the
         real Worker and the real Durable Object class over an in-memory storage and the real provider client
         against a mock GitHub that is an actual HTTP server on loopback. The harness was extended with the two
         evictions the runtime can perform, and the two are now distinguishable: `restart()` recycles the
         Durable Object's instance and keeps its storage, and `evict()` drops both.

  5.5.4  Test malformed inputs, missing env, bad signatures, expired/revoked links, cross-task reads/writes,
         traversal, binary files, oversized content, quota boundaries, and concurrent writers.
         DONE, and it **found a defect**. `tests/integration/adversarial-inputs.test.ts` drives thirteen paths
         that fail a rule through all five operations that carry a path, the cross-task cases (a task's files are
         not another task's files, even with the same writer and the same order), a capability re-pointed at
         another order, the malformed parameters, the unknown and the repeated and the destination parameters, a
         missing and a broken setting, and the binary, the non-UTF-8 and the oversized content. The path case
         failed: see F0-063 below.

  5.5.5  Test isolate eviction/restart, duplicate requests, network timeout after upstream commit, GitHub
         403/404/409/422/429/5xx, and recovery.
         DONE. The two stubs are now tests. `tests/chaos/do-eviction.test.ts` is the Durable Object eviction: the
         inventory survives, the content does not, the loss is **reported** (`bytes_lost`), the ledger is
         reconciled, a read says `file-not-staged`, the agent recovers by creating the file again and sending the
         content, and the commit record and the seal survive, so a commit that already landed is not landed
         again. `tests/chaos/isolate-eviction.test.ts` is the Worker's isolate: the Worker's isolate holds no
         agent state at all, so a recycled isolate loses the staged content, the commit record, the seal and the
         idempotency store not at all.
         `tests/chaos/provider-status-mapping.test.ts` is new, and it walks **every row** of the table in
         `src/commit/retry.ts` at two call sites: the head read and the branch move. The two call sites differ on
         purpose — a 404 on the head read is `gateway-misconfigured` (the configured branch is not there) and a
         404 on the branch move is `provider-rejected` (the provider refused) — and the test proves the
         difference is there. It also proves the provider's body never reaches the agent.

  5.5.6  Test log hygiene by injecting sentinel secrets and payloads, then asserting they never appear in
         captured logs.
         DONE, and the check is stronger. The sentinel set now includes the **capability URL** and the
         **signature**, which are the agent's own secret and the proof of it, and every console channel is
         captured, not only `log` — a record that reaches `console.error` is just as leaked. The response
         headers are captured too. And the check can now be shown to **fail**: `findLeaks` is exported and the
         test feeds it a synthetic leak and insists that it is found, because a check that cannot fail proves
         nothing.

  5.5.7  Add bounded load and chaos tests for the approved concurrency and quota envelope; no test should
         deploy or write to production.
         DONE. `tests/load/quota-envelope.test.ts` fills the published envelope to its edges — 20 live files,
         245760 bytes, 12288 bytes for one file, 30 requests per 60 seconds, one writer at a time — and checks
         that every limit holds and that every refusal is the documented one. The test is bounded on purpose: a
         load test that runs until something gives way is a test whose result depends on the machine it ran on.
         It moves the **test clock** between the phases instead of waiting for the rate window to reset, so it
         does not depend on the wall clock either. Nothing in the suite deploys anything, nothing holds a
         deployment credential, and the provider address is a loopback one.

  5.5.8  Add CI gates for unit, integration, typecheck, bundle, security, log hygiene, and load/chaos suites
         appropriate to pull request versus scheduled/staging runs.
         DONE. The six files under `gateway/write/ci/` are no longer scaffolds: each is a complete job
         definition that says what the gate **is**, and the root `.github/workflows/` carries the copies that
         actually run, because GitHub only runs workflows from there.
         - **On every pull request and every push to main**: `write-gateway-lint` (the typecheck over three
           programs, the bundle dry run, and the contract consistency check — which Stage 5.1 wrote and Stage 5.5
           was always meant to wire in), `write-gateway-unit`, `write-gateway-integration`, and
           `write-gateway-deploy-gate` (the log-hygiene and credential-boundary gate, plus the credential's reach
           in the code).
         - **On a schedule and on demand**: `write-gateway-load`, `write-gateway-chaos`, and
           `write-gateway-staging-rehearsal` — the whole test suite, the contract check, the deploy gate and a
           bundle that is built, inspected and **not published**. The rehearsal is the only "staging" that exists
           today, and it is a rehearsal rather than a deployment on purpose: see the open question below.
         The two copies of each gate are checked against each other by `tests/unit/config/ci-wiring.test.ts`: the
         definition and the wired job must have the same name and run the same commands, the pull-request
         workflow must be triggered by a pull request and the scheduled one must not, no pull-request-triggered
         workflow may name a deployment credential, and the scheduled workflow must never run a publishing
         deploy. A gate that has drifted is worse than no gate, because it looks like a gate.

THE TWO DEFECTS STAGE 5.5 FOUND, AND CLOSED

  F0-063 — The staging operations did not apply the path rules.
    The contract validates the `path` parameter of `create`, `append`, `replace`, `read` and `delete` against
    the path rules of section 5.1 (protocol section 4.2), and the error catalogue defines `malformed-path` for
    exactly that failure. The implementation applied those rules in one place only: `src/commit/selection.ts`, at
    the commit. `checkPath` was called from nowhere else in `src/`. The probe, run against the pre-fix code:

        CREATE ../escape.md        -> 200 ok
        CREATE .git/config.md      -> 200 ok
        CREATE a/../b.md           -> 200 ok
        CREATE /abs.md             -> 200 ok
        CREATE notes/na~me.v1..2.md -> 200 ok      (legal: a component may contain ".." as a substring)

    The blast radius was bounded — the commit's selection refuses such a path, so nothing escaped the task
    folder — but the consequence was real: the staged file took a slot and a byte budget out of the published
    envelope, and the agent was told nothing until the commit refused it. The placeholder rule (protocol section
    12.3) was enforced only by accident, by the type policy, under the wrong code.
    The fix: `src/session/task-session.ts` checks the path with `checkPath` before the operation runs, and
    refuses it with `400 malformed-path` and a fixed message that does not echo the path (F0-035's rule). The
    contract was clarified at the same time — section 5.1 now says **where** the rules are enforced and why — and
    the error catalogue now points at the contract's path rules rather than promising that its own help link
    lists them.

  F0-064 — `main`'s release manifest named a file that does not exist, and had the two metadata roles the wrong
  way round.
    This one is not the write gateway's. The Stage 1.1 change (PR #21) rewrote `release/manifest.txt` to
    `managed engine/engine.json` and `seed engine/release.json`, and did not rename
    `template/engine/ENGINE.json` to `template/engine/release.json` — the Stage 1.1 closeout says the physical
    rename "remains a Phase 2 task" — and it swapped the roles of the two files. On a pristine checkout of
    `main` @ `1348f99`:

        $ release/package.sh dist
        package: manifest lists 'engine/release.json' but template/engine/release.json does not exist
        $ release/test-release.sh      →  4 passed, 18 failed
        $ bash tests/test_update.sh    →  5 passed, 17 failed

    So the packaging did not work at all, and **`main`'s CI has been red since the Stage 1.1 merge**: the four
    most recent runs on `main` (`40617447829`, `40617334926`, `40612975602`, `40612873665`) all failed, and the
    failing step is "Release machinery self-test", while the write-gateway job passed. The run before the merge
    (`40523784995`) passed. Every branch derived from `main` inherits it.
    The Stage 5.5 branch merged `main` (see below), so it inherited the breakage, and the fix is the rename the
    Stage 1.1 decision asked for plus the role correction: `template/engine/ENGINE.json` becomes
    `template/engine/release.json`, the machine metadata is **managed** (it is replaced on every update) and the
    consumer's configuration is the **seed** (it is installed only if absent), and the readers — `set-version.sh`,
    `verify.sh`, `test-release.sh`, `README.md`, `COMPATIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md`
    and `docs/STATUS.md` — follow.
    The operator should know that this is the same work Stage 3.1 does on `phase-3/3.1-allowlist-packaging`
    (register F0-013): the rename and the role correction are both in that branch's manifest. If the operator
    prefers to take PR #17 instead, this commit can be dropped and the two are equivalent.

WHY THIS BRANCH MERGED `main`, AND WHAT THAT COST
  The Phase 5 branches are stacked: 5.1 on the Phase 1 branches, 5.2 on 5.1, and so on, and every one of them is
  based on `main` @ `240e328`. `main` has moved since — PR #20 (the Phase 2.2b tooling hardening) and PR #21 (the
  Stage 1.1 product contract) — and a pull request from a Phase 5 branch to `main` would have **reverted** that
  work: `template/engine/tools/plan_tool.py`, `template/operator/cbridge` and `tests/test_cbridge.sh` would go
  back to their pre-hardening state, `template/engine/tools/test_plan_tool_hardening.py` would be deleted, and
  the `pending/` analysis would be dropped.
  So the branch merged `main` before it started. The only conflict was `docs/STATUS.md`, and it is resolved by
  keeping both statements: the `ctxwrite-v1` contract sentence from the Phase 5 branch and the Stage 1.1 approval
  paragraph from `main`. The merge is a separate commit, and it is the first thing to look at if the operator wants
  to see how the two lines of work meet.

VERIFICATION, AS EXECUTED

  (cd gateway/write && npm run typecheck)
    tsc --noEmit                                  → clean   (the source, with no Node types)
    tsc --noEmit -p tsconfig.test.json            → clean   (the source and the tests)
    tsc --noEmit -p tsconfig.scripts.json         → clean   (the scripts, with Node types)

  (cd gateway/write && npm test)
    # tests 362
    # pass  362
    # fail  0

  (cd gateway/write && npm run test:unit)          # tests 247   # pass 247   # fail 0
  (cd gateway/write && npm run test:integration)   # tests  85   # pass  85   # fail 0
  (cd gateway/write && npm run test:load)           # tests  12   # pass  12   # fail 0
  (cd gateway/write && npm run test:chaos)          # tests  18   # pass  18   # fail 0

  (cd gateway/write && npm run verify:log-hygiene)
    log hygiene: 18 outputs scanned, 0 findings
    static credentials: the source and the configuration scanned
    logging: every write to the platform's log goes through the audit logger
    workflows: no pull-request-triggered workflow holds a deployment credential
    deploy gate: OK

  (cd gateway/write && npm run check:token-scope -- --static)
    the credential's reach in the code: OK
    token scope check: OK (the static half only; no credential was presented)

  (cd gateway/write && npm run check:bundle)
    Total Upload: 202.58 KiB / gzip: 58.06 KiB
    env.TASK_SESSION (TaskSession)                → Durable Object
    env.AUDIT_STREAM (AuditStream)                → Durable Object
    --dry-run: exiting now.

  (cd gateway/write && npm run check:contract)
    OK: the contract documents agree
    (the catalogue and the code table define the same 44 codes)

  The repository baseline, re-run on this branch:
    python3 -m unittest discover -s template/engine/tools      Ran 110 tests — OK
    python3 -m unittest discover -s gateway/read/reference     Ran 15 tests — OK
    release/test-release.sh                                   22 passed, 0 failed
    bash tests/test_update.sh                                 22 passed, 0 failed
    bash tests/test_cbridge.sh                                36 passed, 0 failed
    release/package.sh dist + release/verify.sh                verify: OK (42 files, version 0.5.0)
    The artifact contains engine/VERSION, engine/engine.json and engine/release.json, and no gateway,
    conformance or variants path: `tar tzf` finds zero.

  The baseline numbers on `main` itself, for comparison: `release/test-release.sh` is 4 passed / 18 failed and
  `tests/test_update.sh` is 5 passed / 17 failed, because of F0-064.

THE THREE OPERATOR TOOLS THAT WERE STUBS, AND WHAT THEY ARE NOW
  `scripts/mint-root-url.ts` mints a capability URL offline, with the **shipped** signing code, so a capability
  minted locally is exactly one the gateway verifies. The signing keys come from the `SIGNING_KEYS` environment
  variable and never from an argument, so a secret does not end up in the shell history or in the process list,
  and the keys are never printed.
  `scripts/seed-test-repo.ts` prepares a throwaway repository: it creates the branch and the task folder with the
  `.keep` placeholder, because git does not store empty folders and the folder has to exist before the work
  order is issued. It is an operator tool with a wider reach than the gateway's own client — it can create a
  branch, which the gateway's client deliberately cannot — so it reads the credential from the environment,
  refuses to run without an explicit confirmation, and refuses to touch a branch that already exists.
  `scripts/check-token-scope.ts` is the credential's scope check, which the Stage 5.4 closeout explicitly left to
  Stage 5.5. Its **static** half — the provider client's method list is the credential's entire reach inside this
  codebase, and a method that creates a branch, merges, deletes or force-pushes would widen it — runs in CI on
  every pull request. Its **live** half asks GitHub what scopes the credential carries and refuses the ones the
  gateway has no business holding (`workflow`, `admin:*`, `delete_repo`, `write:packages` and the rest). A
  credential whose scopes cannot be determined is **not** passed silently: the check fails and says what to
  confirm by hand. The rules live in `src/policy/token-scope.ts`, so the script and the test cannot disagree.

WHAT STAGE 5.5 DELIBERATELY DID NOT DO
  - It did not deploy anything, and it did not create the production environment or its secrets.
  - It did not implement a **staging deployment**. The scheduled workflow's third job is a *rehearsal*: the whole
    test suite, the contract check, the deploy gate, and a bundle that is built, inspected and not published. A
    real staging deployment would need a staging environment, a staging host and a staging credential, none of
    which exist, and the gateway has never been deployed at all. The first deployment is the operator's decision.
  - It did not speak to the real GitHub. Every provider behaviour in the suite is the mock, and the details a mock
    cannot tell you (the error body shape, the rate-limit headers, whether a repository that signs commits makes
    a commit's sha non-deterministic) are exactly what the first real delivery will answer.
  - It did not touch `RELEASE-PLAN.md`. Progress is recorded here, per the repository's convention.
  - It did not close the Phase 5 exit gate. The exit gate asks that "the operator can revoke/close a task and
    verify that further writes are denied" — that is implemented and tested — and that the staging/commit/seal
    workflow works end to end, which it does **against a mock**, not against the real provider.

RESIDUAL RISKS, AND WHAT IS STILL OPEN
  The load and chaos suites run against the in-memory harness and the loopback mock. They are bounded and they are
  deterministic, but they are not the platform: a real Durable Object's storage semantics, its concurrency and its
  eviction behaviour are modelled here, not exercised. The first deployment should watch the write latency, as
  Stage 5.4's closeout said, and the first real commit is the rehearsal Stage 5.3's closeout asked for.
  The `total-bytes-exceeded` code is a second line of defence rather than a reachable outcome **with the published
  envelope**: `max_files × max_file_bytes` is exactly `max_total_bytes` (20 × 12288 = 245760), so the file count
  is reached at the same moment as the byte budget. The load test asserts that relationship rather than hiding
  it, and the code path is exercised directly by the unit test.
  R0-005 (the GET-with-side-effects risk) remains open by decision. R0-007 (the indeterminate commit state) is
  produced honestly as `409 reconcile-required`, and the chaos suite now covers the three ways the gateway reaches
  it.

FIVE QUESTIONS FOR THE OPERATOR

  1. THE STAGING RUN. Stage 5.5 wired a scheduled **rehearsal** — the whole gate and a bundle that is not
     published — because a staging deployment needs a staging environment, a staging host and a staging credential,
     and none of them exist. Should a real staging environment be created, so that the scheduled workflow can
     deploy to it and exercise the gateway against the real platform? That is a question about infrastructure and
     about the operator's Cloudflare account, and it is the last thing between the test suite and the pilot.
  2. THE TOKEN SCOPE. The static half of the credential check is in CI, and the live half needs a credential the
     operator holds. A **classic** token with the `repo` scope reaches every repository the account can reach, not
     only the submissions repository — that is the residual risk the contract records in section 12.4 — and the
     check reports it rather than hiding it. A fine-grained token is the way to reduce it, and the check cannot
     read a fine-grained token's permissions from the API, so it fails closed and asks for a manual confirmation.
     Which kind of credential will the operator use, and should the check's rule about classic tokens be made
     stricter?
  3. THE TWO METADATA FILES. The rename and the role correction of F0-064 are Stage 3.1's work and are applied
     here. The operator may prefer to take PR #17 and drop the commit here; the two are equivalent. What matters
     is that the machine metadata is **managed** and the consumer's configuration is the **seed**, because that is
     what the shipped `update.sh` and the consumer flow assume.
  4. THE CREDENTIAL BOUNDARY, ONE MORE TIME. The gateway's credential is repository-scoped, and the path
     confinement is the gateway's own code. A commit is made in two steps, the branch move is never retried
     blindly, and a timeout is resolved by looking at the branch rather than by committing again. The first
     real delivery is still the rehearsal Stage 5.3 asked for, against a throwaway repository, before the
     submissions branch is used for real work.
  5. THE LOAD AND CHAOS GATES' CADENCE. They run nightly. A nightly run is a promise that is re-checked while
     nobody is waiting; a weekly one would be cheaper, and an hourly one would catch a regression sooner at the
     cost of the runner minutes. The operator's call.
