# Architecture

**Status: design, not normative.** This document describes the *shape* of the write gateway: the components,
the request flow, the Durable Object coordination model, and which source module owns which rule.

**Stage 5.4 implemented the audit, the privacy and the operations.** The components, the request flow and the
coordination model below are what the code does. The `commit` route delivers to the provider; the audit stream
is durable and queryable, the log-hygiene gate and the deploy workflow exist, and the operator runbook is
written. The remaining chaos tests and the CI wiring are Stage 5.5.

**The normative contract is `ctxwrite-v1`**, in [`protocol.md`](protocol.md). The error semantics are in
[`error-catalog.md`](error-catalog.md); the limits are in `src/config/quotas.json` and
`src/config/type-policy.json`. Where this document and the contract disagree, the contract wins and this
document is a defect. This document deliberately does not restate the rules.

**The core and the delivery are implemented (Stages 5.2 and 5.3).** The Worker answers `501` to nothing: every
route in the contract either works or answers with a documented error. 222 tests pass against the real Worker,
the real Durable Object and the real provider client. Stage 5.1 wrote the contract, Stage 5.2 the core, Stage 5.3
the commit path, Stage 5.4 the audit and operations, Stage 5.5 the remaining test suite and the CI wiring.

---

## 1. Components

| Component | Runs on | Holds | Lifetime |
|---|---|---|---|
| **Worker** (`src/index.ts`) | Cloudflare edge | the signing keys, the GitHub credential, configuration | stateless between requests |
| **TaskSession** (Durable Object, `src/session/task-session.ts`) | one instance per task | the control-plane state | durable across eviction, restart and redeploy |
| **Operator channel** (`/admin/*`) | edge, same Worker | `OPERATOR_TOKEN` | separate credential from the signing keys |
| **Submissions repository** | GitHub | the deliverables of every task that uses it | outside the gateway |

There is **one Durable Object class**, `TaskSession`, and **one instance per task**. The instance id is derived
deterministically from the task id, so a revoked task's instance is reachable again for the revocation check
even after it has been torn down.

**The handlers are serialised explicitly.** A Durable Object is single-threaded, but a handler that awaits
something that is not a storage operation — a digest, a text decoder — yields, and the next request's handler
starts in the meantime. Two concurrent appends would then both read the same `last_seq` and both apply the
chunk. `TaskSession` therefore holds a request queue, and every internal route runs through it. That is what
makes the session's state transitions atomic, which is what the contract's sequence, quota and lease rules
assume. It was found by the concurrency test, and it is register entry F0-033.

**The Durable Object performs the commit, not the Worker.** This is a change from the Stage 5.1 sketch, and it
is the one that matters most in this document.

The sketch had the Worker make the GitHub call and pass the result back to the Durable Object to record. That
leaves a window: the commit has landed on the branch, and the session has not yet recorded it. A crash in that
window, or a failure to reach the Durable Object, means the next attempt does not know that the commit
happened — and the expected-SHA precondition, which is the thing that stops a duplicate, cannot tell the
difference between "my commit never landed" and "my commit landed and I did not write it down".

So the delivery happens **inside** the Durable Object, in the same serialised handler that writes the session's
state. The commit's outcome and the state that records it change together, or not at all. The cost is that a
provider call holds the session's request queue for the length of that call, which is bounded by the provider
timeout and is the right trade for a task that has one writer.

The credential is not in the state store, and it is not in a response. The Durable Object reads it from its own
environment at the point of use, and the state store never holds it (ADR 0001, ADR 0002). The Durable Object and
the Worker read the **same** environment, so there is one authority for the configuration and not two that can
disagree.

### The audit stream

Two copies of the record exist, and they answer different questions.

The **platform's log** is the complete stream: every request writes exactly one JSON line there, and the
operator's log retention decides how long it is kept. It is where the requests that never authenticated
appear, because they have no order.

The **durable stream** is one instance of a second Durable Object class per **order**. It is what the operator
queries at `{base}/admin/audit?order=…`, it survives a log pipeline that samples, and it is bounded: the
oldest records are pruned by age.

The Durable Object does not trust the record it is handed. It **rebuilds** the record from the fields it is
handed, through the same fixed-schema gate the platform's log uses, and refuses to store a record that still
contains something that looks like a secret. A bug in the Worker, or a compromised one, cannot put a
capability into the durable store. That is the same principle as the commit's in-flight entry: the state that
records a fact is written by the thing that holds the fact.

## 2. Request flow

