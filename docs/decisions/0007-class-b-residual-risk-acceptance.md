# 0007: acceptance of Class B residual risks R0-005 and R0-007

Status: **decided** (2026-11-02)

Closes plan decision D-5 (with D-5b).

## Question
Does the operator accept, or require a fix for, the residual risks of the GET-based write route (R0-005) and of ephemeral staging and ambiguous commit outcomes (R0-007)?

## Decision
The operator accepts both risks, signed by this record, for **staging and production**.
- **R0-005, GET-mutation semantics:** the GET-only design is retained.
- **R0-007, ephemeral staging and ambiguous retry outcomes:** the current design is retained; ambiguity is resolved by operator reconcile.

Conditions that stay mandatory and tested:
1. No-store and no-prefetch controls on the write route.
2. Log hygiene: query strings are never retained by the gateway; the sentinel-secret tests stay in the suite.
3. Platform request logs and traces for the write gateway stay disabled (ADR 0001 closure).

This acceptance does not waive the Phase 4 to 6 implementation and verification gates (conformance, staging pilot). It also does not accept any other risk in `DEFECT-REGISTER.md`.

## Rationale
The operator chose to keep the GET-only protocol and carry the documented residual risk rather than change the protocol before deployment.

## Consequences
- R0-005 and R0-007 are recorded as accepted residual risks under this ADR. `DEFECT-REGISTER.md` and `docs/STATUS.md` still show them as open; updating them is a follow-up (STATUS.md is outside this assignment's authorized paths).
- Any later change that weakens a mandatory control above needs a new decision.

## Blocks resolved
D-5; the residual-risk blocker for 0.6.0 Standard (subject to the conditions above).

## Operator authorization
Recorded from the operator's completed decisions questionnaire, uploaded 2026-11-02. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1-8 were answered YES (decisions closed as answered; pull requests on both repositories limited to decision and release documents; no merge, tag, release or push to `main` by Claude; session token used for this assignment only; signed acceptance of the D-5 risks). Statement 9 was answered NO: nothing on Cloudflare is created, changed or deployed, and no secret is handled, in this assignment.
