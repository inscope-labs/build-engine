# S0 agent handoff — build-engine v0.6.0 rollout

Read first: `docs/release/V0.6.0-ROLLOUT-PLAN.md` (sections 1, 2, 4 and stage S0).
Decisions: ADRs 0010 to 0013 (in `docs/decisions/`), recorded from the operator's questionnaire of 2026-11-08.

## Already done in the pull request that carries this file (do not redo)

- ADRs 0010 to 0013 added, `docs/decisions/README.md` updated, ADR 0008 status line and the DX-1/DX-2 bullets updated.
- `docs/release/V0.6.0-ROLLOUT-PLAN.md` amended to reflect the decisions (it was uploaded to `main` earlier as a draft).

## Your S0 tasks (branch + PR; the operator merges, after the PR above is merged)

1. Remove the DRAFT/proposed status from `docs/release/COMPATIBILITY-MATRIX.md`, `CAPABILITY-CONFORMANCE.md` and
   `CBRIDGE-COVERAGE-MATRIX.md`; update each to cite the ADRs that decided its open questions (matrix: 0012;
   capability: 0010 and 0011; cbridge: 0011). In `CAPABILITY-CONFORMANCE.md`: record GAP R-1 and GAP R-2 as
   accepted gaps citing 0010, and list R-2.c as a later cross-system stage.
2. Reconcile section 6.1 of `CAPABILITY-CONFORMANCE.md` to `template/engine/schemas/task.schema.json` (ADR 0011
   item 2). Report every difference. Do not change the schema.
3. Create `release/rollout-gate.sh` as the plan describes, and confirm it is not in `release/manifest.txt` and not in
   the built artifact.
4. Run `rollout-gate.sh S0`, the standing checks `C-PROT`, `C-CI`, `C-BASE`, `C-CONF`, `C-READ`, `C-WRITE`, `C-ISO`
   at the baseline SHA, and write `docs/release/PHASE-S0-REPORT.md` and the agent report.

## What the S0 exit gate checks

ADRs 0010 to 0013 present on `main` with status `decided`; the three documents no longer draft; the schema
reconciliation reported; ADR 0008 and the README updated; standing checks green.

## Conditions carried forward (not blocking S0; report them as open)

| Condition | Where it comes from | Checked at |
|---|---|---|
| Exact GitHub login(s) for authorization and production approval (the questionnaire gave "John Wendell / inscope-labs", which is not a login) | ADR 0013 | S4, S5, S9 |
| Name of the separate identity the agent runs as; it must not be a production reviewer | ADR 0013 | S3 |
| Submissions repository is stated as `acme-pilot-dev`, the same as the read repository; the plan requires them distinct; the submissions branch is not named | ADR 0012 | S5 |
| Session token stays valid until the end of the assignment and is then revoked by the operator; the exposure is an accepted risk | ADR 0013 | S0 report |
| Q-E needs console evidence that per-capability revocation is implemented, not a stub | ADR 0010 | S7 |

## Do not

Do not change the shipped schema, the signing scheme or signing vectors, or anything in operator-console. Do not
merge, tag or deploy. Do not read or print any secret value.