```
   agent                          Worker                     TaskSession            GitHub
     │                              │                            │                    │
     │ GET {root}/append?...        │                            │                    │
     ├─────────────────────────────▶│                            │                    │
     │                              │ 1. parse + verify sig      │                    │
     │                              │ 2. expiry, ttl, revocation │                    │
     │                              │ 3. lease claim             │                    │
     │                              ├───────────────────────────▶│                    │
     │                              │ 4. sequence + quota check  │                    │
     │                              ├───────────────────────────▶│                    │
     │                              │ 5. append chunk (memory)   │                    │
     │                              │◀───────────────────────────┤                    │
     │◀─────────────────────────────┤ 6. envelope + links       │                    │
```

The commit path differs only in steps 5 and 6:

```
     │ GET {root}/commit?files=…     │                            │                    │
     ├─────────────────────────────▶│ 1-4 as above               │                    │
     │                              ├───────────────────────────▶│                    │
     │                              │                            │ 5. validate sel.  │
     │                              │                            │ 6. check head    │
     │                              │                            │──objects────────▶│
     │                              │                            │ 7. one commit    │
     │                              │                            │──move branch────▶│
     │                              │                            │ 8. record it     │
     │                              │◀───────────────────────────┤ (durable)        │
     │◀─────────────────────────────┤ 9. envelope + links        │                    │


Two properties of this flow are worth stating, because they are the ones that are easy to get wrong:

- **The signature is verified at the Worker, before the Durable Object is touched.** A forged capability must
  not be able to create, claim or modify a session. This is the verification order in the contract's section
  14.3, and the Worker implements steps 1 and 2 before it resolves the Durable Object.
- **The revocation check happens before the lease claim, and again inside the Durable Object.** The Worker
  consults the durable revocation record; the Durable Object holds its own `revoked` flag. Either alone would be
  enough; both are implemented because a torn-down task must still refuse a well-formed capability, and a
  Durable Object that is reachable must not be the only thing standing between a revoked capability and a
  write.

## 3. The Durable Object coordination model

ADR 0001 splits the state in two. This is the concrete form of that split.

### Durable — the control plane

| State | Used for | Module |
|---|---|---|
| the writer lease (writer id, claimed at, expires at) | one writer per task | `src/session/writer-claim.ts` |
| the session state (`open` / `sealed` / `revoked` / `closed`) | fail after seal, fail after revocation | `src/session/task-session.ts` |
| idempotency keys and their outcomes | the "committed but the response was lost" case | `src/session/idempotency.ts` |
| sequence metadata (last `seq`, whole-file hash, replay window) | replay detection, conflict detection | `src/session/sequence.ts` |
| the quota ledger | the live file, byte and rate counters | `src/session/quota-accounting.ts` |
| the tombstone set | soft delete | `src/session/tombstones.ts` |
| the commit record (sha, paths, hashes, at) | the seal precondition, and the commit result | `src/commit/commit-idempotency.ts` |

### Ephemeral — the data plane

**File contents.** The staged bytes live in memory, in the Durable Object instance, and are lost when the
instance is evicted. They are never written to the Durable Object's storage, to disk, or to any third-party
object store (ADR 0002).

The consequence, which the whole recovery model is built around: **the inventory of a task is durable and the
content of a task is not.** The Durable Object can know that `intro.md` exists, ends at `seq=3` and hashes to
`…`, while the bytes are gone. `src/staging/status.ts` reports that difference per file, and
`src/staging/scaffold.ts` is what turns it back into a working file.

### The lease

One writer per task, held as a lease with an expiry:

- The first request under a capability claims the lease for that capability's writer.
- A request under a different writer for the same task is refused with `409 writer-conflict`.
- The lease expires after a bounded interval, so a dead session does not deadlock a task, and it is
  reclaimable by the same writer.
- The lease is held in the Durable Object, so it is consistent across the whole task and across restarts.

The lease duration is an open item: it must be long enough for a slow agent to finish a chunk and short enough
that a crashed session is recovered in reasonable time.

### The commit record, and the in-flight entry

The commit record is the one piece of state that makes the whole idempotency story work. It is written
**after** the GitHub commit succeeds, and it is written **before** the response is sent. If the response is
lost, the retry finds the record, matches the idempotency key, and returns the recorded success instead of
committing again.

There is a second piece of state, and it exists because of the window described above. An **in-flight entry** is
written *before* the branch is moved, and it is removed once the commit is recorded. If it is still there, the
last attempt did not finish, and the next attempt has to **resolve** it rather than start again: the commit
object may exist, and the branch may or may not point at it. The entry records the commit's sha (once the
object exists) and the timestamp the commit was made with, so that a repeated attempt produces the *same*
commit object and the delivery is idempotent at the provider too.

The delivery itself is what resolves it. If the branch is at the commit, it landed. If the branch is still at
the expected head, it did not, and the update is repeated. If the branch is somewhere else, the outcome cannot
be told apart, and the gateway answers `409 reconcile-required` — a human, not a retry, resolves it. The gateway
never issues a second commit to find out.

## 4. Module map

The source tree is 52 files, and none of them is a stub. This is which module owns which part of the
contract.

| Module | Owns | Contract section |
|---|---|---|
| `src/index.ts` | the Worker entry, the health endpoint, the operator channel | 10.4, 14.4 |
| `src/router.ts` | the path → operation dispatch, GET only | 4.1, 14.3 |
| `src/auth/root-url.ts` | parsing the capability out of the request path | 2.1, 3.1 |
| `src/auth/signature.ts` | the canonical message, the HMAC, the constant-time comparison | 3.1, 3.2 |
| `src/auth/policy-authz.ts` | the per-operation authorisation decisions | 2.3, 14.3 |
| `src/http/responses.ts` | the response envelope | 4.3 |
| `src/http/errors.ts` | the error codes and the help links | 9 |
| `src/http/status-codes.ts` | the status → code mapping | 9 |
| `src/http/headers.ts` | the no-store, nosniff, no-referrer header set | 10.1 |
| `src/http/help.ts` | the corrective-help links | 4.3, 4.4 |
| `src/hypermedia/links.ts` | building the next-step links | 4.4 |
| `src/hypermedia/templates.ts` | the contract and error-catalog URLs | 4.5 |
| `src/policy/path-safety.ts` | the path rules | 5.1 |
| `src/policy/type-policy.ts` | the type policy | 7.2 |
| `src/policy/quotas.ts` | the quota checks | 7.1 |
| `src/policy/rate-limit.ts` | the rate window | 7.1 |
| `src/session/*` | the Durable Object control plane | 5.2, 6 |
| `src/staging/*` | the data plane | 5.3, 6 |
| `src/commit/commit-idempotency.ts` | the commit's idempotency digest | 6.3 |
| `src/commit/github-client.ts` | the fixed-destination provider client | 8.1, 12.1 |
| `src/commit/selection.ts` | the selection rules | 8.2 |
| `src/commit/retry.ts` | the provider's failures and the retry policy | 8.1 |
| `src/commit/commit.ts` | the commit itself, in two steps | 8.1 |
| `src/seal/seal.ts` | the seal transition | 8.4 |
| `src/audit/logger.ts`, `src/audit/metrics.ts`, `src/audit/redaction.ts` | the audit record and the counters | 11 |
| `src/audit/audit-stream.ts` | the durable audit stream, one instance per order | 11 |
| `src/audit/hygiene.ts` (in the tests) and `scripts/verify-log-hygiene.ts` | the sentinel injection and the deploy gate | 10.3, 12.5 |
| `src/http/contract.ts` | the contract documents, served as text | 4.5 |
| `src/config/env.ts`, `src/config/constants.ts` | the configuration and the commit message | 8.3, 12.2 |
| `AUDIT_RETENTION_SECONDS` | 11 — how long the durable audit stream keeps an order's records |

## 5. The configuration boundary

Everything that names a destination is configuration, read at deploy time, and no request can influence it:

| Setting | Section |
|---|---|
| the signing keys, as a map of kid to secret | 3.3 |
| `SUBMISSIONS_REPO`, `SUBMISSIONS_BRANCH`, `SUBMISSIONS_FOLDER_TEMPLATE` | 12.2 |
| `GITHUB_TOKEN` | 12.1 |
| `GITHUB_API_BASE` | 12.2 — the provider's base URL; HTTPS, or loopback for a local test |
| `GITHUB_TIMEOUT_MS` | 12.1 — the per-call timeout for the provider |
| `GITHUB_COMMIT_AUTHOR` | 8.3 — the commit's author identity, `Name <email>` |
| `OPERATOR_TOKEN` | 10.4 |
| the quota and type policy files | 7 |
| `max_ttl` | 3.4 |

A misconfiguration fails closed: the gateway serves nothing and answers `503 gateway-misconfigured`, naming the
setting it could not read and never a secret. That is the read gateway's behaviour, and the write gateway
inherits it.

## 6. What is still not decided, and not implemented

- The **lease duration** and the **per-type JSON Schemas** are open (the contract's section 15).
- The **submissions-to-consumer transfer path** and the **pre-creation tooling** are register entry R0-011 and
  are not designed.
- The gateway's **name** is open.
- The **commit's author identity** is open: it defaults to the gateway's own, and `GITHUB_COMMIT_AUTHOR`
  changes it. The operator may want the identity to name a person or a team.
- **One commit per capability** is a consequence of the expected-SHA precondition rather than a rule of its
  own, and the workflow it implies is open: a task that needs two commits needs two capabilities, and the
  operator may prefer to mint a fresh capability per commit.
- The **deployment** is Stage 4/5.4.6: the configuration in `wrangler.toml` still carries the scaffold's
  placeholders, and the contract's section 12.5 states what they must become.
