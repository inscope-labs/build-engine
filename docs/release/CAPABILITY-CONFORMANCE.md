# Capability conformance — the three capability formats

**Status:** **approved** (2026-11-08, ADR 0013 item 9). The open questions this document raised are closed by
**ADR 0010** (Q-A, Q-C, Q-D, Q-E) and **ADR 0011** (Q-B, the state set, and the cbridge scope). The two replay
gaps are **accepted gaps with a citation**, not open questions (section 5).

**Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07). Updated by Stage S0 on
2026-11-08; the operator's decisions are recorded in ADR 0010 and ADR 0011.

**Authority:** `docs/release/V0.6.0-BUILD-PLAN.md` §1.3 (three capability formats, each with explicit
cross-system conformance for signing, scope, expiry, revocation and replay),
`docs/decisions/0006` (D-3, D-4), `docs/decisions/0007` (R0-005, R0-007 acceptance),
`docs/decisions/0010` (cross-system conformance, GAP R-1, GAP R-2, per-capability revocation),
`docs/decisions/0011` (task-state ownership, the authoritative state set, the cbridge scope).

**How to read the status words in this document.** They are the same words `docs/STATUS.md` uses:

- **specified** — a normative document defines the behaviour.
- **implemented** — the behaviour is in code, and the cited test covers it.
- **implemented, not executed here** — the behaviour is in code at the cited path in the cited commit, and a
  test exists at the cited path, but **this session did not run that test**. The repository cited is read-only
  for this stage. This is not a claim that the test passes.
- **not implemented** — no code does this.
- **GAP** — the required rule is not met. A GAP is never described as satisfied.

Every claim below carries a path. A claim without a path is not made.

---

## 1. The three formats, and why there are three

The release carries three capability formats. They are **distinct** and are never collapsed (plan §1.2):
each names one trust boundary, and a signature made under one is never accepted under another.

| | Format | Domain separator | Trust boundary | Minted by | Verified by | Carried in |
|---|---|---|---|---|---|---|
| **1** | `ctxop-v1` — operator action | `ctxop-v1` | Operator → Gateway A | the Android console, with the device key, **after** the operator confirms | Gateway A (operator-console) | a request body field (`capability`) |
| **2** | the read link — one file at one pinned commit | `ctxgate-v1` | Operator → Gateway B → Class B agent | the operator's tooling (`template/engine/tools/ctxlink.py`) | Gateway B (this repository) | the URL path |
| **3** | the write root capability — one task's submission session | `ctxwrite-v1` | Operator → Gateway C → Class B agent | the operator's tooling (`gateway/write/scripts/mint-root-url.ts`) | Gateway C (this repository) | the URL path |

**Format 1 is not implemented in this repository.** No file in `inscope-labs/build-engine` mentions `ctxop-v1`.
The specification and its implementation live in `inscope-labs/operator-console`; section 4.1 cites them by
path and commit.

---

## 2. The rules that apply to all three

| Rule | How it is enforced | Evidence |
|---|---|---|
| **Domain separation.** A signature produced for one format is never a valid signature for another. | The domain separator is the first field of the canonical message and is covered by the signature. | `conformance/SCHEME.md` §3.1; `gateway/write/docs/protocol.md` §3.1, §3.11; operator-console `docs/capability-format.md` §2 (field `ctxop-v1`) |
| **Key separation.** The signing secrets of the three formats are never the same, and are never the same across environments. | Declared as disjoint key-id sets and checked by the deployment gates. | `gateway/read/production/ops/environments.json` (key-id disjointness rule); `gateway/write/scripts/check-staging-separation.py` §4; operator-console ADR 0008 / the operator's binding decision for this stage (distinct keys and credentials per environment) |
| **The host is part of the contract.** A capability minted for one host is not a capability for another. | The signature does **not** bind the host; the deployment may pin it. ADR 0002 makes the host part of the work-order contract. | `gateway/write/docs/protocol.md` §2.1; `docs/decisions/0002` |
| **No capability, signature or payload is logged.** | Log-hygiene checks with injected sentinels. | `gateway/write/scripts/verify-log-hygiene.ts`; `gateway/write/docs/protocol.md` §10; operator-console `gateway/src/audit/redaction.ts` (forbids `nonce` and signature fields by name) |
| **Fail closed.** An ambiguous case is a refusal, never a decision. | The verification order is normative and the order is part of the contract. | `conformance/SCHEME.md` §7; `gateway/write/docs/protocol.md` §14.3; operator-console `gateway/src/capability/gate.ts` (verify → then nonce) |

