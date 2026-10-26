# Decisions

## Settled

| # | Decision |
|---|---|
| D1 | `castiel-dev` is private; `castiel` is public. castiel-dev is a detached repo, not a fork. |
| D2 | `build-engine` is the default, exclusive, never-merged branch. `main` takes only upstream fast-forwards. |
| D3 | Individual `task-<id>` branches go only to `castiel`, via `cbridge publish`. |
| D4 | No GitHub App. Supervisor uses a fine-grained PAT scoped to castiel-dev; the operator's Termux login holds public credentials. |
| D5 | Plan state is data (`plans/<plan_id>/`); `engine/` is the portable template. |
| D6 | Copy, not move, deliverables into task branches so submissions stay intact. |
| D7 | `done` is recorded only after the PR is merged (reconcile). `pr_open` records the pushed commit. |

## Proposed - please confirm or change

| # | Proposal | Alternative |
|---|---|---|
| P1 | One branch and one PR per task, named `task-<id>` (rework: `task-<id>-rN`). | One branch per submission. |
| P2 | Outbox is `castiel` itself (same owner as castiel-dev, so a fork is impossible); task branches deleted after merge. | A fork of castiel under a different owner. |
| P3 | Per-task BLOCKED results; unblocked tasks in the same order proceed. | All-or-nothing orders. |
| P4 | Operator-executor lane with light gates (GATES.md). | Treat operator tasks as ordinary tasks with a manual worker. |
| P5 | Statuses `planned, in_progress, pr_open, done` (+ `dropped`, `superseded`). | Fewer states, merging `pr_open` into `in_progress`. |
| P6 | Supervisor never opens PRs; operator does through `cbridge publish`. | Give the supervisor a public-repo token. |
| P7 | Free-plan detection (tripwire) instead of branch protection. | Pay for Pro/Team and use rulesets. |

## Open items

- Worker output transport: file-block text (`unpack_blocks.py`) vs archives. Blocks work in any chat.
- Plan suite commands for castiel (language and toolchain) are not set; no plan exists yet.
- Engine and worker prompts are drafts (v0.1); expect revision after the first dry run.
- `cbridge reconcile` assumes `gh pr list --head <branch>` matches in-repo branches by name; verify on the
  dry run.
- Public task branches should be deleted after merge; `cbridge` does not do this yet.

## Settled by your answers (applied in engine v0.3)

| # | Answer |
|---|---|
| S1 | Plan number: a 5-digit atomic counter per repo / build-engine branch (`plans/counter.json`), not global. |
| S2 | Phases unlimited (no phase 0); max 9 stages per phase; max 99 tasks per stage. |
| S3 | Sub-tasks are independent tasks; cancelling earlier ones is a planning decision. |
| S4 | A failed review never changes a task id; branches, PRs, dependencies and submissions all use the task id. |
| S5 | The trailing `;` is not part of an id. |
| S6 | Concurrency = parallel table + dependency matrix, derived automatically; open-order maximum is configurable. |
| S7 | Work orders carry context as URLs into the private `castiel-dev` repo; agents have no relationship with public `castiel`. |
| S8 | Some agents use authenticated git/curl; limited agents use an HTTPS GET-only gateway. |

## Assumptions still standing (revisit these)

| # | Assumption | Question it stands in for |
|---|---|---|
| A1 | The castiel plan keeps number 10008 and the counter continues at 10009. | What is the counter's real next value? |
| A2 | One work order may cover several tasks (up to `max_tasks_per_order`); its id is `PLAN-Snnn`. | Is a work order exactly one task? |
| A3 | All stages are gates (strictly sequential stages). | Gates, or just groups? |
| A4 | The worker returns files and the operator uploads; the supervisor builds the branch; the operator publishes. | Who pushes, and is a supervisor wanted? |
| A5 | Limited agents are served by a signed context gateway (proof of concept built; not deployed). Hosting, link lifetime and allowed prefixes are open. | See `docs/CONTEXT-EXPORT.md` section 12. |
| A6 | Deliverables are Markdown only (plus two plain-text version files). | Is Markdown-only right? |
| A7 | Task statuses and gate rules from v0.1 are kept. | Which statuses do you want? |
