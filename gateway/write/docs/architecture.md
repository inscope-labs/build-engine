# Architecture

**Status: design, not normative.** This document describes the *shape* of the write gateway: the components,
the request flow, the Durable Object coordination model, and which source module owns which rule.

**Stage 5.2 implemented the core.** The components, the request flow and the coordination model below are what
the code does. The GitHub delivery is Stage 5.3 and is not implemented; the `commit` route answers the
documented `501 not-implemented`.

**The normative contract is `ctxwrite-v1`**, in [`protocol.md`](protocol.md). The error semantics are in
[`error-catalog.md`](error-catalog.md); the limits are in `src/config/quotas.json` and
`src/config/type-policy.json`. Where this document and the contract disagree, the contract wins and this
document is a defect. This document deliberately does not restate the rules.

**The core is implemented (Stage 5.2).** The Worker answers `501` to nothing except the `commit` route, whose
delivery is Stage 5.3. 171 tests pass against the real Worker and the real Durable Object. Stage 5.1 wrote the
contract, Stage 5.2 the core, Stage 5.3 the commit path, Stage 5.4 the audit and operations, Stage 5.5 the
remaining test suite and the CI wiring.

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

The Worker holds the GitHub credential. The Durable Object does not need to: the Worker performs the commit
using the credential and passes the result back. The split keeps the credential out of the state store, which
matters because the state store is durable and the credential must never be (ADR 0001, ADR 0002).

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
     │                              │ 5. validate selection      │                    │
     │                              │ 6. check branch head       │───────────────────▶│
     │                              │ 7. commit one commit       │                    │
     │                              │◀───────────────────────────────────────────────┤
     │                              │ 8. record commit (durable) │                    │
     │                              ├───────────────────────────▶│                    │
     │◀─────────────────────────────┤ 9. envelope + links        │                    │
```

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

### The commit record

The commit record is the one piece of state that makes the whole idempotency story work. It is written
**after** the GitHub commit succeeds, and it is written **before** the response is sent. If the response is
lost, the retry finds the record, matches the idempotency key, and returns the recorded success instead of
committing again. If the commit outcome itself is indeterminate, the record is written as indeterminate and the
gateway answers `409 reconcile-required` — a human, not a retry, resolves it.

## 4. Module map

The source tree already exists (`src/`, 48 files) as stubs. This is which module owns which part of the
contract, so that Stage 5.2 and 5.3 have an assignment rather than a blank page.

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
| `src/commit/*` (the rest) | the GitHub client, the selection, the retry policy — **Stage 5.3** | 8 |
| `src/seal/seal.ts` | the seal transition | 8.4 |
| `src/audit/logger.ts`, `src/audit/metrics.ts`, `src/audit/redaction.ts` | the audit record | 11 |
| `src/http/contract.ts` | the contract documents, served as text | 4.5 |
| `src/config/env.ts`, `src/config/constants.ts` | the configuration and the commit message | 8.3, 12.2 |

## 5. The configuration boundary

Everything that names a destination is configuration, read at deploy time, and no request can influence it:

| Setting | Section |
|---|---|
| the signing keys, as a map of kid to secret | 3.3 |
| `SUBMISSIONS_REPO`, `SUBMISSIONS_BRANCH`, `SUBMISSIONS_FOLDER_TEMPLATE` | 12.2 |
| `GITHUB_TOKEN` | 12.1 |
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
- The **deployment** is Stage 4/5.4.6: the configuration in `wrangler.toml` still carries the scaffold's
  placeholders, and the contract's section 12.5 states what they must become.
