BUILD ENGINE — STAGE 5.3 CLOSEOUT (write gateway: GitHub commit and delivery)
Repository: https://github.com/inscope-labs/build-engine
Branch: phase-5/5.3-git-commit-delivery (stacked on phase-5/5.2-core-session-lifecycle, PR #14)
Baseline: phase-5/5.2-core-session-lifecycle @ 5c163ce
Date: 2026-10-27
Version: 0.5.0 (unreleased)
Plan stage: RELEASE-PLAN.md Phase 5, Stage 5.3 (implement GitHub commit/delivery)

STATUS: STAGE 5.3 IS COMPLETE. The `commit` route delivers. It validates the selection against the session,
checks that the branch is still at the head the capability names, creates exactly one commit whose parent is
that head, moves the branch to it, and records the commit durably. 222 tests pass against the real Worker, the
real Durable Object and the real provider client.

WHAT IS NOT IN THIS BRANCH, STATED PLAINLY. The gateway is NOT DEPLOYED — that is Stage 5.4.6 — and it has
never been run against the real GitHub, so nothing here may be read as a claim that a write gateway is
operational. The audit stream and the operator procedures are Stage 5.4. The remaining chaos tests (the
Durable Object eviction and the isolate eviction) and the CI wiring are Stage 5.5. The Phase 5 exit gate is
therefore not met.

THE ONE DESIGN DECISION THAT CHANGED THE ARCHITECTURE. The Durable Object performs the commit, not the
Worker. The Stage 5.1 sketch had the Worker make the GitHub call and pass the result back to the Durable
Object to record, and that leaves a window: the commit has landed on the branch and the session has not yet
recorded it. A crash in that window means the next attempt does not know that the commit happened, and the
expected-SHA precondition — the thing that stops a duplicate — cannot tell "my commit never landed" from
"my commit landed and I did not write it down". So the delivery happens inside the Durable Object, in the
same serialised handler that writes the session's state: the commit's outcome and the state that records it
change together, or not at all. The cost is that a provider call holds the session's request queue for the
length of that call, which is bounded by the provider timeout and is the right trade for a task that has one
writer. `docs/architecture.md` says this in full.

WHAT STAGE 5.3 ASKED FOR, AND WHAT EXISTS NOW

  5.3.1  Implement a fixed-destination GitHub client with bounded timeouts and safe error mapping.
         DONE. `src/commit/github-client.ts`. The client reads the repository, the branch and the credential
         from the configuration and has no parameter that a request could reach: there is no method that
         creates a repository, a branch or a folder, merges, opens a pull request, pushes anywhere else,
         deletes, or force-pushes. Every call is bounded by an abort signal, so a provider that accepts the
         connection and then says nothing cannot hold the call open. The provider's status and body are never
         passed through: the body is not even read, and the status becomes one of the gateway's own codes
         (`provider-rate-limited`, `provider-unavailable`, `provider-rejected`, `provider-credential-invalid`,
         `expected-sha-conflict`).

  5.3.2  Validate the selected file list against staged, non-deleted, policy-compliant files; reject path
         escapes and unlisted paths.
         DONE. `src/commit/selection.ts`. A selected path that is not a live staged file is refused with
         `409 file-not-staged` — it is not silently dropped, because a commit with fewer files than were asked
         for is a surprising commit. A tombstoned path is refused the same way. A file whose content was lost
         to an eviction is refused, because the inventory still lists it and the memory does not have it. The
         placeholder is never committable. A repeated path is `400 repeated-parameter`. The type policy and
         the size limits are re-checked at commit time, so the policy is the authority at the moment of the
         commit and not only at the moment of the write. The path is resolved inside the task folder and a
         resolution that would leave it is refused: "the path is safe" and "the path, resolved, is in the
         folder" are two different statements, and the second is the one that matters at a commit.

  5.3.3  Make commit idempotent for the same selection and content; reject ambiguous retries and same
         idempotency key with different content.
         DONE. The digest of the commit's logical payload (the selection and the content hash of each
         selected file) is computed first, and the idempotency key is either the client's or derived from the
         digest, so a plain retry with no key is idempotent too. The same key with the same digest replays
         the recorded outcome with `result.replayed = true`. The same key with a different digest is
         `409 idempotency-conflict` — never a second commit, never a silent overwrite.
         The order of the checks is the one correction the contract needed, and it is in the contract now:
         the idempotency lookup comes FIRST, before the other preconditions. A replay is not a new commit,
         and none of a new commit's preconditions apply to it — the branch has moved (that is what the first
         commit did) and the selection may have been tombstoned since. If the lookup came last, the
         "committed, response lost" case of protocol section 13.3 would answer `409 expected-sha-conflict`
         and the agent would have had no way to find out that its commit had landed.

  5.3.4  Handle provider rate limits, 5xx retries, timeout-after-success, partial failure, expected SHA
         conflicts, and concurrent commits without duplicate or unexpected writes.
         DONE, and this is the part of the stage that needed the most care. The commit is made in two steps:
         the OBJECTS (a blob per file, a tree, a commit object) and the DELIVERY (the branch is moved to that
         commit). The objects are content-addressed and unreferenced, so a failure there leaves nothing on the
         branch and the whole step may be repeated safely. The delivery is one call and is never repeated
         blindly. If it fails in a way that leaves the outcome unknown — a timeout, a network failure, a 5xx
         — the gateway goes and LOOKS at the branch: the branch is at the commit, so it landed; the branch is
         still at the expected head, so it did not, and the update is repeated with the same sha; the branch
         is somewhere else, so the outcome cannot be told apart and the answer is `409 reconcile-required`.
         The gateway never guesses, and never issues a second commit to find out.
         A rate limit is definite — the provider refused before acting — so it is retried with backoff. A
         4xx is definite, so it is mapped to its code and not retried. The tests cover all of it: a transient
         5xx, a persistent 5xx, a rate limit, a refused credential, a moved branch, a partial failure, a
         timeout after the provider acted, a timeout before it acted, and two commits at once. Every one of
         them ends with ONE commit on the branch, or with none.

  5.3.5  Commit only into the designated task submission folder on the approved build-engine
         repository/branch. Do not create branches, merge, or publish upstream from the gateway.
         DONE. The client's every path is under `/repos/{configured repo}/git/`, and the only ref it can
         touch is the configured branch; the test asserts that no request went anywhere else. The ref update
         is `force: false`, so a non-fast-forward is refused by the provider as well as by the gateway. The
         task folder is not created: the commit walks the tree to the folder first and refuses with
         `404 task-folder-missing` when it is not there, which is what protocol section 12.3 requires. The
         tree is the base tree plus the selected files, so the rest of the repository is carried over
         untouched, and the test asserts that the placeholder and the repository's own README both survive.

  5.3.6  Record commit SHA, selected paths, hashes, actor/task binding, result, and timestamp in redacted
         audit metadata.
         DONE. The durable commit record holds the sha, the selected paths, the per-file content hashes, the
         actor, the task, the work order, the result and the timestamp. The AUDIT record holds the sha and
         the digest of the selection — not the paths. A record that lists the agent's file names is a record
         of the agent's content, and the digest identifies the selection without naming it. The audit schema
         is a fixed one (ADR 0004): the session says which of the extra fields may be written and the router
         copies exactly those, so nothing from the result is merged in wholesale. The provider's own error
         body never reaches a log line, a response or a record.

  5.3.7  Seal only after the contract-defined successful commit/delivery state; repeated commit/seal requests
         must return consistent idempotent outcomes.
         DONE. The seal requires a commit record, and the commit record now exists through the agent route,
         so `409 seal-requires-commit` is reachable and tested. A repeated seal is NOT an error: it returns
         the recorded outcome, with `replayed = true`, and the state stays `sealed`. This needed one change
         in the authorisation policy: a sealed task refuses every operation except the index and the seal.
         The contract says so in section 8.4 ("a repeated seal is not an error") and in the list of what a
         seal refuses (write, read, status, commit — not seal), and the policy now matches it. A repeated
         commit is idempotent in the same way.

