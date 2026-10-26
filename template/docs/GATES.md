# Supervisor gates

Per-task gates stop at the first failure for that task; other tasks continue. G0, G6 and G7 run once per
submission. The mechanical parts of G1 and G2 are implemented by `plan_tool.py check-submission`.

| Gate | Scope | Passes when |
|---|---|---|
| G0 Intake | run | no HALT; `cbridge verify-main` reports main equals upstream tip and no non-upstream commits; `BASE_SHA` recorded; `plan_tool.py check` clean; order file exists; submission untampered since upload (manifest) |
| G1 Layout and secrets | task | `files/**` equals deliverables + companions; UTF-8; no symlinks; no secrets; paths inside `deliverable_roots` |
| G2 Report completeness | task | the nine `##` headings in order; acceptance criteria restated; evidence for each; open questions `None.` |
| G3 Acceptance and spec review | task | every criterion cited to `path:lines`; spec items checked in the target repo; checklists applied |
| G4 Branch build and verify | task | `task-<id>` cut from `BASE_SHA`; files COPIED to final paths; task verify and the plan suite pass |
| G5 Commit, guard, push | task | one commit per task; diff only touches deliverable paths; none of `engine/`, `plans/`, `.github/`; no merge commits; no build-engine ancestry; pushed to PROJECT-dev; `PR-BODY.md` is public-safe |
| G6 Plan integrity | run | tasks set to `pr_open`; render, check, `coverage --fail`, unit tests and `render --check` all pass; pushed to build-engine |
| G7 Exit report | run | `EXIT-REPORT.md` written and pushed; same text printed |

The supervisor never opens the PR. The operator runs `cbridge publish`, which repeats the guards
independently against the public upstream.

## Reconcile (after merge)

`cbridge reconcile` records PR number, state and merge SHA; the supervisor re-verifies against public
`PROJECT` and sets `done` (merged) or `planned` (closed unmerged). Only `done` unblocks dependants.

## Operator-executor tasks

A task with `"executor": "operator"` is never ordered. The operator performs it, uploads evidence as a
submission, and the supervisor runs G0, G1 (evidence layout), G3 (evidence mapped to acceptance criteria)
and G6. If the task ships code it also goes through G4, G5 and the normal PR path; otherwise it moves
`in_progress -> done` with `--notes` summarising the evidence. This lane is a proposal; see DECISIONS.md.
