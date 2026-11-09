# Task-state transition contract (D-4)

**Status:** contract (normative for the seal fact, which is **implemented** in this repository's write gateway and tested);
the transition decision is **reference only** here: it is specified and checked by an executable reference
(`conformance/harness/transition_reference.py`), and **Gateway A's implementation is operator-console's work (OC-6)**
and was not verified from this repository.
**Decided by:** ADR 0006 decision 7, ADR 0011 items 1 and 2, operator-console ADR 0008.
**Consumed by:** operator-console OC-6 (`SetTaskStatusUseCase`) and Gateway A's `POST /plans/{id}/status`.

This document is the one place the transition is defined (operator-console ADR 0008: "the operation contract is
defined once, in build-engine"). It replaces the proposal in `CAPABILITY-CONFORMANCE.md` section 6.1 for the
operation's wire behaviour; that section keeps the state table and points here.

## 1. The two halves, and who owns each

| Fact | Owner | Where it lives |
|---|---|---|
| a task's **status** (`planned`, `in_progress`, `pr_open`, `done`, `dropped`, `superseded`) | **Gateway A** | operator-console; the status set is `template/engine/schemas/task.schema.json` (ADR 0011 item 2) |
| a task's **seal** (the agent finished, after a successful commit) | **Gateway C**, the write gateway | this repository, `gateway/write` |

ADR 0011 item 1: *Gateway A owns the state; Gateway C owns the seal. `SET_DONE` is accepted only against a sealed
task, and the gateway cross-checks the seal before recording `done`.* One owner per fact. Gateway A never infers a
seal, and Gateway C never records a status.

**The wording in ADR 0011 and the rollout plan says Gateway C "gains a guarded status-transition operation".** What
Gateway C gains is **the seal fact** (section 2). The *transition* (section 4) is Gateway A's route. Gateway C does
not and must not set a task's status.

## 2. The seal fact (Gateway C, implemented)

`GET {write gateway}/admin/task-state?task=<task>&order=<order>` with the operator token. The route, its parameters,
its refusals and every field of the answer are specified in `gateway/write/docs/protocol.md` section 10.4.1. In short:

- it is **read-only** and creates nothing;
- it answers a **fact, not a decision**;
- `seal_attested` is the one field Gateway A acts on, and it is true only when the session is `sealed`, a seal and a
  commit are recorded, the seal is over that commit, and the commit belongs to **both** the task and the work order
  asked about;
- it carries no capability, signature, path, content hash, writer id or content.

Evidence: `gateway/write/tests/unit/operator/task-state.test.ts` (unit) and
`gateway/write/tests/integration/task-state.test.ts` (over the real request path).

## 3. The transition (Gateway A)

Operator-console `docs/gateway-contract.md` section 3.17 documents the route: `POST /plans/{id}/status`, operator
bearer plus a `ctxop-v1` capability whose operation is `SET`, `SET_IN_PROGRESS` or `SET_DONE`, with the plan, the
task, the branch, the expected head and the target status in the body. This contract governs those three
operations. `DECIDE` is not governed here.

## 4. Who calls whom for `SET_DONE`

1. The console sends `SET_DONE` with its capability to Gateway A.
2. Gateway A runs its existing capability gate (signature, key, expiry, lifetime, branch, then the nonce) and the
   head check.
3. Gateway A reads the seal fact from Gateway C for **this task and this work order**.
4. Gateway A decides by section 5, records the status or refuses, and answers with a catalogue code.

`SET_IN_PROGRESS` and `SET` need no seal fact.

## 5. The decision, in order

The reference is `conformance/harness/transition_reference.py`; the vectors are
`conformance/cases/task-state-transition.json` (28 cases). The first four checks already exist in Gateway A and are
**inherited unchanged**; checks 5 to 8 are what this contract adds.

| # | Check | Refusal | HTTP |
|---|---|---|---|
| 1 | the operation is one of `SET`, `SET_IN_PROGRESS`, `SET_DONE` | `UNKNOWN_OP` (inherited) | 400 |
| 2 | the capability's branch is the task branch | `BRANCH_MISMATCH` (inherited) | 403 |
| 3 | the capability's nonce has not been presented before | `NONCE_REPLAYED` (inherited) | 409 |
| 4 | the task branch head is the head the operator saw | `HEAD_MOVED` (inherited) | 409 |
| 5 | the transition is legal from the task's current status (section 6) | `TRANSITION_NOT_ALLOWED` (new) | 409 |
| 6 | for `SET_DONE`: the seal fact could be read | `SEAL_FACT_UNAVAILABLE` (new) | 503 |
| 7 | for `SET_DONE`: the fact is for this task and this work order | `SEAL_NOT_ATTESTED` (new) | 409 |
| 8 | for `SET_DONE`: the gateway knows the task and `seal_attested` is true | `SEAL_NOT_ATTESTED` (new) | 409 |

**A refusal is never silent.** Every refusal is a code from the frozen catalogue with a message, never a bare 4xx.
**`SEAL_FACT_UNAVAILABLE` fails closed:** if the seal fact cannot be read, nothing is recorded.

## 6. Legal transitions

| Operation | From | Produces |
|---|---|---|
| `SET_IN_PROGRESS` | `planned` | `in_progress` |
| `SET_DONE` | `in_progress`, `pr_open` | `done` |
| `SET` | any non-terminal status, to a status the schema defines other than `done` and other than the current one | the target |

`done`, `dropped` and `superseded` are **terminal**: no transition leaves them. **`done` is reachable only through
`SET_DONE`**, so `SET` with the target `done` is refused (`TRANSITION_NOT_ALLOWED`) and cannot bypass the seal check.
A request for the status the task already has is refused; it is not treated as a success.

## 7. New error codes (additions to Gateway A's frozen catalogue)

The inherited codes are in `gateway/docs/error-catalogue.md` of operator-console. The freeze rule there says a new
public code is added to `gateway/src/errors/catalogue.ts` and that document **in the same change**, with an ADR note.

| Code | HTTP | Meaning |
|---|---|---|
| `TRANSITION_NOT_ALLOWED` | 409 | the transition is not legal from the task's current status, or `SET` named `done` |
| `SEAL_NOT_ATTESTED` | 409 | the write gateway does not attest a seal for this task and work order |
| `SEAL_FACT_UNAVAILABLE` | 503 | the seal fact could not be read; nothing was recorded |

The inherited codes this contract relies on: `UNKNOWN_OP` 400, `BRANCH_MISMATCH` 403, `NONCE_REPLAYED` 409,
`HEAD_MOVED` 409.

## 8. What the console must do with a refusal

- Show the operator the **code and the message**. Never replace them with a generic failure.
- **Do not retry** a refusal for a semantic reason: `TRANSITION_NOT_ALLOWED`, `SEAL_NOT_ATTESTED`, `HEAD_MOVED`,
  `BRANCH_MISMATCH`, `UNKNOWN_OP`, `NONCE_REPLAYED`. A retry needs a new decision and a fresh capability.
- `SEAL_FACT_UNAVAILABLE` may be retried later with a **fresh capability**; the nonce of the refused one is spent.
- Never record `done` locally on a refusal, and never offer to skip the seal check.

## 9. Open points (not decided here)

1. **The legal-transition table in section 6 is new.** ADR 0011 fixes the state set and the seal rule, not which
   transitions are legal. The table is the minimal reading (nothing leaves a terminal status; `done` only through
   the seal). **The operator should confirm it**, in particular that a request for the current status is refused.
2. **Credential custody.** To read the seal fact, Gateway A needs a credential for Gateway C's operator channel. The
   only one that exists is `OPERATOR_TOKEN`, which also grants revoke, close, quota reset, audit reads and minting
   on Gateway C (`protocol.md` section 10.4). Giving Gateway A the whole token is broader than reading one fact.
   The least-privilege alternative is a separate read-only credential for this route alone. It is new work in the
   write gateway and in the deployment configuration, and it was **not** chosen by any ADR. This document records it
   as an open question for the operator.
3. **Gateway A's implementation** is OC-6. This repository verified none of it.

## 10. Evidence

| What | Where | Result when written |
|---|---|---|
| the seal fact, unit and integration | `gateway/write/tests/unit/operator/task-state.test.ts`, `gateway/write/tests/integration/task-state.test.ts` | 26 tests pass |
| the decision reference and its 28 vectors, including a planted-failure check | `conformance/test_task_state_transition.py`, `conformance/harness/transition_reference.py` | pass |
| the contract documents agree | `npm run check:contract` | pass |