---

## 3. What "conformance" means here, and what is missing

**A capability format is conformant when the five properties below are specified, implemented, and covered by
an executable suite.** The five properties are: **signing**, **scope**, **expiry**, **revocation**, **replay**.

| Format | A shared, executable conformance suite exists? | Where |
|---|---|---|
| `ctxop-v1` | **No.** The vectors are per-format and live in operator-console; there is no cross-format suite. | operator-console `docs/fixtures/vectors/` (`valid_capabilities.json`, `codec_mutations.json`, `ecdsa_vectors.json`, `hmac_vectors.json`) |
| `ctxgate-v1` | **Yes.** | `conformance/` — `SCHEME.md`, `signing-vectors.json`, `cases/behaviours.json` (B1–B11), `harness/run.py`, `test_conformance.py` |
| `ctxwrite-v1` | **Partly.** The write gateway's own suite drives the gateway over the contract; it is not a shared, cross-implementation suite. | `gateway/write/tests/` (372 tests at `main`), `gateway/write/scripts/check-contract-consistency.py` |

**GAP C-1 (not a replay gap, an assembly gap).** The plan asks for "explicit **cross-system** conformance for
signing, scope, expiry, revocation and replay" for each of the three formats. There is no suite that drives
all three formats against a common property list. `conformance/` covers the read format; the write format has
its own suite; the operator format lives in the other repository with its own vectors. This document is the
first cross-system statement of the five properties, and it is prose, not an executable check.

**The operator's decision (Q-A):** does "cross-system conformance" mean (a) one shared executable suite in this
repository that covers all three formats, (b) three per-format suites plus this document as the cross-system
statement, or (c) a shared suite that covers the shared properties only (signing discipline, expiry bound,
revocation semantics) with the format-specific suites owning the rest? The agent's recommendation is **(c)**:
option (a) requires a cross-repository test harness and a shared vector format, which is a new plan item and
belongs to operator-console as much as to this repository.

---

## 4. The three formats, property by property

### 4.1 `ctxop-v1` — the operator capability (Gateway A)

**Specification:** `inscope-labs/operator-console` at commit **`992defff591d39539bcc8b4ca3cbc14eb9bab783`**
(`main`, 2026-11-07). Read-only for this stage.

