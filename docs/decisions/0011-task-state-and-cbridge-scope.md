# 0011: task state ownership and cbridge scope

Status: **decided** (2026-11-08)

Closes questions Q-B and the state-set question of `docs/release/CAPABILITY-CONFORMANCE.md` section 6, and Q-CB-1, Q-CB-2 and Q-CB-3 of `docs/release/CBRIDGE-COVERAGE-MATRIX.md`.

## Question
Who owns task state, which state set is authoritative, and what are the acceptance and retirement rules for the cbridge commands?

## Decision
1. **Q-B, task-state ownership.** Gateway A owns task state; Gateway C owns the seal. `SET_DONE` is accepted only against a sealed task, and the gateway cross-checks the seal before recording `done`. Gateway C gains a guarded status-transition operation (D-4) as the contract between them.
2. **Q-B2, the state set.** The shipped schema `template/engine/schemas/task.schema.json` is the authority. Section 6.1 of `CAPABILITY-CONFORMANCE.md` is reconciled to it, and any difference is reported. The shipped schema does not change.
3. **Q-CB-1, OC-7 acceptance.** OC-7 passes only when each native feature has a named test and its gateway route is not a stub. OC-7 therefore depends on OC-1 and OC-4.
4. **Q-CB-2, `cbridge upload` and Gateway C.** Both are supported in 0.6.0: Class A through `cbridge upload`, Class B through Gateway C. `cbridge upload` is retired only after the console's real upload passes OC-8, and the 0.6.0 artifact keeps it until then.
5. **Q-CB-3, `verify-main` divergence report.** "The head moved" is the whole guarantee. The console is not required to report divergence of the private `main`.

## Rationale
Records the operator's answers to the S0 questionnaire. Each is the option the document recommended, or, for Q-CB-3, the smaller scope (the document gives no recommendation).

## Consequences
- Stage S2 adds the status-transition operation to Gateway C, with refusal tests (unsealed task, wrong state, replayed transition), and updates `gateway/write/docs/protocol.md` and the error catalog in the same change.
- Stage S6 keeps `cbridge upload` working (`tests/test_cbridge.sh`) and records the console-upload sequencing constraint.
- Stage S7 requires console evidence for OC-7 under the stricter rule in item 3.

## Blocks resolved
S0 exit gate items Q-B, Q-CB-1, Q-CB-2, Q-CB-3 and the state-set reconciliation.

## Operator authorization
Recorded from the operator's completed S0 decisions questionnaire, uploaded 2026-11-08. Approver: John Wendell, operator and lead architect, inscope-labs. All five answers were the recommended defaults (A).