THE CONTRACT CLARIFICATIONS STAGE 5.3 SURFACED. They are recorded in `docs/protocol.md` and
`docs/error-catalog.md` in this branch, not silently diverged from.

  1. The precondition order in section 8.1 was wrong, and the correction is in the contract. The idempotency
     lookup is now check 0, before the session state and before the branch head, with the reason written down.
  2. "One capability, one commit" is now stated. The commit's parent is pinned to the head the capability was
     minted against, so the first commit moves the branch and a second commit under the same capability finds
     a head that no longer matches. A task that needs two commits needs two capabilities. This is a
     consequence of the precondition rather than a rule of its own, and the workflow it implies is open — see
     the questions below.
  3. The commit is made in two steps, and the split is now in the contract, because the failure modes are
     answerable only because of it.
  4. What the agent sees when the provider fails is now in the contract, with the four provider codes.
     `provider-rate-limited` is the provider's limit on the gateway; `rate-limited` is the gateway's limit on
     the agent. They are different codes because the remedy is different.
  5. The commit's author and committer are the gateway itself, and the identity is configuration
     (`GITHUB_COMMIT_AUTHOR`), never a request parameter. A commit that carried the agent's identity could
     not be told apart from a commit a person made by hand.
  6. The separator between the paths in `files` is a literal comma and each path is percent-encoded on its
     own. The contract already said this; what is new is that the refusal names the mistake, because the
     `file-not-staged` code on its own would not.