| Property | Value | Authority (path in operator-console @ `992deff`) | Status |
|---|---|---|---|
| **Shape** | ten LF-separated fields + appended signature: `ctxop-v1`, `kid`, `exp`, `order`, `plan`, `task`, `op`, `branch`, `head`, `nonce` | `docs/capability-format.md` §1, §5 | specified; codec implemented in `gateway/src/capability/codec.ts` |
| **Signing** | the algorithm is **not** in the wire format: it is a property of the `kid` in the gateway's key registry. Production operator keys are EC P-256, verified with ECDSA-SHA256; lab keys are shared secrets verified with HMAC-SHA256. ECDSA signatures travel as raw IEEE P1363 (`r‖s`), base64url without padding. | `docs/adr/0005-signature-encoding.md` (D-T1, D-T1b); `docs/adr/0001-capability-signing-direction.md` (Model B) | specified and implemented |
| **Signing — direction** | the **console mints, the gateway verifies** (Model B). The capability is created at the moment of the operator's decision, by a non-exportable Android Keystore key. Model A (HMAC) is retained behind the `CapabilitySigner` interface. | `docs/adr/0001-capability-signing-direction.md` | specified and implemented |
| **Scope** | `op` is a closed enumeration of eleven operations; unknown values are refused. `branch` is task-scoped (`^task-[A-Za-z0-9._-]+$`, equal to the work order's branch) for the seven task-scoped operations, and engine-scoped for the four engine-scoped ones. `head` is the expected branch head. `op`, `branch`, `head` and `nonce` are all bound into the signature. | `docs/capability-format.md` §2, §3; `docs/adr/0005-signature-encoding.md` (D-T2) | specified and implemented (`gateway/src/capability/ops.ts`, `gateway/src/capability/codec.ts`) |
| **Expiry** | `exp` in unix seconds, inclusive boundary. The gateway enforces a **maximum TTL of 300 s (5 minutes)** and a clock skew of 10 s. | `docs/capability-format.md` §2; `gateway/src/capability/types.ts` (`MAX_TTL_SECONDS = 300`, `CLOCK_SKEW_SECONDS = 10`) | specified and implemented |
| **Revocation** | **Two mechanisms, at different granularities.** (i) *Key retirement*: a rotated `kid` resolves to `null`, so every capability signed under it is refused with `UNKNOWN_KID` — implemented. (ii) *Per-capability / per-order revocation*: **not implemented** — `POST /admin/revoke` in Gateway A is a fail-closed 501 stub. | (i) `gateway/src/auth/device.ts` ("retired → null / UNKNOWN_KID"), `gateway/src/durable-objects/enrolment-registry.ts` (rotate → old kid `retired`); (ii) `gateway/src/routes/admin.ts` (`adminStubHandler` → `NOT_IMPLEMENTED`) | (i) implemented; (ii) **not implemented** |
| **Replay** | **Met.** The capability carries a `nonce` (16–64 lowercase hex, random). The gateway refuses a nonce it has already seen and **stores it before performing the operation**, in a Durable Object, until `exp`. A second presentation is `409 NONCE_REPLAYED`. | `docs/capability-format.md` §2 (nonce field), §7 (check 4: "Store it before performing the operation, not after"); `gateway/src/capability/gate.ts` (verify → `checkAndStoreNonce`); `gateway/src/capability/nonce.ts`; `gateway/src/durable-objects/nonce-store.ts` (`checkAndStore`, `409 NONCE_REPLAYED`); `gateway/src/errors/catalogue.ts` (`NONCE_REPLAYED: 409`) | implemented; test at `gateway/tests/unit/capability/nonce.test.ts` — **implemented, not executed here** |

**Two observations recorded against this format, neither of which changes its status:**

1. The nonce record's cleanup is a manual `POST /purge-expired`, not an alarm: the Durable Object stores the
   record with a `TODO` for an alarm at `exp` (`gateway/src/durable-objects/nonce-store.ts`). The replay
   protection itself does not depend on the cleanup — an un-purged record only ever refuses *more*, never
   less. It is an operational note for operator-console's owner.
2. `docs/capability-format.md` §1 still describes the signature as `HMAC-SHA256`. ADR 0005 (D-T1) supersedes
   that for production keys. **The specification file and the ADR disagree**, and the ADR is the later and
   more specific record. This is recorded here because a reader of the format document alone would implement
   the wrong signature. It is an operator-console documentation defect, not a build-engine one.

### 4.2 The read link — `ctxgate-v1` (Gateway B)

**Specification:** `conformance/SCHEME.md` (normative), in this repository.

| Property | Value | Authority | Status |
|---|---|---|---|
| **Shape** | `{base}/v1/{kid}/{exp}/{order}/{sig}/{ref}/{path…}` — fixed arity, everything in the path, never in the query string | `conformance/SCHEME.md` §2 | specified and implemented (`gateway/read/production/src/scheme.ts`) |
| **Signing** | `sig = base64url_nopad(HMAC-SHA256(secret, message))` over exactly six LF-separated fields, `ctxgate-v1` first | `conformance/SCHEME.md` §3 | specified and implemented; byte-for-byte vectors in `conformance/signing-vectors.json` |
| **Scope** | exactly **one file at exactly one pinned commit**. The signature binds `kid`, `exp`, `order`, `ref` and `path`; the order is the unit of revocation. Paths are not normalised, and a `..` **component** is refused. | `conformance/SCHEME.md` §3.3, §4.4, §5 | specified and implemented |
| **Expiry** | valid while `now <= exp + clock_skew_tolerance`; refused at `exp + tolerance + 1`. The gateway independently refuses any link with `exp - now > max_ttl`. The operator's ceilings are **tolerance ≤ 120 s** and **max_ttl ≤ 259200 s (72 h)**; the gateway refuses to start above either and the renderer refuses to write such a configuration. | `conformance/SCHEME.md` §4.2; `docs/decisions/0003`; `gateway/read/production/src/policy.ts` (`intEnv(..., 1, 259_200)`, `intEnv(..., 0, 120)`) | specified and implemented |
| **Revocation** | by **order**: `POST /admin/revoke` on the operator channel (a separate credential from the signing keys) stores the order in the Durable Object; the link check then refuses it with `403 revoked`. If the state store cannot be read, the gateway serves **nothing** (`503 state-unavailable`) — it fails closed. | `gateway/read/production/src/index.ts` (`handleAdmin`, `/admin/revoke`); `src/rules.ts` (check 8); `src/state.ts` | specified and implemented |
| **Replay** | **GAP R-1 — not met.** The scheme has no nonce and no one-time-use record. A link is **reusable until it expires**. The scheme says so itself: a commit-pinned ref "is what makes a link replayable-safe for the length of its life" (`conformance/SCHEME.md` §4.4). The gateway's verification order has ten checks and none of them is a use-once check (`conformance/SCHEME.md` §7; `gateway/read/production/src/rules.ts`). | see section 5 | **GAP** |

**What the gap is, precisely.** A caller who holds a valid, unexpired link may present it any number of
times, and every presentation serves the same bytes. The exposure is bounded by three things that already
exist — the link names **one** file, at **one immutable commit**, so a replay returns identical bytes; the
link **expires**; and the order can be **revoked**. What it does *not* bound is the number of times the file
can be read, or the number of holders of the URL.

### 4.3 The write root capability — `ctxwrite-v1` (Gateway C)

**Specification:** `gateway/write/docs/protocol.md` (normative), in this repository.

| Property | Value | Authority | Status |
|---|---|---|---|
| **Shape** | `{base}/w1/{kid}/{exp}/{order}/{plan}/{task}/{writer}/{head}/{sig}` — fixed arity, nine segments, the operation is the tenth | `gateway/write/docs/protocol.md` §2.1 | specified and implemented |
| **Signing** | `sig = base64url_nopad(HMAC-SHA256(secret, message))` over eight LF-separated fields, `ctxwrite-v1` first; the signature binds `kid`, `exp`, `order`, `plan`, `task`, `writer` and `head` | `gateway/write/docs/protocol.md` §3.1, §3.10 | specified and implemented |
| **Scope** | exactly one task folder of one submissions repository, one configured branch, one writer. The folder is **derived** from the signed `plan`/`order`/`task` and a configured template — no request can choose a destination (`400 destination-not-selectable`). `writer` is bound into the signature; one writer per task at a time, held as a lease. | `protocol.md` §2.3, §2.4, §2.5 | specified and implemented |
| **Expiry** | valid while `now <= exp`, refused at `exp + 1`. The gateway independently refuses any capability with `exp - now > max_ttl`; the deployment default is **604800 s (7 days)**. | `protocol.md` §3.4 | specified and implemented |
| **Revocation** | by **order or task**: `POST /admin/revoke` on the operator channel tears the session down; the capability is refused with `410 task-revoked` from then on. A sealed task refuses every mutation with `410 task-sealed`. | `protocol.md` §10.4; `src/session/task-session.ts` (`revoke()`); `src/auth/policy-authz.ts`; `src/http/status-codes.ts` | specified and implemented |
| **Replay** | **GAP R-2 — not met at the capability level; met at the operation level.** The root is a **bearer** capability: "anyone who holds it can perform every operation the contract allows for that task, within the task folder, until the capability expires or is revoked" (`protocol.md` §2.2). Presenting it again is not an error. What stops a replay from doing damage is a second layer: the idempotency store (`§6.3`), the sequence-and-hash rule (`§6.2`), the writer lease (`§2.5`), the expected-SHA head precondition (`§3.9`) and the seal (`§8.4`). | see section 5 | **GAP** at the capability level |

**What the gap is, precisely.** The *repository* is protected: a replayed commit returns the recorded outcome
with `result.replayed = true` and does not create a second commit; a replayed chunk is harmless; a replayed
seal is idempotent. That protection is real and it is tested. What is missing is a property of the
**capability**: a second holder of the same root URL is a second writer as far as the gateway can tell, and
the only thing that separates them is the `writer` segment, which is **readable by anyone holding the root**
(`protocol.md` §2.2 and §2.5). The protocol states this outright: "a capability that is *stolen* is
indistinguishable from the original writer."

---

## 5. The gap register: replay protection

The plan requires replay protection for **every** capability format. Two of the three formats do not meet it at
the capability level, and **neither is described as satisfied**. The operator has now **accepted both gaps in
writing** (ADR 0010, 2026-11-08) and chosen what is done about each:

| Gap | The operator's decision | What is still to be built | Where |
|---|---|---|---|
| **GAP R-1** — the read link is reusable until it expires | **Accepted** (option R-1.a) **plus observable replay** (option R-1.d). No scheme change; no regenerated signing vectors. | Each presentation of a read link is recorded in the audit stream, with a threshold alert. | **S2** |
| **GAP R-2** — the write root capability is a bearer credential | **Accepted** (option R-2.a) for 0.6.0. | Option R-2.c (bind the root capability to an agent identity) is recorded as a **later cross-system stage** and is **not** part of 0.6.0. | not in 0.6.0 |

The evidence for both gaps is unchanged and is kept below, because an accepted gap is still a gap and the
reader has to be able to see what was accepted.

### GAP R-1 — the read link is reusable until it expires

**Evidence.**
- `conformance/SCHEME.md` §2 — the link format has no nonce segment.
- `conformance/SCHEME.md` §7 — the ten verification steps contain no use-once check.
- `conformance/SCHEME.md` §4.4 — the scheme states a commit-pinned ref is what makes a link "replayable-safe
  for the length of its life".
- `gateway/read/production/src/rules.ts` — the implementation of the ten steps, in order, with no use-once
  check between them.
- `conformance/cases/behaviours.json` — the executable behaviours B1–B11 contain **no** replay case: there is
  no case that presents the same link twice and asserts a refusal.

**Options.**

| | Option | What it costs | What it buys |
|---|---|---|---|
| **R-1.a** | **Accept the residual risk in writing** and say so plainly in the release notes and in the capability's own documentation. | Nothing to build. The exposure must be stated, not hidden. | The scheme, the minting tool, every signing vector and the whole conformance suite stay as they are. |
| **R-1.b** | **Single-use nonce.** Add a `nonce` segment to the link; the gateway records it in the Durable Object at first use and refuses a second presentation. | A **scheme change**: the canonical message gains a field, so `ctxgate-v1` must become `v2`, every signing vector is regenerated, the minting tool changes, and the conformance suite gains a behaviour. A link also cannot be re-fetched: a transient network failure loses it. | A link is readable exactly once. |
| **R-1.c** | **Bounded reuse.** Allow *N* uses per link (N configured, e.g. 3), recorded durably. | The same scheme change as R-1.b, plus a counter and its expiry rules. | A link survives a retry but not an unbounded harvest. |
| **R-1.d** | **Leave the scheme alone, make the replay observable.** Record each presentation of a link in the audit stream (the record already has `order` and `path`), and alert on a count above a threshold. | No scheme change. The audit stream grows with a field or two and a threshold rule. | A replay is detectable and auditable, but not prevented. |

**The agent's recommendation was R-1.a**, with R-1.d as a cheap addition, and **the operator adopted it**
(ADR 0010 item 2). The reasons are specific: the content served is pinned to an immutable commit, so a replay
returns identical bytes; the link is scoped to one file; expiry and revocation bound the window; and the
consumer of a read link is a Class B agent that legitimately re-fetches (a retry after a timeout is a normal
event, and R-1.b would turn a transient failure into a lost task). R-1.b and R-1.c are the right answer **if**
the operator decides that read-once is worth a scheme version bump and a re-mint flow — and that is a product
decision, not a technical one.

**What R-1.d means in practice (to be built at S2).** Every presentation of a read link is written to the
audit stream with its order, path, request id and timestamp — the record already carries those fields — and
the gateway alerts when the count of presentations for one order exceeds a configured threshold. The audit
record's schema does not change; a presentation that is already recorded is simply *counted*. The gap is
**not closed** by this: the replay still succeeds. What changes is that it is **visible**, and the threshold
is the operator's tripwire.

### GAP R-2 — the write root capability is a bearer credential

**Evidence.**
- `gateway/write/docs/protocol.md` §2.2 — "The root URL is the secret"; there is no second factor; the
  `writer` segment is an identity, not a secret.
- `gateway/write/docs/protocol.md` §2.5 — "a capability that is *stolen* is indistinguishable from the
  original writer".
- `gateway/write/docs/protocol.md` §6.2, §6.3 — the operation-level protections (sequence + hash,
  idempotency), which protect the *repository*, not the *capability*.
- The deployed pilot exercised the operation-level protection and passed: "the retry was a replay, not a
  second commit" (staging pilot, signed run, 2026-11-05, `ops/staging-pilot.py` against the deployed
  Workers — 44 checks passed).

