# 0013: authorizations for the v0.6.0 rollout plan

Status: **decided** (2026-11-08), with one condition recorded below (identity details)

Adopts `docs/release/V0.6.0-ROLLOUT-PLAN.md` and records the operator's authorizations for its execution. Closes the S0 review of the three BE-0 documents.

## Question
What may the executing agent do while running the plan, who authorizes and approves, and are the three BE-0 documents approved?

## Decision
1. **Plan adopted (1.1).** `V0.6.0-ROLLOUT-PLAN.md` is the governing plan for 0.6.0, to be merged by the operator.
2. **Repository actions (1.2).** The agent works on branches and opens pull requests. It never merges, never pushes to `main`, and never tags or publishes before the S9 authorization (G-12).
3. **Deploy workflows (1.3).** The agent may dispatch the staging and production workflows and then waits. The environment reviewer approves each production run in GitHub; the agent never approves its own deploy.
4. **Secrets (1.4).** The agent checks secrets by name only. It never reads, prints, copies or stores a value. A missing secret is reported as BLOCKED-EXTERNAL.
5. **Session token (1.5).** The operator will revoke the token pasted into the earlier chat **at the end of this assignment**, not before. Until then the exposure is an accepted risk, recorded in the S0 report.
6. **Agent identity (1.6).** The agent runs as a separate identity from the operator, so the plan's approval gate holds as written: the approver must not be the dispatching identity.
7. **Authorizer and approver (1.7).** Stated as "John Wendell / inscope-labs".
8. **S9 authorization (1.8).** A comment by the authorizing login on the release PR reading `authorize v0.6.0 at <full commit SHA>`. The agent verifies author, version, and that the SHA equals the tip of `main`.
9. **BE-0 documents (5.1).** `COMPATIBILITY-MATRIX.md`, `CAPABILITY-CONFORMANCE.md` and `CBRIDGE-COVERAGE-MATRIX.md` are reviewed and approved with the answers in ADRs 0010 to 0012. Their "DRAFT" status is removed.

## Conditions
- **Login.** Item 7 gives a name and an organization, not a GitHub login. The S4, S5 and S9 gates compare the author of a comment or approval with a login, so the operator must supply the exact GitHub login(s). Until it is supplied by an addendum to this ADR, those gates are BLOCKED-EXTERNAL.
- **Separate identity.** Item 6 requires an agent identity distinct from the operator's. Its name is not yet supplied. The S3 entry gate checks that the identity running the workflows differs from the production environment's reviewers.
- **Token revocation.** Item 5 means a credential exposed in chat stays valid during the assignment. The replacement session credential, if any, must be fine-grained and limited to `inscope-labs/build-engine`.

## Rationale
Records the operator's answers to the S0 questionnaire.

## Consequences
- The rollout plan's S0 exit gate checks ADRs 0010 to 0013 for status `decided` (the repository's own status word).
- The plan's S9 authorization mechanism is the one in item 8.

## Blocks resolved
S0 exit gate items: plan adoption, authorization records, BE-0 document review.

## Operator authorization
Recorded from the operator's completed S0 decisions questionnaire, uploaded 2026-11-08. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1.1 to 1.4, 1.6, 1.8 and 5.1 were answered with the defaults (A). Statement 1.5 was answered B. Statement 1.7 was answered "John Wendell / inscope-labs".
