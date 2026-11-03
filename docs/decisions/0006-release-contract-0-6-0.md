# 0006: the next release is 0.6.0 Standard (label, protocol identifier, cbridge scope, task state)

Status: **decided** (2026-11-02)

Closes plan decisions D-1, D-2, D-3 (with D-3b) and D-4, and questions Q0.1 and Q0.2 of the decisions questionnaire.
Amends: `docs/release/PHASE-1.1-PRODUCT-CONTRACT.md` (adds a revision row; see Decision 2).

## Question
What does the next release claim, what is it called, which protocol identifier does it carry, how much of the Termux `cbridge` does the Android app replace, and which side owns task status?

## Decision
1. **No 0.5.1.** The next published release is **0.6.0 Standard**. 0.5.0 Basic stays the latest published release until then. Everything planned under the label "0.5.1" is relabelled 0.6.0. Operator correction: the 0.5.1 label departed from the major.minor contract.
2. **Product contract revised (D-1, option b).** The 0.6.0 Standard scope is: deployed Class B read and write gateways, the pilot, the submissions-to-consumer transfer path (R0-011), the Android replacement of the Termux `cbridge` operator workflows (operator-console), and the Class B readiness claim. Everything is gated by decision 4 below.
3. **Protocol identifier: `build-engine/0.6`.** The operator typed `0.6.0` in the identifier field and left the answer line blank. This follows the rule that `build-engine/<major.minor>` equals the release major.minor. To be confirmed in review of this record. Changing the identifier in code, templates and tests is not part of this record; the compatibility matrix (BE-0) inventories every place that carries `build-engine/0.5`.
4. **Release-note claim and its conditions.** Target wording, as supplied by the operator: "Integration milestone: Class B gateways and the Android console are production ready, deployed, and supported in this release." It may be published only when all of these hold: operator-console OC-1 to OC-8 and build-engine BE-4 to BE-7 pass; staging is deployed and the pilot has run against deployed Workers; A03 Core device acceptance passes; production deployment has happened and been verified. Until then no release note, README or metadata may make the claim (plan principle 9).
5. **cbridge scope (D-3).** Local `init`, `bootstrap`, `verify` and shell stay out of the Android app. Each operator workflow gets a documented alternative in `docs/release/CBRIDGE-COVERAGE-MATRIX.md`.
6. **cbridge retirement (D-3b).** The Termux `cbridge` is declared retired only after operator-console OC-8 and build-engine BE-7 both pass and the operator signs.
7. **Task state (D-4).** The gateway gets an explicit, guarded status-transition operation. The app implements it and never refuses silently. Its contract is defined in `docs/release/CAPABILITY-CONFORMANCE.md` (BE-0).

## Rationale
One label, one protocol identifier and one claim keep the release honest: a version that says "ready" must have passed the gates that define ready.

## Consequences
- `docs/release/V0.5.1-BUILD-PLAN.md` is renamed `V0.6.0-BUILD-PLAN.md`; the companion plan in operator-console is renamed to match.
- No metadata change (`engine/VERSION`, `set-version`, tags, release notes) happens before the conditions in item 4 hold.
- Gate 0 is not fully closed by this record: the three BE-0 documents are still to be written.
- The two remaining `0.5.1` strings in the tests are arbitrary fixture versions and one historic defect-evidence line; they are not release labels and are left unchanged.

## Blocks resolved
D-1, D-2, D-3, D-4 of the build plan; the version-label risk in plan section 7.

## Operator authorization
Recorded from the operator's completed decisions questionnaire, uploaded 2026-11-02. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1-8 were answered YES (decisions closed as answered; pull requests on both repositories limited to decision and release documents; no merge, tag, release or push to `main` by Claude; session token used for this assignment only; signed acceptance of the D-5 risks). Statement 9 was answered NO: nothing on Cloudflare is created, changed or deployed, and no secret is handled, in this assignment.
