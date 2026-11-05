# Phase 6.3 — Closeout: the failure and recovery pilot

- Stage: **6.3** of `RELEASE-PLAN.md` (Phase 6, "Cross-system integration and real pilot") — *"Failure and recovery pilot"*.
- Date: 2026-11-05.
- Source commit: `3028b7d` (`main`, the commit this branch was cut from; it contains Stage 6.2, merged as PR #37, and the two `User-Agent` fixes, merged as PRs #41 and #42).
- Branch: `phase-6/6.3-failure-recovery-pilot`.
- Governing documents: `docs/release/DEFECT-REGISTER.md` (addendum A11), `docs/release/PHASE-6.2-CLOSEOUT.md`.

## 1. Intent and scope

Stage 6.2 proved that the workflow **works**. This stage proves what happens when it does
not. Plan tasks 6.3.1 to 6.3.5, and what was actually done:

| Task | What it asks for | Done? |
|---|---|---|
| 6.3.1 | requests interrupted during staging, commit and seal; the state and the recovery follow the contract | **yes** |
| 6.3.2 | gateway restart/eviction, GitHub rate limiting, network timeout, stale content and conflicting updates simulated | **yes** |
| 6.3.3 | the operator can distinguish "not committed", "committed but response lost", "sealed", "revoked" and "unknown; reconcile required" | **yes** |
| 6.3.4 | a second task runs concurrently and no task/session state or files cross boundaries | **yes** |
| 6.3.5 | all the observed deviations are documented, and the pilot is repeated after the remediation | **yes** — one deviation, F0-075, remediated and the pilot re-run |

## 2. What was built

| What | Where |
|---|---|
| The pilot itself: every scenario, and the evidence | `ops/staging-failure-pilot.py` |
| The fault injector between the gateway and the provider | `ops/provider-fault-proxy.py` |
| The fault injector's own tests | `ops/test_provider_fault_proxy.py` |
| The workflow that runs the pilot with the staging credential, by hand | `.github/workflows/staging-failure-pilot.yml` |

### 2.1 What is real and what is simulated

This is the question a failure pilot has to answer before its evidence means anything, so it
is answered first.

| Real | Simulated |
|---|---|
| the gateway: the shipped Worker, the shipped Durable Objects, the shipped runtime | the provider's behaviour: a rate limit, a timeout, an answer that never arrives, a connection that is reset |
| the provider: the real GitHub API, the real credential, the real disposable branch | the gateway's own memory: it is stopped and started again, so the staged bytes are lost and the inventory is not |
| the operator's tooling: the shipped `mint-root-url.ts`, the shipped plan tooling | nothing else |

The fault is injected by a loopback proxy that sits between the gateway and GitHub and
forwards everything it is not told to break, byte for byte. The gateway is doing exactly the
work it would do in production; only the weather is fake.

The proxy's modes are the ones the plan asks for:

| Mode | What the provider sees | What the caller sees |
|---|---|---|
| `status` | nothing | the rule's status, with no upstream call at all |
| `hang_before` | nothing | nothing: the connection is held open and the caller's own timeout fires |
| `hang_after` | the real request, applied | nothing: the answer is discarded, so the caller cannot tell whether it was applied |
| `reset` | nothing | the connection is closed without an answer |

`hang_after` is the important one. It is the only mode that can produce "the provider acted
and the answer was lost", which is the case that must never produce a second commit.

The proxy is deliberately dull about what it keeps: the method, the path and what it did. It
never logs a header, a body or a query value, because a fault injector that logs the
credential is a fault injector that leaks it. The pilot checks that at the end, and the
proxy's own test suite checks it as well.

## 3. The pilot's identifiers

The same identifiers as Stage 6.2, plus the tasks the new scenarios need. Every scenario
that moves the branch needs its own task, because a capability pins the branch head and a
commit moves it.

| What | Value |
|---|---|
| plan | `pilot-001` |
| work order A (sixteen tasks) | `10008-S001` |
| work order B (the concurrent task) | `10008-S002` |
| tasks | `10008-1-201-01` to `10008-1-217-01` |
| writer | `agent-pilot` |
| key id | `sk1` |

The task folders are the operator's claim before the order is issued (protocol section
12.3), so the pilot seeds them itself, and only the ones that are not on the branch yet: a
second run of the pilot does not touch the branch at all.