**Options.**

| | Option | What it costs | What it buys |
|---|---|---|---|
| **R-2.a** | **Accept the residual risk in writing**, stating the operation-level protections that do apply. | Nothing to build. | The contract stays as it is, and the gap is disclosed. |
| **R-2.b** | **Single-use root.** The root may be redeemed once and exchanged for a per-operation credential. | A new operation, a new route, a new conformance surface, and a change to the agent's tool prompt. | A stolen root is redeemable once. |
| **R-2.c** | **Bind the root to a device or an agent identity** — the `writer` segment becomes a proof rather than a label. | The write gateway would need the agent's enrolment (the operator console's enrolment registry), and the agent would need a key. | A stolen root is not enough; the thief needs the agent's key. |

**The agent's recommendation was R-2.a**, and **the operator adopted it** for 0.6.0 (ADR 0010 item 3). The
write gateway's capability is short-lived, task-scoped, folder-scoped and revocable, and the operations under
it are idempotent and precondition-guarded; the residual risk is that a stolen root lets the thief *be* the
writer, which the writer lease cannot detect.

**Option R-2.c — bind the root capability to an agent identity — is recorded as a later cross-system stage**
(ADR 0010 item 3) and is **not part of 0.6.0**. It is the only option that closes the gap properly: it requires
the agent to hold an enrolled key, so a stolen root is not enough on its own. It is a cross-system change that
touches the console's enrolment model and the write gateway's verification, and it does not block 0.6.0.