A DEFECT STAGE 5.3 FOUND AND CLOSED. F0-034. The type policy produced three failure reasons that are not in
the error catalogue — `denied-name`, `denied-extension` and `binary` — and the callers passed the reason
straight through as `error.code`. An undefined code is a server fault to `errorSpec`, so a request the policy
refused was answered 500: an agent that appended to a file whose name the policy denies, or sent a NUL byte,
was told that the GATEWAY had failed. A retry policy that retries 500s would have retried a request that could
never succeed. The status-codes test did not catch it, because the catalogue and the code table did agree —
the leak was between the policy and the catalogue. The fix is `typeFailureCode()` in the policy itself, so
that the policy is what knows what its reasons mean.

THE DEFECT REGISTER. F0-004 and F0-009 carry their Stage 5.3 updates. F0-033 (the Durable Object's
interleaved handlers, found and closed in Stage 5.2) is unchanged. F0-034 is new and closed. The register's
file-level counts are current: `gateway/write/src` is 52 files and none of them is a stub; `gateway/write/tests`
is 37 files, of which two are Stage 5.5 chaos stubs.

HOW THE TESTS EXERCISE THE PROVIDER. The mock GitHub is a real HTTP server on loopback, not a mock at the
client's interface. That matters more than it sounds: a mock at the interface level would leave the client's
own code — the URL it builds, the headers it sends, the timeout it enforces, the way it reads a status —
untested, and that code is exactly where a delivery goes wrong. The mock implements the part of the Git Data
API the gateway uses, over an in-memory repository with nested trees, and it can be told to fail in the ways a
provider fails: a scripted status, a persistent status, a delay, and a hang that either applies the change
before the answer arrives or does not. That last one is what makes the timeout-after-success case testable at
all. The shas are not git's; they are deterministic digests of the content, which is all the client needs —
it treats a sha as an opaque name, and the determinism is what lets a repeated attempt produce the same
commit object.

VERIFICATION, AS EXECUTED

  (cd gateway/write && npm run typecheck)
    tsc --noEmit                                  → clean
    tsc --noEmit -p tsconfig.test.json            → clean   (src, scripts and the tests)

  (cd gateway/write && npm test)
    # tests 222
    # pass  222
    # fail  0

  (cd gateway/write && npm run check:bundle)
    Total Upload: 192.80 KiB / gzip: 55.07 KiB
    env.TASK_SESSION (TaskSession)                → Durable Object
    env.SUBMISSIONS_REPO / BRANCH / FOLDER_TEMPLATE, env.MAX_TTL_SECONDS, env.LEASE_SECONDS
    env.workers_dev (false)
    The bundle grew from 156.59 KiB to 192.80 KiB (gzip 45.70 → 55.07 KiB) — the commit path. It is well
    inside the Workers limit, and the growth is recorded here rather than discovered later.

  python3 gateway/write/scripts/check-contract-consistency.py
    OK: the contract documents agree
    (the catalogue and the code table define the same 44 codes)

  GitHub Actions, run 40486013345 on this branch's head:
      ci: completed / success
        test:                              completed / success
        write gateway (typecheck, tests + bundle): completed / success
          npm run typecheck                                                     -> success
          Unit, integration and load tests (the real Worker and the real DO)  -> success
          Bundle dry run                                                       -> success

  The repository baseline, re-run on this branch:
    python3 -m unittest discover -s template/engine/tools      Ran 79 tests — OK
    python3 -m unittest discover -s gateway/read/reference     Ran 15 tests — OK
    release/test-release.sh                                   22 passed, 0 failed
    bash tests/test_update.sh                                 22 passed, 0 failed
    release/package.sh dist + release/verify.sh                verify: OK (41 files, version 0.5.0)
    The artifact is unchanged at 41 files and contains no gateway or contract content: `tar tzf` finds zero
    paths under `gateway`.

