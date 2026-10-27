BUILD ENGINE — STAGE 5.4 CLOSEOUT (write gateway: audit, privacy and operations)
Repository: https://github.com/inscope-labs/build-engine
Branch: phase-5/5.4-audit-operations (stacked on phase-5/5.3-git-commit-delivery, PR #15)
Baseline: phase-5/5.3-git-commit-delivery @ ba5bf89
Date: 2026-10-27
Version: 0.5.0 (unreleased)
Plan stage: RELEASE-PLAN.md Phase 5, Stage 5.4 (implement audit, privacy and operations)

STATUS: STAGE 5.4 IS COMPLETE. The audit record is structured, redacted and durable; the operator can read an
order's stream over HTTP; the log-hygiene check plants a sentinel in every place a secret could be and drives
the whole protocol with them in place; the operator runbook is written; and the deployment workflow exists, is
gated, and cannot be reached from a pull request. 243 tests pass.

WHAT IS NOT IN THIS BRANCH, STATED PLAINLY. The gateway is NOT DEPLOYED. The deploy workflow has never been
run, the production environment has never been created, and the gateway has never been run against the real
GitHub. The remaining chaos tests (the Durable Object eviction and the isolate eviction) and the CI wiring are
Stage 5.5. The pilot is Stage 6. The Phase 5 exit gate is therefore not met, and no write-gateway capability is
claimed as operational.

THE TWO COPIES OF THE AUDIT STREAM, AND WHY THERE ARE TWO

  The **platform's log** is the complete stream. Every request writes exactly one JSON line there, including the
  requests that never authenticated, and the operator's log retention decides how long it is kept. It is where
  the refusals that never reached a session appear, because they have no order.

  The **durable stream** is a second Durable Object class, one instance per ORDER. It is what
  `{base}/admin/audit?order=…` reads, it survives a log pipeline that samples, and it is bounded — the oldest
  records are pruned by age, and an unbounded audit log is a disk-filling denial of service.

  The requests that never authenticated are NOT in the durable stream. An order's stream is about that order, and
  a single global instance for the unattributed refusals would be a denial of service with extra steps: every
  unauthenticated request would queue behind one Durable Object. Those refusals are counted in the metrics and
  appear in the platform's log, which is where an operator watches for abuse. The runbook says so in the
  section on monitoring.

  The Durable Object does not trust the record it is handed. It REBUILDS the record from the fields it is
  handed, through the same fixed-schema gate the platform's log uses, and refuses to store a record that still
  contains something that looks like a secret. A bug in the Worker, or a compromised one, cannot put a
  capability into the durable store. That is the same principle as the commit's in-flight entry: the state that
  records a fact is written by the thing that holds the fact.

WHAT STAGE 5.4 ASKED FOR, AND WHAT EXISTS NOW

  5.4.1  Implement structured, redacted audit logging and counters.
         DONE. The audit record is built field by field from a fixed schema (`src/audit/redaction.ts`), one JSON
         object per line, written to the platform's log and kept in the durable stream. The record carries the
         identifiers, the counts, the reason and the commit's sha and the digest of its selection — and never
         the file's name, the file's content, the capability, the query string or the provider's error text.
         The counters are extended with a per-code breakdown, the accepted bytes and the count of failed
         durable writes, and `/admin/metrics` now says what it is: `scope: worker-instance`, because the
         counters are per isolate and a number that looks like a total and is not is worse than no number.

  5.4.2  Verify no root URL, signature, payload, base64 content, GitHub token, or raw sensitive query is
         emitted to logs, errors, metrics, traces, or analytics.
         DONE. The check is a DRIVER, not a set of assertions, and the same driver backs the unit test and the
         deploy gate — a gate that is a second implementation of the check is a gate that checks something
         else. It plants a sentinel in the signing secret, the provider token, the operator token, the
         capability URL, the signature, the file's content, its base64 and a file name; drives the real Worker
         through the whole protocol and through the failure paths with them in place; captures every log line,
         every failure body, the metrics and the durable records; and checks each of them for the sentinel
         values AND for the shapes that look like a secret. There is no tracing and no analytics in the
         gateway, so there is nothing to leak into.
         The static half is in the same gate: the gateway's own source is scanned for the shapes of real
         credentials, and nothing but the audit logger may write to the platform's log.

  5.4.3  Apply no-store and cache-control headers, suppress response bodies that echo sensitive query data,
         and test redirects/caches.
         DONE. The header set was already in place; what was missing was the test and one real leak. The
         transport-hygiene test drives eight routes and asserts the whole header set on each, that no route
         ever answers with a 3xx, that the responses are not documents, that a failure body contains neither
         the query string nor a value the client supplied, and that the capability path is never echoed.
         THE LEAK: the `unknown-parameter` and `repeated-parameter` messages named the offending parameter, and
         a parameter's name is text the client supplied. See F0-035 below.

  5.4.4  Add explicit error catalog and operator runbook for 400/401/403/404/409/410/413/429/5xx.
         DONE. The error catalogue was written in Stage 5.1 and has grown with the code: 44 codes, each with a
         status, a retryability and the corrective action, and the catalogue and the code table are checked
         against each other by the consistency script AND by a unit test, so they cannot drift. The RUNBOOK is
         written now: `docs/operator-runbook.md`, with the three secrets and what each one grants, the
         operator-only routes, the procedure for each of the ten operator actions, the error semantics in one
         table, and four incident procedures.

  5.4.5  Add secret rotation, capability revocation, work-order closure, abuse response, and provider
         credential rotation procedures.
         DONE. The runbook has all five, with the exact commands and the order to do them in:
         - **signing key rotation**, which has NO outage: several key ids are served at once, so a new key is
           added, new capabilities are minted under it, and the old key id is removed when its last capability
           has expired. Removing a key id revokes every capability signed with it, immediately — which is the
           lever to pull in an incident.
         - **capability revocation** and **work-order closure**, with the distinction the contract makes
           between the three closures, and the note that a revocation is not reversible and does not delete
           anything.
         - **abuse response**: what the counters look like under attack, why the blast radius of a
           pre-signature refusal is zero, and where to look.
         - **provider credential rotation**, with the window it has and the fact that a commit in flight during
           it fails with a non-retryable code, which is the correct behaviour.
         The runbook also says plainly what it does NOT cover: the submissions-to-consumer transfer path
         (R0-011), the pilot (Stage 6), and the token-scope check (Stage 5.5).

  5.4.6  Keep deployment credentials out of pull-request jobs; deploy only from protected, reviewed refs.
         DONE. `.github/workflows/deploy.yml` is triggered by a push to `main` or by a manual
         `workflow_dispatch` — and by NOTHING a pull request can trigger. Its credentials come from the
         `production` ENVIRONMENT's secrets, not the repository's, so a deployment is a decision a reviewer
         makes rather than a side effect of a merge. The gate runs the whole test suite, the contract
         consistency check and the log-hygiene gate before the deploy job, and the deploy job builds the
         bundle before it publishes it.
         And the property is CHECKED, not just asserted: the gate reads every workflow in
         `.github/workflows/` and fails if one that a pull request can trigger references a deployment
         credential. A later edit that adds a pull-request trigger to the deploy workflow fails the gate
         rather than passing quietly.

A DEFECT STAGE 5.4 FOUND AND CLOSED. F0-035. The `unknown-parameter` and `repeated-parameter` messages built
their text from a query parameter's name: `the parameter "<name>" is not part of this operation`. A parameter's
name is text the client supplied, and protocol section 10.3 requires a failure response to contain no "query
value that the client supplied verbatim". The stricter reading of that sentence includes a name, and the same
sentence is the one the whole design rests on: the response body is built from a fixed schema so that a value
that is not in the schema has no path into it. An exception for the message text was not written down anywhere,
and it is exactly the kind of exception that grows.

The fix: a failure message may name a parameter THE CONTRACT DEFINES — a fixed set — and never one the client
invented. `unknown-parameter` now names the operation's own parameters, and `repeated-parameter` names the
repeated parameter only when the contract defines it. The contract's section 10.3 states the rule, and the
transport-hygiene test drives four failure paths and asserts that none of them echoes a query value.

The body is JSON with `Content-Type: application/json` and `X-Content-Type-Options: nosniff`, so this was not a
script-injection vector, and the string was the client's own, so nothing was disclosed. The cost was the
exception itself, and that is what was closed.

A HAZARD THIS STAGE FOUND IN ITS OWN TEST HARNESS, AND FIXED. The first version of the sentinel check made a
REAL request to `api.github.com`. The test environment did not set the provider's base URL, so the client used
its default, and the check sent a token-shaped sentinel to the real GitHub, which rejected it. No real
credential was involved — the sentinel is a string the test invents — and nothing was disclosed. But a test
suite must not be able to reach the internet, and a token-shaped string leaving the machine is exactly the
habit that leads to a real one leaving it.

The fix: the test environment's provider address is now a DEAD LOOPBACK ADDRESS by default, so a test that
forgets to point it at the mock fails fast and locally. `tests/unit/config/no-internet.test.ts` is the guard
that keeps it that way, and the configuration validator refuses a plain-HTTP address that is not loopback, so
the credential cannot leave over an unencrypted hop even if the setting is misconfigured.

VERIFICATION, AS EXECUTED

  (cd gateway/write && npm run typecheck)
    tsc --noEmit                                  → clean   (the source, with no Node types)
    tsc --noEmit -p tsconfig.test.json            → clean   (the source and the tests)
    tsc --noEmit -p tsconfig.scripts.json         → clean   (the scripts, with Node types)

  (cd gateway/write && npm test)
    # tests 243
    # pass  243
    # fail  0

  (cd gateway/write && npm run verify:log-hygiene)
    log hygiene: 16 outputs scanned, 0 findings
    static credentials: the source and the configuration scanned
    logging: every write to the platform's log goes through the audit logger
    workflows: no pull-request-triggered workflow holds a deployment credential
    deploy gate: OK

  (cd gateway/write && npm run check:bundle)
    Total Upload: 200.93 KiB / gzip: 57.58 KiB
    env.TASK_SESSION (TaskSession)                → Durable Object
    env.AUDIT_STREAM (AuditStream)                → Durable Object
    env.AUDIT_RETENTION_SECONDS ("86400")
    env.workers_dev (false)

  (cd gateway/write && npm run check:contract)
    OK: the contract documents agree
    (the catalogue and the code table define the same 44 codes)

  The repository baseline, re-run on this branch:
    python3 -m unittest discover -s template/engine/tools      Ran 79 tests — OK
    python3 -m unittest discover -s gateway/read/reference     Ran 15 tests — OK
    release/test-release.sh                                   22 passed, 0 failed
    bash tests/test_update.sh                                 22 passed, 0 failed
    release/package.sh dist + release/verify.sh                verify: OK (41 files, version 0.5.0)
    The artifact is unchanged at 41 files and contains no gateway or contract content: `tar tzf` finds zero
    paths under `gateway`.

  The typecheck now runs three programs, and the reason is worth recording: the deploy gate imports the test
  harness, and the test harness uses Node's `http`, `crypto` and `Buffer`. The source program must NOT have
  the Node types, or a source file could quietly use a Node API that the Workers runtime does not have. So
  the scripts have their own program (`tsconfig.scripts.json`), and the source program is checked without
  Node types exactly as before.

WHAT STAGE 5.4 DELIBERATELY DID NOT DO

  - It did not deploy anything, and it did not create the production environment or its secrets. The workflow
    is written and gated; running it is the operator's decision, on the operator's host, with the operator's
    acceptance of the residual transport risk in writing.
  - It did not implement the token-scope check (`scripts/check-token-scope.ts`). The scope of the provider's
    credential is the operator's, and the check is Stage 5.5's. The runbook says so where it matters.
  - It did not finish the chaos suite: the Durable Object eviction and the isolate eviction tests are still
    stubs, and they are Stage 5.5's.
  - It did not touch `RELEASE-PLAN.md`. Progress is recorded here, per the repository's convention.

RESIDUAL RISKS, AND WHAT IS STILL OPEN

  The risk this stage does NOT remove is the one it documents: the transport is a GET with side effects, and an
  intermediary, a TLS-terminating proxy or the platform's own request log may retain the full request URL,
  path and query (protocol section 10.1). The mitigations are the header set, the rate limit, the short-lived
  capability and the one-writer rule. The residual risk is **accepted, not eliminated**, and the acceptance is
  a process step the operator must make in writing at deployment time. The runbook says so in section 2.2.

  R0-005 (the GET-with-side-effects risk) remains open by decision. R0-007 (the indeterminate commit state) is
  now produced honestly — `409 reconcile-required` — and the runbook gives the operator the four steps to
  resolve one, but the procedure has not been exercised against a real incident.

  The audit stream is **new state that has never run in production**. The Durable Object's storage semantics,
  the pruning, and the cost of a write on every request have been exercised only by the tests. The first
  deployment should watch the write latency.

FIVE QUESTIONS FOR THE OPERATOR

  1. THE AUDIT RETENTION. The default is one day (`AUDIT_RETENTION_SECONDS`, 86400), bounded at seven. The
     platform's log retention is the operator's own setting and is not pinned by the gateway. How long should
     an order's durable stream be kept, and should it differ from the log's retention?
  2. THE OPERATOR TOKEN. It is a single secret, so its rotation has a brief window in which the old value is
     dead and the new one is not yet in the operator's hands. The signing keys rotate with no outage because
     several are served at once. Should the operator token be a map too, the way the signing keys are? That is
     a change to the contract, not a workaround, and it is the operator's call.
  3. THE COMMIT AUTHOR IDENTITY, again. It defaults to `build-engine write gateway
     <ctxwrite@users.noreply.github.com>` and `GITHUB_COMMIT_AUTHOR` changes it. Stage 5.3 raised it; the
     answer is still open, and a bot account is the cleanest because it can be given the narrowest scope.
  4. THE DEPLOYMENT'S ENVIRONMENT. The workflow deploys to a `production` environment whose secrets the
     operator holds. Should the environment require reviewers (so a deployment is a decision), or should the
     push to `main` be enough (so it is a consequence of the merge)?
  5. THE HOST. The workflow does not probe the deployed gateway, because the operator's host name is the
     operator's decision. The runbook says to check it by hand after the first deployment. Should the first
     deployment be a rehearsal against a separate environment, with the real one after it?