## 4. The evidence

The pilot's own transcript, as it printed it. The whole run is **120 checks**, and every
one of them passed. The plan's task each block answers is in the block's title.

```
== the disposable estate ==
   branch:   staging/submissions
   head:     822bc053fc792dd26d718f94510258f5128a42ab
   seeded 17 task folder(s), the ones the pilot needs
   the fault proxy: http://127.0.0.1:21997

== the write gateway, on the local runtime ==
   http://127.0.0.1:21998
   ok   the write gateway answers (200)
   scheme ctxwrite-v1, environment staging, branch None

== 6.3.1  the staging, interrupted by a restart ==
   ok   the file was staged (200)
   ok   the staged content reads back byte for byte before the interruption
   --- the gateway is stopped and started again: an eviction with nothing else ---
   ok   the session is still there after the restart (200)
   ok   the inventory survived the restart: the file is still listed
   ok   the content is reported as missing (missing)
   ok   no bytes are claimed for the lost content
   ok   the sequence metadata survived the restart (last_seq 1)
   ok   the loss is reported, not hidden (bytes_lost 77)
   ok   create resets the file and says so (resurrected True)
   ok   the content was sent again (200 None)
   ok   the content reads back byte for byte after the recovery
   ok   the recovered file committed (6d283e879789a31a1c578714ae47ded9fadc593d)
   ok   the branch head is the commit
   ok   the recovered file is in the task's folder on the branch
   ok   the file on the branch holds exactly the bytes that were staged

== 6.3.1  the commit, interrupted after the provider acted ==
   ok   the file was staged (200)
   ok   the gateway says the commit landed (98b221e01e87326537dbe72a1856d81cb75bb8a8)
   ok   the branch head is the commit: it really did land
   ok   exactly one commit was added to the branch (1)
   ok   the file on the branch holds exactly the bytes that were staged
   ok   the retry is a replay, not a second commit (replayed True)
   ok   the replay names the same commit
   ok   the branch head did not move
   ok   the provider was asked to move the branch exactly once (1)

== 6.3.2  the provider does not answer at all ==
   ok   the file was staged (200)
   ok   the gateway says the provider did not complete the request (503 provider-unavailable)
   ok   the branch did not move: nothing was committed
   ok   exactly one commit object was created (1)
   ok   the branch update was attempted twice, and neither was answered (2)
   --- the provider comes back: the retry must deliver the same commit ---
   ok   the retry landed the commit (15c02cbd46a39ad47f4594e70cb03c94183570eb)
   ok   the branch head is the commit
   ok   no second commit object was created (1)
   ok   exactly one commit was added to the branch (1)
   ok   the file on the branch holds exactly the bytes that were staged

== 6.3.1  the commit, interrupted while somebody else moved the branch ==
   ok   the file was staged (200)
   ok   the gateway refuses to guess (409 reconcile-required)
   ok   the branch is at the other commit: the gateway did not move it
   ok   exactly one commit object was created (1)
   ok   the only commit on the branch is the other one (1)

== 6.3.2  the provider's rate limit ==
   ok   the file was staged (200)
   ok   the commit landed after the rate limit cleared (51c65a8877d20a8d67dd5edde8f89b694d66b2ca)
   ok   the branch head is the commit
   ok   exactly one commit was added to the branch (1)
   ok   the branch update was attempted three times: two rate limits and one success (3)
   --- a rate limit that does not clear ---
   ok   the file was staged (200)
   ok   the gateway says the provider is rate limiting it (429 provider-rate-limited)
   ok   the branch did not move: nothing was committed

== 6.3.2  the branch moved under the capability ==
   ok   the file was staged (200)
   ok   the branch moved under the capability
   ok   the stale capability is refused (409 expected-sha-conflict)
   ok   the branch did not move again
   ok   the gateway never tried to move the branch (0)
   --- two writers, one head ---
   ok   the first writer's commit landed (a0681a2a22d71534707498b2a6dbb344131a3541)
   ok   the branch head is the first writer's commit
   ok   the second writer, holding the same head, is refused (409 expected-sha-conflict)
   ok   the branch head is still the first writer's commit
   ok   the second writer's file is not on the branch

== 6.3.1  the seal, interrupted ==
   ok   the file was staged (200)
   ok   the commit landed (9dbd2cc047306023517cb392cca95e5103cc1f69)
   ok   the task is sealed
   --- the gateway is restarted: the seal is durable ---
   ok   the task is still sealed after the restart (sealed)
   ok   the sealed task still refuses everything but the index (410 task-sealed)
   ok   a write after the seal is refused (410 task-sealed)
   ok   a repeated seal returns the recorded outcome
   ok   the recorded seal names the commit

== 6.3.1  the seal request, interrupted in flight ==
   ok   the file was staged (200)
   ok   the commit landed (3377f6fce8d0f546d11a206fb771652fb49a05db)
   the seal request answered 0 before the gateway was killed
   ok   the interrupted seal left a legal state behind (open)
   ok   the commit record survived the interruption
   ok   the seal can be re-issued after the interruption (200 None)

== 6.3.3  the five outcomes, and that they are distinguishable ==
   ok   not committed: the commit is refused because the file was never staged (409 file-not-staged)
   ok   not committed: the branch did not move
   ok   the file was staged (200)
   ok   committed, response lost: the gateway found its own commit on the branch (8bf5bc689585e7c2b6da92e072bf3bb272410a82)
   ok   committed, response lost: the retry replays the commit (200 None)
   ok   committed, response lost: exactly one commit is on the branch
   ok   sealed: a write is refused with the seal's own code (410 task-sealed)
   ok   revoked: the operator revoked the task (200)
   ok   revoked: the capability no longer works (410 task-revoked)
   ok   the file was staged (200)
   ok   unknown; reconcile required: the gateway refuses to guess (409 reconcile-required)
   ok   unknown; reconcile required: the branch is at the other commit, not the gateway's
   --- the five answers ---
   not committed                409 file-not-staged 
   committed, response lost     200  True
   sealed                       410 task-sealed 
   revoked                      410 task-revoked 
   unknown; reconcile required  409 reconcile-required 
   ok   the five outcomes are distinguishable: no two of them answer the same way

== 6.3.4  two tasks at once ==
   ok   the first capability is bound to its own task and order
   ok   the second capability is bound to its own task and order
   ok   the two tasks resolve to two different folders
   plans/pilot-001/submissions/10008-S001/10008-1-212-01
plans/pilot-001/submissions/10008-S002/10008-1-213-01
   ok   both tasks staged their file at the same time
   ok   the first session holds only its own file (['only-a.md'])
   ok   the second session holds only its own file (['only-b.md'])
   ok   the first capability cannot read the second task's file (404 file-not-found)
   ok   the second capability cannot read the first task's file (404 file-not-found)
   ok   a path out of the task's own folder is refused (400 malformed-path)
   ok   the first task committed (35857437cbf446fa3b71915c7a71a380f0361fbc)
   ok   the second task committed (918a10aa4d533e5332a04ffc9fdd8a69c0ba37b7)
   ok   the first task's file is in the first task's folder
   ok   the second task's file is in the second task's folder
   ok   the first commit changed exactly its own file in its own folder (['only-a.md'])
   ok   the second commit changed exactly its own file in its own folder (['only-b.md'])
   ok   the first commit touched nothing in the second task's folder
   ok   the second commit touched nothing in the first task's folder
   ok   the first task's file on the branch holds exactly the bytes it staged
   ok   the second task's file on the branch holds exactly the bytes it staged
   ok   the first task was revoked (200)
   ok   the second task is unaffected by the first task's revocation (200)
   ok   the first order's audit stream holds the first task's records
   ok   the first order's audit stream holds none of the second task's
   ok   the second order's audit stream holds the second task's records
   ok   the second order's audit stream holds none of the first task's
   order 10008-S001: 66 record(s), tasks ['10008-1-201-01', '10008-1-202-01', '10008-1-203-01', '10008-1-204-01', '10008-1-205-01', '10008-1-206-01', '10008-1-207-01', '10008-1-208-01', '10008-1-209-01', '10008-1-210-01', '10008-1-211-01', '10008-1-212-01', '10008-1-214-01', '10008-1-215-01', '10008-1-216-01', '10008-1-217-01']
   order 10008-S002: 7 record(s), tasks ['10008-1-213-01']

== the deployed staging gateways are unaffected ==
   ok   the deployed gateways still pass the Stage 6.2 probes

== nothing that must not be seen is anywhere it could be seen ==
   the audit stream of 2 order(s): 15520 bytes
   ok   the signing secret is not in the audit stream
   ok   the operator token is not in the audit stream
   ok   the provider credential is not in the audit stream
   ok   the staged content is not in the audit stream
   ok   a capability signature is not in the audit stream
   ok   the signing secret is not in the fault proxy's log
   ok   the operator token is not in the fault proxy's log
   ok   the provider credential is not in the fault proxy's log
   ok   the fault proxy logs the method, the path and nothing else
   ok   the fault proxy's log holds no authorization header

== the result ==
THE FAILURE PILOT PASSED (120 checks)
rc=0
```