WHAT STAGE 5.3 DELIBERATELY DID NOT DO

  - It did not deploy anything, and it did not run the gateway against the real GitHub. There is no provider
    credential in any environment this branch has been exercised with; the mock is the only provider the
    tests have ever spoken to.
  - It did not create the audit stream, the metrics endpoint, the operator procedures or the deployment
    configuration. Those are Stage 5.4.
  - It did not finish the chaos suite: the Durable Object eviction and the isolate eviction tests are still
    stubs, and they are Stage 5.5's.
  - It did not touch `RELEASE-PLAN.md`. Progress is recorded here, per the repository's convention.
  - It did not add a second commit path. There is one, and it is the one the contract describes.

RESIDUAL RISKS, AND WHAT IS STILL OPEN

  R0-005, R0-006, R0-007 and R0-008 remain open. Of them, R0-007 — the indeterminate commit state — is now
  what the contract calls `409 reconcile-required`, and the gateway produces it honestly: it looks at the
  branch and refuses to guess. What it does not yet have is the operator-side procedure for reconciling one,
  and that is Stage 5.4.5.

  The risk this stage adds is new and it should be named: **the gateway has never spoken to GitHub.** Every
  provider behaviour in this stage is modelled by a mock. The mock was written from the Git Data API's
  documented shapes, and the client's URL construction, headers, timeouts and status mapping are exercised
  against real HTTP — but the first run against the real API may differ in details the documentation does not
  settle (the exact error body shape, the rate-limit headers, whether a repository configured to sign commits
  signs the commits the API creates, which would make a commit's sha non-deterministic). The first real
  delivery should be a rehearsal against a throwaway repository.

  The `GITHUB_API_BASE` setting exists for GitHub Enterprise Server, and it accepts plain HTTP only for a
  loopback address, because the credential is in every request.

FIVE QUESTIONS FOR THE OPERATOR

  1. ONE COMMIT PER CAPABILITY. The expected-SHA precondition means a capability authorises exactly one
     commit, so a task that needs two commits needs two capabilities, each minted against the head the
     previous one produced. Is that the intended workflow, or should the operator mint a fresh capability per
     commit, with the agent asking for one when it needs a second commit? The second is friendlier to an
     agent and weaker: the agent would be able to re-commit at will, and the expected-SHA check would stop
     protecting anything.
  2. THE COMMIT'S AUTHOR IDENTITY. It defaults to `build-engine write gateway <ctxwrite@users.noreply.github.com>`
     and `GITHUB_COMMIT_AUTHOR` changes it. Should it name a person, a team, or a bot account? A bot account
     is the cleanest for a gateway, because it can be given the narrowest scope and it is obvious in a
     repository's history that the commit came from the gateway.
  3. THE PROVIDER'S TOKEN SCOPE. The code is now fixed to one repository and one branch. The scope of the
     token itself is still the operator's, and `scripts/check-token-scope.ts` — which checks the configured
     repository against the token's scope — is Stage 5.5. The protocol's section 12.4 states the residual
     risk of a repository-scoped credential plainly: a leak could modify any task's submissions in that
     repository, and nothing else.
  4. THE COMMIT'S API COST. A commit costs roughly `4 + 2 × (number of files)` provider calls: the task
     folder is resolved by walking the tree one level at a time, and each file is a blob. For the ten files a
     task may hold, that is about twenty-four calls. A recursive tree listing would be one call instead of
     four, at the cost of a large response on a large repository, and a truncated listing cannot answer the
     question reliably. The current shape is the precise one; the operator may prefer the cheap one.
  5. THE SEAL'S IDEMPOTENCY KEY. The seal accepts an `idem` key and records it, so that a retry with the same
     key replays the recorded outcome. The seal's outcome is deterministic anyway — it is the recorded seal —
     so the key adds little. It is kept because the contract's parameter table defines it, and removing a
     documented parameter is a contract change rather than an implementation detail.
