BUILD ENGINE — STAGE 5.2 CLOSEOUT (write gateway: core request and session lifecycle)
Repository: https://github.com/inscope-labs/build-engine
Branch: phase-5/5.2-core-session-lifecycle (stacked on phase-5/5.1-protocol-contract, PR #13)
Baseline: phase-5/5.1-protocol-contract @ d20535ac0f0a939c9dfef5a134f4d2edd0a46a4b
Date: 2026-10-27
Version: 0.5.0 (unreleased)
Plan stage: RELEASE-PLAN.md Phase 5, Stage 5.2 (implement core request and session lifecycle)

STATUS: STAGE 5.2 IS COMPLETE FOR THE CORE. The Worker routes and authenticates, the Durable Object holds the
session, and staging, sequencing, replay, quotas, the type policy, the writer lease, the seal, the operator's
revocation and closure, the hypermedia links, the audit record and the fail-closed environment validation are
implemented and tested. 171 tests pass against the real Worker and the real Durable Object.

WHAT IS NOT IN THIS BRANCH, STATED PLAINLY. The GitHub delivery is Stage 5.3: the `commit` route answers the
documented `501 not-implemented`, and the four `src/commit/*` modules say so in their first lines. The chaos
suite, the GitHub test helpers and the CI wiring are Stage 5.5. The gateway is NOT DEPLOYED — that is Stage
5.4.6. The Phase 5 exit gate is therefore not met, and no write-gateway capability is claimed as operational.

WHAT STAGE 5.2 ASKED FOR, AND WHAT EXISTS NOW

  5.2.1  Replace the 501 Worker entry with validated routing and consistent response envelopes.
         DONE. `src/index.ts` and `src/router.ts` replace the 501 handler. The router answers one route
         table: the contract documents, `/healthz`, the operator channel under `/admin`, and the capability
         route. Every response — success or failure — is the same JSON envelope, built field by field in
         `src/http/responses.ts` from the schema in protocol section 4.3. The only route that answers 501
         is `commit`, and that is a documented code (see 5.2.10 below).

  5.2.2  Implement root URL parsing, canonical signature verification, authorization policy, and fail-closed
         environment validation.
         DONE. `src/auth/root-url.ts` parses the fixed-arity capability path and the query string; the
         query is percent-decoded as a URI component, so a `+` is a plus and not a space, and the raw
         value is kept so that a `%2C` inside a file name is not mistaken for the separator.
         `src/auth/signature.ts` implements the canonical eight-field message and the domain-separated
         HMAC-SHA256, compared inside the WebCrypto verifier so that the comparison does not leak the
         position of the first differing byte. `src/auth/policy-authz.ts` holds the expiry, the maximum
         lifetime and the session-state decisions. `src/config/env.ts` validates the environment and throws
         a `ConfigError` naming the setting that is wrong — never a value — and the Worker answers
         `503 gateway misconfigured: <setting>` and serves nothing.

  5.2.3  Implement Durable Object single-writer coordination with race-safe claim/release, lease expiration,
         and explicit 409 behaviour.
         DONE. `src/session/writer-claim.ts` implements the lease; `src/session/task-session.ts` holds it.
         The first writer claims it, the same writer renews it, a different writer is refused with
         `409 writer-conflict`, and an EXPIRED lease may be taken by any writer — otherwise a writer that
         crashed would deadlock its task forever. The lease duration is a setting (`LEASE_SECONDS`, default
         300). The Durable Object's handlers are serialised through an explicit request queue: see the
         finding below, which is why that queue exists.

  5.2.4  Implement sequence numbers, chunk hashes, idempotent append/replay, conflicting replay
         rejection, and bounded memory usage.
         DONE. `src/session/sequence.ts` implements the decision table of protocol section 6.2: the next
         sequence number is accepted, a repeated `(seq, hash)` is a replay, a different hash at an old
         sequence number is a conflict, a sequence number that skips one is a gap, and a replay that has
         fallen out of the window is a conflict rather than a replay. The replay window is bounded at 16
         entries per file, so the session's memory is bounded however often a file is appended to.
         `src/session/idempotency.ts` is the operation-level store, and it is durable: it is the one piece
         of state that must survive an eviction, because it is the only thing that can prove a commit
         already happened.

  5.2.5  Implement create/scaffold, append, replace, read-back, status/list, and soft delete/tombstones.
         DONE. `src/staging/` has one module per operation. `create` scaffolds, resurrects a file whose
         content was lost, and resurrects a tombstone. `append` and `replace` write one chunk each, with
         the same sequence and replay rules, and a write to an unknown path creates the file. `read` returns
         the staged bytes, their hash and their sequence number, and distinguishes "never staged" (404) from
         "staged and then lost" (409). `status` reports the inventory, the quota usage and, per file,
         whether its content is still there. `delete` tombstones the file, releases its slot and its bytes,
         and keeps its place in the inventory.

  5.2.6  Implement quota accounting atomically across requests and concurrent retries; count bytes in a
         single agreed unit.
         DONE. `src/session/quota-accounting.ts` is the ledger and `src/policy/quotas.ts` is the checks.
         The unit is bytes, authoritative, and the KiB means 1024 bytes. The ledger counts LIVE state: a
         tombstone frees a slot and its bytes, and content lost to an eviction frees its bytes too, with
         the loss reported as `bytes_lost` rather than hidden. The accounting happens inside the Durable
         Object, atomically with the change it accounts for, because the handlers are serialised — the
         concurrency test is the evidence.

  5.2.7  Implement strict path safety, extension/type policy, UTF-8 and text-only checks, size limits, and
         optional schema validation.
         DONE. `src/policy/path-safety.ts` implements protocol section 5.1 with no normalisation: a
         component that is exactly `..` is refused, a component that merely CONTAINS `..` is a legal file
         name, and a hidden component, a Windows device name, a trailing dot or space, a control character
         and an over-long or over-deep path are all refused. `src/policy/type-policy.ts` implements the
         allow-list, the denied names and extensions, the valid-UTF-8 requirement, the NUL-byte check that
         catches binary content, the per-type ceiling, and the empty-file rule. The optional schema
         mechanism exists and every schema is null: no schema is specified yet, and the protocol's section
         15 records that as an open question.

  5.2.8  Implement hypermedia links for every valid next step and corrective-help responses for errors.
         DONE. `src/hypermedia/links.ts` builds the next-step links. Every successful response carries
         `links.next`; a sealed task carries none, because the only legal next step is to stop. A link is
         root-relative and never carries the capability, because a body that carries the capability is a
         body that gets logged. A link never offers an operation that is illegal in the current state: a
         `seal` is not offered before a successful commit, and nothing is offered after a seal. A link
         never contains a parameter value the client has not been told: where the value is unknown, the
         parameter is listed in `required`. Every failure carries `links.help`, which is the error
         catalogue's anchor for the code.

  5.2.9  Implement seal as an irreversible freeze of the task folder; distinguish seal, work-order closure,
         and operator revocation as separate state transitions.
         DONE. `src/seal/seal.ts` implements the seal; `src/session/task-session.ts` holds the state. There
         is no unseal operation, and every write after a seal is `410 task-sealed`. The three closures are
         three states, not one flag, with three codes: `task-sealed` (the agent finished), `task-revoked`
         (the operator tore it down) and `order-closed` (the work order is over). A seal requires a
         successful commit — `409 seal-requires-commit` — per plan task 5.3.7.

  5.2.10 Ensure revoked/closed tasks cannot continue staging or committing, even if a URL remains otherwise
         well-formed.
         DONE. The state is checked in the Durable Object, after the capability has been verified and
         before the operation is even looked at. A revoked or closed task refuses every write with its own
         code, whatever the URL looks like. The revocation and closure are operator-only: they are
         reachable through the operator channel, which has its own credential, and the agent has no route
         to them. A sealed task still answers the index, so that an agent can learn WHY it stopped.

THE EVIDENCE

  Every number below is the output of the command as written, run in this repository on this branch.

  (cd gateway/write && npm run typecheck)
      tsc --noEmit                          → clean
      tsc --noEmit -p tsconfig.test.json    → clean
      (the second pass typechecks src, scripts and the tests, with the Node types)

  (cd gateway/write && npm test)
      # tests 171
      # pass  171
      # fail  0

  (cd gateway/write && npm run check:bundle)
      Total Upload: 156.59 KiB / gzip: 45.70 KiB
      env.TASK_SESSION (TaskSession) — Durable Object
      env.SUBMISSIONS_REPO, env.SUBMISSIONS_BRANCH, env.SUBMISSIONS_FOLDER_TEMPLATE,
      env.MAX_TTL_SECONDS, env.LEASE_SECONDS, env.workers_dev (false)

  python3 gateway/write/scripts/check-contract-consistency.py
      OK: the contract documents agree
      (14 section anchors, 39+ references resolved, the catalogue and the code table define the same
      40 codes, the published quota block equals src/config/quotas.json, all 19 published types equal
      src/config/type-policy.json, no example host in the agent prompt)

  python3 -m unittest discover -s template/engine/tools
      Ran 79 tests in 4.037s — OK

  python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'
      Ran 15 tests in 1.350s — OK

  release/test-release.sh
      22 passed, 0 failed

  bash tests/test_update.sh
      22 passed, 0 failed

  release/package.sh dist
      dist/build-engine-v0.5.0.tar.gz

  release/verify.sh dist/build-engine-v0.5.0.tar.gz
      verify: OK (build-engine-v0.5.0.tar.gz: 41 files, version 0.5.0)

  The release artifact is unchanged: 41 files, exactly as on main. No gateway or contract content is
  packaged.

  The tests are not mocks of the code under test. `tests/helpers/mock-worker.ts` runs the REAL
  `TaskSession` class over an in-memory storage, and the integration tests drive the REAL Worker's
  `fetch`. The only thing mocked is the Durable Object's storage and the platform's clock, and the clock
  is pinned rather than faked, because the contract's expiry boundary is inclusive and the maximum
  lifetime is enforced against the gateway's own clock.

A DEFECT THIS STAGE FOUND AND CLOSED

  F0-033, in the defect register. Eight concurrent appends of the same chunk against one task produced a
  48-byte file instead of a 6-byte one: every request read the same `last_seq`, decided the chunk was
  new, and applied it. A Durable Object is single-threaded, but a handler that awaits something that is
  not a storage operation — a SHA-256 digest, a text decoder — yields, and the next request's handler
  starts in the meantime.

  The sequence, replay and quota rules all assume that a request's read of the session state and its write
  of it are atomic. Without that, a retry storm from an agent or a proxy could corrupt a file and inflate
  the byte budget while every individual response looked like a success.

  The fix is an explicit request queue in `TaskSession`: every internal route runs through it, so one
  request runs to completion before the next one starts. `tests/load/concurrent-writers.test.ts` asserts
  that exactly one writer is admitted, that a chunk applied concurrently is applied once, and that the
  accepted bytes are counted once.

  The finding is worth recording because of how it was found: the first version of the test script used
  the glob `tests/unit/*.test.ts`, which matches **nothing** — every unit test lives in a subdirectory.
  The suite reported 36 passing tests and looked green while none of the unit tests had run. The glob is
  now `tests/**/*.test.ts`, and the suite reports 171. Plan rule G-06 ("do not claim a test passed unless
  its command ran and its output was inspected") is the reason this was caught rather than shipped: the
  number of tests was compared with the number of test files, and they did not add up.

CONTRACT CLARIFICATIONS THIS STAGE MADE

  Implementing a contract surfaces its ambiguities. These are recorded in `docs/protocol.md` and
  `docs/error-catalog.md` in this branch, and they are listed here because they change the contract and
  the operator should see them.

  1. `docs/protocol.md` section 4.2 said the raw query must not contain an encoded comma, while section
     4.2.7 said a comma inside a file name is `%2C` and is unambiguous. The two contradicted each other.
     Section 4.2.7's rule governs: the `files` value is split on the RAW value and each element is
     decoded afterwards. Section 4.2 now says so.
  2. The envelope's `task` and `order` are `null` when the request did not parse far enough to learn them,
     which happens only on a refusal that precedes the capability being read.
  3. `result.replayed` is `true` on an idempotent replay. The contract already said the original outcome
     is returned "with `result.replayed = true`"; the envelope now says where the flag lives.
  4. A chunk write to an unknown path creates the file, for `append` as well as for `replace`. The
     contract said `replace`; the two now behave the same way, so there is one rule to remember.
  5. The rate limit is not in the verification order of section 14.3. It is a resource control and it
     runs BEFORE the ordered checks, for the same reason the read gateway's abuse gate runs first: a
     flood must be bounded before any other work is done. The contract now says so.
  6. An EXPIRED writer lease may be taken by any writer, not only by the writer that held it. Otherwise a
     writer that crashed would deadlock its task forever, which is exactly what the expiry exists to
     prevent. An ACTIVE lease is still not reclaimable by a different writer.
  7. Two new parameter rules, and one new error code:
       - `400 destination-not-selectable` — the request tried to name a repository, a branch or a folder.
         The parameter names are listed in the contract.
       - `400 invalid-parameter` — a required parameter is missing, or a value does not have the required
         form. The code did not exist; the contract now names it, and the catalogue and the code table
         agree on it (the consistency check proves it).
  8. The error catalogue gained `invalid-parameter`, and the catalogue and `src/http/status-codes.ts` are
     now checked against each other by both the consistency script and a unit test, so the two cannot
     drift.

WHAT THIS STAGE DELIBERATELY DID NOT DO

  - It did not implement the GitHub delivery. That is Stage 5.3, with its own seven tasks and its own
    decisions about retries and provider error mapping. The `commit` route answers `501 not-implemented`,
    which is a documented code, so a 501 is never confused with a protocol error.
  - It did not write the chaos suite, the GitHub test helpers, the fixtures, or the CI wiring. Stage 5.5.
  - It did not deploy anything. It did add one line to the repository's `.github/workflows/ci.yml`: the
    write gateway's CI job now runs `npm test` as well as the typecheck and the bundle dry run. A pull
    request whose CI does not run its own tests is weak, and the 171 tests are the evidence for this
    stage. The full gate set of plan task 5.5.8 — the security, log-hygiene and load/chaos suites, and
    the pull-request versus scheduled split — is still Stage 5.5.8.
  - It did not write the operator runbook's procedures. Stage 5.4.4.
  - It did not write the Phase 6 security sign-off. Stage 6.
  - It did not edit `RELEASE-PLAN.md`. Progress is recorded in this closeout, per the repo's convention.

  One thing this stage did settle that plan task 5.5.1 owns: **the test runner**. It is Node 22's built-in
  runner with type stripping — `node --import ./tests/helpers/register.mjs --test "tests/**/*.test.ts"` —
  which is the same runner the read gateway has used since Stage 4.2, and it needed no new dependency and
  no npm 10 workaround. The Markdown loader hook in `tests/helpers/md-loader.mjs` exists because the
  gateway serves the contract documents and the bundler loads them with a `Text` rule; the Node runner
  needs the same thing done for it.

RISKS AND RESIDUAL RISK

  - R0-005 (GET-based mutation) is unchanged: the transport is still GET-only, and the residual risk of
    caching, prefetching and intermediary logging of the request URL is accepted, not solved. The
    contract's section 10.1 says so, and section 10.2 requires the deployment to exclude the capability
    path prefix from the platform's log retention.
  - R0-006 (the credential is not path-scoped) is unchanged in substance. The gateway holds a
    repository-scoped credential for the submissions repository, and the code confines what it chooses to
    write, but a leak of the credential itself would reach every task's submissions in that repository.
  - R0-007 (ambiguous commit outcomes) is still open in the delivery: the idempotency store and the
    `reconcile-required` state are specified and the store is implemented, but nothing produces a
    reconcile-required outcome until Stage 5.3 can actually commit.
  - R0-008 (deployment defaults) is partly applied: `workers_dev = false` is now set, so a first deploy
    cannot silently expose a public `*.workers.dev` URL. The operator's own routes, the deployment
    environments and the deploy gate are Stage 5.4.6.
  - New, and worth the operator's attention: the gateway's own bundle is now 157 KiB, because the three
    contract documents are served from it. That is a deliberate trade — the contract travels with the
    gateway, so an agent can always read it — and it is well inside the Workers size limit. It is
    recorded here so that nobody is surprised by it.

UNRESOLVED QUESTIONS

  1. The per-type JSON Schemas are unspecified. The mechanism exists; no schema is defined. (Protocol
     section 15, item 5.)
  2. The writer-lease duration is a setting with a default of 300 seconds, not a decided value. It has
     to outlast a slow agent and not deadlock a task. (Protocol section 15, item 7.)
  3. The maximum TTL of 7 days is carried over from the read side. A write capability is worth more than
     a read one and may deserve a shorter default. (Protocol section 15, item 6.)
  4. The gateway's name is still open. The protocol version `ctxwrite-v1` does not depend on it.
  5. The submissions-to-consumer transfer path and the pre-creation tooling (R0-011) are still undefined
     and outside the plan. The operator decision is still needed.

NEXT

  Phase 5, Stage 5.3: implement the GitHub commit and delivery against the contract's section 8 — a
  fixed-destination client with bounded timeouts and safe error mapping (5.3.1), the selection validation
  (5.3.2), the commit idempotency (5.3.3), the provider failure handling including the
  timeout-after-success case (5.3.4), the confinement of the write to the designated folder and branch
  (5.3.5), the redacted audit metadata (5.3.6), and the seal precondition (5.3.7). The session side is
  ready for it: the `commit` route, the parameter validation, the selection parsing, the idempotency store
  and the durable commit record are all in place, and `recordCommit` is the interface Stage 5.3 will call.