Two details in that transcript are worth naming, because both are contract behaviour rather
than accident:

- **The inventory is durable and the content is not.** After the restart the file is still
  listed, with its sequence metadata, and its content is reported as `missing`; the loss is
  counted (`bytes_lost 77`) rather than hidden, and `create` resets the file and says
  `resurrected`. The bytes come back because the agent sends them again, not because the
  gateway kept them.
- **The signature is not the authorisation, and the head is the concurrency control.** A
  capability whose head no longer matches the branch is refused with
  `409 expected-sha-conflict` before the gateway creates anything — the pilot checks that
  the provider was never asked to move the branch — and two writers holding the same head
  cannot both land.

## 5. The findings

One finding came out of the pilot, and it is a **contract deviation**, not a matter of taste.
It is recorded as **F0-075** in addendum A11, and it is closed in this stage.

**F0-075 — a provider failure at the branch move was answered `reconcile-required`, so a
retryable outage sent the agent to a human.**

The contract (protocol section 8.1) says how the delivery decides:

> If that call fails in a way that leaves the outcome unknown, the gateway **looks at the
> branch** and decides from what it finds: the branch is at the commit, so it landed; the
> branch is still at the expected head, so it did not, and the call is repeated; the branch is
> somewhere else, so the gateway **cannot tell**, and the answer is `409 reconcile-required`
> and a human.

