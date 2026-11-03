# 0009: repository protection

Status: **decided** (2026-11-02)

Closes plan decision D-7.

## Question
Which branch protection applies to `build-engine` and `operator-console`?

## Decision
- **build-engine:** the current setup is the policy: `main` protected since 2026-10-29 (pull request required, `test` check required, force-push blocked, administrators not enforced). Accepted residual risk: no required reviews, administrators can bypass, no tag rules. The operator's answer addressed operator-console only; to be confirmed in review.
- **operator-console:** `main` stays **unprotected**. The AI Studio agent created the repository and pushes only to `main`; it does not work on other branches. No protection, ruleset or required check that blocks direct pushes to `main` may be applied without a new decision. Claude's changes to this repository go on branches and pull requests that the operator merges.

## Rationale
The two repositories have different authors and workflows; one rule would lock one of them out.

## Consequences
- No protection settings were changed by this assignment.
- Direct pushes by AI Studio can land while a Claude pull request is open; the operator resolves any conflict when merging.

## Blocks resolved
D-7 (R0-004 for operator-console).

## Operator authorization
Recorded from the operator's completed decisions questionnaire, uploaded 2026-11-02. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1-8 were answered YES (decisions closed as answered; pull requests on both repositories limited to decision and release documents; no merge, tag, release or push to `main` by Claude; session token used for this assignment only; signed acceptance of the D-5 risks). Statement 9 was answered NO: nothing on Cloudflare is created, changed or deployed, and no secret is handled, in this assignment.
