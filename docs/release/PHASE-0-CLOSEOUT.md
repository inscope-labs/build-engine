BUILD ENGINE — PHASE 0 CLOSEOUT
Repository: https://github.com/inscope-labs/build-engine
Date: 2026-10-26
Inspected main commit: b45e8008adcaa179165abf24880e8eda0eb7c515 (local baseline run at ee654cddeb9bd00043230942d89c8df955ea3afc, which only adds RELEASE-PLAN.md)
Version: 0.5.0

DECISION: PHASE 0 IS NOT YET FORMALLY COMPLETE.

I have consolidated the baseline evidence, the numbered defect register, requirement-to-test traceability, and the remaining closure conditions into reviewable documents. The documents are submitted for review in a pull request from branch phase-0/baseline-defect-register. Nothing on main, release metadata or releases was changed.

WHAT IS CONFIRMED
- The inspected default branch is main; the inspected commit is b45e8008adcaa179165abf24880e8eda0eb7c515.
- VERSION is 0.5.0.
- The latest inspected Actions run, https://github.com/inscope-labs/build-engine/actions/runs/40317887672, passed its two configured jobs, including tests, shell syntax, release self-test, consumer install/update flow, package/verify dry run, and write-gateway typecheck/bundle dry run.
- All 12 release/manifest.txt paths were present in the inspected remote tree. This confirms path existence, not all packaging edge cases.
- No published GitHub releases were listed at the time of inspection.
- ENGINE.json has implements_abstract = UNSET and CHANGELOG.md says 0.5.0 is unreleased. These remain release blockers; Phase 0 does not authorize inventing a compatibility value or falsely marking the release as published.
- Production read gateway is not started/deployed; write gateway is scaffold-only and returns HTTP 501; conformance vectors/harness are incomplete; the real end-to-end pilot has not started.

WHAT WAS VERIFIED LOCALLY (new)
- All 7 documented baseline commands were run at ee654cd and exited 0 (see docs/release/PHASE-0-BASELINE.md).
- release/verify.sh ... --release exits 1 on implements_abstract = UNSET, as expected (F0-001).

WHAT IS NOT VERIFIED
- Branch protection, tag rules, required checks, Actions permissions and environment approvals (GitHub integration returned HTTP 403).
- CI-step-to-command mapping; adversarial archive/manifest cases (R0-001..R0-003).

REQUIRED TO CLOSE PHASE 0
1. Merge this PR (defect register, traceability, baseline record, closeout).
2. DONE in this PR (PHASE-0-BASELINE.md). Remaining: map CI results to the corresponding commands rather than inferring.
3. Verify repository protections with appropriate permissions, or explicitly record and approve a scope-based exception if this is not a Phase 0 prerequisite.
4. Operator reviews and approves the defect register and proposed release scope, or returns required changes. The implementation plan explicitly makes this approval part of the Phase 0 exit gate.
5. Confirm all release promises have an acceptance test or are explicitly qualified/excluded.

NO OPERATOR COMPATIBILITY DECISION IS REQUIRED JUST TO DOCUMENT THE BASELINE. The abstract compatibility value is a later product decision (Phase 1) unless the operator chooses to resolve it earlier. Gateway implementation, conformance completion, pilot execution, final changelog dating, and release publication are later-phase tasks, not Phase 0 tasks.

DELIVERABLES
- docs/release/DEFECT-REGISTER.md
- docs/release/REQUIREMENT-TRACEABILITY.md
- docs/release/PHASE-0-BASELINE.md
- docs/release/PHASE-0-CLOSEOUT.md

Do not start Phase 1 until the Phase 0 closure items above have been satisfied or explicitly dispositioned by the operator.