The code implemented that, with one exception: when the **repeated** call also failed, the
code read the branch a second time, found that it was not at the commit, and answered
`409 reconcile-required` — without noticing that it was still at the expected head. The
"cannot tell" case is the branch being somewhere *else*. A branch that is demonstrably where
it was is not a case the gateway cannot resolve.

The contract's own table says what the agent should be told when the provider fails:

> | fail or time out (5xx, a timeout, a network failure) | `503 provider-unavailable` | yes, with backoff |

Every other step of the commit honours that row. The branch move was the only step that did
not, and it is the step where the answer matters most to the agent.

The pilot produced the case on the real provider: the provider did not answer the branch
update at all, the gateway read the branch before the attempt and after it, and the branch
was exactly where it was, twice over. The answer was `409 reconcile-required` — and the
pilot then showed that the situation needed **no human at all**: the same commit, with the
same idempotency key, landed on the retry, and one commit was on the branch. The gateway
could resolve it; it sent the agent to an operator instead, and it spent the one code the
contract reserves for "a human is needed" on a transient fault.

The remediation reads the branch after the second attempt and answers the three outcomes
separately:

| After the second attempt | The commit | The agent gets |
|---|---|---|
| the branch is at the commit | it landed | `200`, the commit |
| the branch is still at the expected head | it demonstrably did not land | `503 provider-unavailable` — retryable, and the retry delivers the same commit |
| the branch is somewhere else, or could not be read | it cannot be told | `409 reconcile-required`, and a human |

A refusal at the second attempt is also a refusal and not an unknown outcome, so it maps to
its own code (`409 expected-sha-conflict`) the same way the first attempt does.