### 5.1 One gap that is not about replay

**GAP C-1** — no cross-system executable conformance suite (section 3). The five properties are asserted per
format; nothing checks them together.

---

## 6. The task-state transition operation (D-4)

ADR 0006 decision 7 and operator-console ADR 0008 both say the same thing: the gateway gets an explicit,
guarded status-transition operation, the app implements it and never refuses silently, and **its contract is
defined here, in this document, and consumed by operator-console OC-6**. This is the only part of BE-0 that
defines a wire behaviour rather than describing one.

### 6.1 The states

**The authoritative state set is the shipped schema** `template/engine/schemas/task.schema.json`, field
`status` (ADR 0011 item 2: *"The shipped schema … is the authority. Section 6.1 of
`CAPABILITY-CONFORMANCE.md` is reconciled to it, and any difference is reported. The shipped schema does not
change."*). The gateway does not invent a state, and this document does not add one.

| State | Meaning | Who sets it |
|---|---|---|
| `planned` | the task is in the plan and has no work order | the engine (the plan tooling) |
| `in_progress` | a writer holds it | Gateway C (the writer lease) and Gateway A |
| `pr_open` | a pull request is open for the task branch | Gateway A (the operator opens it) |
| `done` | the deliverable is accepted and sealed | Gateway C (the seal), confirmed by Gateway A |
| `dropped` | it will not proceed | Gateway A |
| `superseded` | it has been replaced by another task | Gateway A |

**The differences this section previously carried, reported as ADR 0011 item 2 requires.** The earlier draft of
this section proposed a set of its own; it is reconciled to the schema here, and the differences are listed so
that the change is visible rather than silent.

| The earlier draft proposed | The schema says | What changed here |
|---|---|---|
| `pending` | `planned` | renamed to the schema's word |
| `ordered` | — | **dropped.** The schema has no "ordered" status. A work order exists without changing the task's status; the order is the engine's own record |
| `in_progress` | `in_progress` | unchanged |
| — | `pr_open` | **added.** The schema has a pull-request-open state; the earlier draft did not |
| `done` | `done` | unchanged |
| `blocked` | — | **dropped as a status.** The schema carries `blocked_by` as a *field* (a list of `{type, ref}` with an optional `resolved`), so a blocked task is a task with a recorded blocker, not a status |
| `cancelled` | `dropped` | renamed to the schema's word |
| — | `superseded` | **added.** The schema has a superseded state; the earlier draft did not |

**The transition rule (D-4).** A transition is a request carrying a `ctxop-v1` capability whose `op` is one
of the status operations (`SET_IN_PROGRESS`, `SET_DONE`, and the operator's `DECIDE` for the terminal
outcomes). The capability's `task` segment names the task, its `branch` segment names the task
branch, and its `head` segment names the branch head the operator saw. **The gateway refuses any transition
whose `head` no longer matches the branch**, so a transition cannot be applied to a branch that moved since
the operator decided. The nonce gives the transition its replay protection, exactly as it gives every other
`ctxop-v1` operation.

**Who owns which state (ADR 0011 item 1).** Gateway A owns task state; Gateway C owns the seal. `SET_DONE` is
accepted **only against a sealed task**, and the gateway cross-checks the seal before recording `done`. A
transition that arrives for an unsealed task is refused, not silently ignored.

### 6.2 What "never refuses silently" means

The app must not refuse silently, and neither may the gateway:

- the gateway answers a refused transition with a **catalogue code and a message**, from the frozen catalogue
  (`gateway/src/errors/catalogue.ts` ≡ `gateway/docs/error-catalog.md`), and never with a bare 4xx;
- the app must surface the refusal to the operator **with its cause**, and must not retry a transition that
  the gateway refused for a semantic reason (a moved head, an unknown state, an out-of-scope branch).

### 6.3 What is not decided here

- **The exact state set** must be reconciled with `template/engine/schemas/task.schema.json` before the
  operation is implemented. The list in §6.1 is a proposal, and this document does not change the shipped
  schema.
- **Where the transition is applied.** Gateway A owns the task's state, and Gateway C owns the writer lease and
  the seal. A `SET_DONE` therefore has to be expressed as *the operator asserts done over a sealed task*, and
  the two gateways' views must not be able to disagree silently. **This is an open question for the operator**
  (Q-B below), and it is the reason this section is a proposal rather than a contract.

> **Open question Q-B (for the operator).** Which gateway owns the task state, and what happens when Gateway A
> says `done` and Gateway C says `sealed`? The agent's recommendation is that **Gateway A owns the state and
> Gateway C owns the seal**, and that `SET_DONE` is accepted only when the task's capability has already been
> refused by a seal (i.e. the work is finished) — Gateway A then records `done` as an assertion over a
> Gateway-C-attested fact, and the gateway cross-checks that fact before accepting it. This keeps one owner
> per fact, which is the rule the rest of this repository already follows.

---

## 7. Evidence

### 7.1 In this repository, read and executed in this session

| Check | Command | Result |
|---|---|---|
| Read gateway unit tests | `npm test` in `gateway/read/production` | see the agent report for this pull request |
| Write gateway unit + integration | `npm run test:unit`, `npm run test:integration` in `gateway/write` | see the agent report |
| Conformance suite (scheme, vectors, behaviours) | `python3 -m unittest discover -s conformance -p 'test_*.py' -v` | see the agent report |
| Conformance harness end to end | `python3 conformance/harness/run.py all --reference` | see the agent report |
| Release machinery self-test | `release/test-release.sh` | see the agent report |
| The deployed staging pilot (evidence for the write gateway's replay behaviour and for the revocation rows) | GitHub Actions run `41964576712`, `staging-pilot`, `signed` mode, 2026-11-05 — **"THE PILOT PASSED (44 checks)"** | read from the run log, 2026-11-07 |

### 7.2 In `inscope-labs/operator-console` — cited, not executed

Everything in §4.1 is cited by path at commit `992defff591d39539bcc8b4ca3cbc14eb9bab783`. **No test in that
repository was executed in this session**: it is a read-only reference for this stage, and the agent does not
claim any of its tests pass. The two documents that carry the operator's own sign-off on this format are
`docs/release/PHASE-1-COMPLETION-REPORT.md` (2026-11-07) and `docs/adr/0001`, `0005`, `0007`, `0008`.

---

## 8. Decisions this document raised, and where each was answered

**All five are closed.** The operator's answers are recorded in ADR 0010 (Q-A, Q-C, Q-D, Q-E) and ADR 0011
(Q-B and the state set). The right-hand column says what each answer *requires*, because an answer that
requires work is not the same as an answer that closes something.

| # | Question | The operator's answer | What it requires |
|---|---|---|---|
| **Q-A** | What does "cross-system conformance" mean? | **A shared executable suite covers the shared properties only** (signing discipline, expiry bound, revocation semantics). Each format's own suite owns the rest. This document remains the cross-system statement. | **S2** builds the shared-property suite; **S7** runs it |
| **Q-B** | Which gateway owns the task state, and how do Gateway A's state and Gateway C's seal stay consistent? | **Gateway A owns task state; Gateway C owns the seal.** `SET_DONE` is accepted only against a sealed task, and the gateway cross-checks the seal before recording `done`. Gateway C gains a guarded status-transition operation (D-4). | **S2** implements the operation, with refusal tests (unsealed task, wrong state, replayed transition) |
| **Q-C** | **GAP R-1**: the read link is reusable until it expires. | **Accept the residual risk in writing, and add observable replay** (option R-1.a plus R-1.d). No scheme change. | **S2** records every presentation in the audit stream, with a threshold alert |
| **Q-D** | **GAP R-2**: the write root capability is a bearer credential. | **Accept** (option R-2.a) for 0.6.0. **Option R-2.c — bind the root to an agent identity — is a later cross-system stage**, not part of 0.6.0. | Nothing in 0.6.0; the document states the operation-level protections that do apply |
| **Q-E** | Is `ctxop-v1`'s per-capability revocation required for 0.6.0, or is key retirement enough? | **Required.** Revoking one action must not need a device-key rotation. | Gateway A is in operator-console; build-engine verifies the condition through the console's acceptance evidence at **S7** |
