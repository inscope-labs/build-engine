# 0010: capability conformance decisions

Status: **decided** (2026-11-08)

Closes questions Q-A, Q-C, Q-D and Q-E of `docs/release/CAPABILITY-CONFORMANCE.md`.

## Question
How is cross-system conformance defined, and what is done about the two capability gaps (GAP R-1: the read link is reusable until it expires; GAP R-2: the write root capability is a bearer credential), and about per-capability revocation of `ctxop-v1`?

## Decision
1. **Q-A, cross-system conformance.** A shared executable suite covers the shared properties only (signing discipline, expiry bound, revocation semantics). Each capability format's own suite owns the rest. `CAPABILITY-CONFORMANCE.md` remains the cross-system statement.
2. **Q-C, GAP R-1.** Option R-1.a plus R-1.d: the residual risk is accepted in writing, and observable replay is added (each presentation of a read link is recorded in the audit stream, with a threshold alert). No scheme change.
3. **Q-D, GAP R-2.** Option R-2.a now: the bearer-credential risk is accepted in writing, with the operation-level protections stated in the document. Option R-2.c (bind the root capability to an agent identity) is recorded as a **later cross-system stage** and is not part of 0.6.0.
4. **Q-E, per-capability revocation for `ctxop-v1`.** Required for 0.6.0. Revoking one action must not need a device-key rotation. Gateway A lives in operator-console; build-engine checks this condition through the console's acceptance evidence at stage S7.

## Rationale
Records the operator's answers to the S0 questionnaire. Each is the option the document recommended.

## Consequences
- Stage S2 implements observable replay on the read link (R-1.d) and the shared-property suite (Q-A). No signing-scheme change and no regenerated signing vectors.
- `CAPABILITY-CONFORMANCE.md` records GAP R-1 and GAP R-2 as accepted gaps citing this ADR, and lists R-2.c as a later stage.
- The S7 entry gate requires console evidence that per-capability revocation is implemented and not a stub.

## Blocks resolved
S0 exit gate items Q-A, Q-C, Q-D, Q-E.

## Operator authorization
Recorded from the operator's completed S0 decisions questionnaire, uploaded 2026-11-08. Approver: John Wendell, operator and lead architect, inscope-labs. All four answers were the recommended defaults (A).