**Closure evidence.** `gateway/write/src/commit/commit.ts` (`deliverCommit`); the contract's
decision procedure and its table made explicit in `gateway/write/docs/protocol.md` (sections
8.1 and 13.3), with `docs/error-catalog.md`, `docs/architecture.md`,
`docs/operator-runbook.md` and `docs/security-checklist.md` made to agree; three tests in
`gateway/write/tests/chaos/provider-status-mapping.test.ts`; and the write gateway's suite:
**372 tests, all passing**. The pilot was re-run after the change and passed every check.

## 6. What is not proved, and why

| Not proved | Why | What closes it |
|---|---|---|
| The failure scenarios against the **deployed** staging gateways | The scenarios interrupt the gateway: they stop the process and start it again, and they point it at a fault injector. A deployed Worker cannot be interrupted by a script | **R0-014**: the operator's decision on whether the deployed gateways get a fault-injection switch. It is a deployment change with a blast radius, and it is not this stage's to make |
| The **read gateway**'s failure behaviour | The read gateway has no staging, no commit and no seal: every scenario in 6.3.1 is a write-side concept. The read gateway's state and its refusals were proved in Stages 4.2, 4.3 and 6.2 | A read-side failure pilot, if the operator wants one |
| The **upstream publish/reconcile** step of 6.2.10 | The submissions-to-consumer transfer path is register entry **R0-011**, and it is not designed | R0-011. For staging the submission's home is the disposable branch |
| The **production** gateways | The production environments still have no Cloudflare secrets set, so every deploy-to-production run fails | The operator sets the production secrets; a production pilot is a separate stage |

## 7. What the operator has to do

1. **Decide on R0-014**: should the deployed staging gateways get a fault-injection switch, so
   that the failure scenarios can also be run against the deployed edge? The pilot as it
   stands runs them locally, and proves the deployed gateways are unaffected by them.
2. **Delete the three empty repositories** that Stage 6.1's probing created and that the
   credential cannot see or delete: `inscope-labs/build-engine-staging-source`,
   `inscope-labs/build-engine-staging-submissions`, `inscope-labs/be-staging-probe2`
   (public).
3. **Dispose of the estate** when the pilot is finished with it (`ops/staging-estate.py
   dispose`), and apply the production branch protection recorded as R0-004.

## 8. How to run it

```bash
# the failure and recovery pilot, against the real provider
GITHUB_TOKEN=<a credential that can write to the disposable branches> \
  python3 ops/staging-failure-pilot.py

# the same, with the deployed staging gateways checked at the end
GITHUB_TOKEN=... \
  READ_BASE=https://ctxgate-read-staging.qnuralink.workers.dev \
  WRITE_BASE=https://ctxgate-write-staging.qnuralink.workers.dev \
  python3 ops/staging-failure-pilot.py

# the fault injector's own tests
python3 -m unittest discover -s ops -p 'test_*.py'
```

It is also runnable by hand from GitHub: `.github/workflows/staging-failure-pilot.yml`, from
`main`, with the staging environment's `WRITE_GH_TOKEN`. The output is checked for the value
of every secret before it is kept.

## 9. Honest limits of this closeout

- The pilot **interrupts the gateway on the local runtime**. The local runtime is the shipped
  runtime and the shipped Worker, but it is not the deployed edge; the deployed edge is
  covered by the no-secret probes the pilot runs at the end, and by the R0-014 decision.
- The pilot's **agent side** is the shipped engine's tooling, driven by a script rather than
  by a live model. What is proved is the gateway's contract and the file movement; what is
  not proved is any agent's behaviour.
- The **fault injector is a proxy**, so the provider's failures are the ones the injector
  produces, not the ones GitHub produces. A real rate limit carries `Retry-After` and a real
  5xx is not the same as a dropped connection; the pilot covers the *shapes* the gateway has
  to survive, and the shapes are the ones the contract names.
- The **estate** is a single repository with two disposable branches, so the pilot does not
  exercise a real consumer repository, a real submission repository, or a transfer between
  them (R0-011 again).
- The pilot's plan, orders and tasks are **synthetic** — a real Class B task would come from
  the operator's own planning. The tooling, the gateway and the refusal behaviour are the
  real ones.
