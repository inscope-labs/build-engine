# Plan and task format

Schemas: `engine/schemas/*.schema.json`. `plan_tool.py check` is the validator.

## Identifiers

    10008-5-102-00
    |     | |   |
    |     | |   +-- SUB   00 = first version; 01, 02... = later versions, each a task in its own right
    |     | +------ TASK  three digits; the HUNDREDS digit is the stage (102 = stage 1, task 02)
    |     +-------- PHASE any positive integer (unlimited, no phase 0)
    +-------------- PLAN  five digits from this repo's atomic counter (plans/counter.json)

- Stage id: `PHASE-STAGE`, for example `5-1`: at most 9 stages per phase, at most 99 tasks per stage.
- A sub-task is an ordinary task. Which earlier sub-tasks are cancelled (`dropped` or `superseded`) is a planning
  decision; tooling does not enforce it.
- A failed review never changes the task id. The same id names the task file (`tasks/<id>.json`), its branch
  (`task-<id>`), its PR, its dependencies and its submission.
- `plan_tool.py new <plan_id>` takes the next plan number from `plans/counter.json` and bumps it atomically.
- A work order (submission) id is `PLAN-Snnn` (`10008-S001`). A re-order after a failed review is a new work order
  made with `--rework-of <order id>`; task ids and branch names do not change.

## Phases and stages (`stages.json`)

```json
{"phases": [{"id": "1", "name": "Ground rules"}],
 "stages": [{"id": "1-1", "name": "Conventions", "goal": "...", "gate": true},
            {"id": "1-2", "name": "Drafting", "gate": false}]}
```

Stages are listed in ascending numeric order (`2-1` before `10-1`). A **gate** stage must be `done` before any task in a later stage may
start. A stage is `done` when all its non-dropped, non-superseded tasks are `done`; a stage with no tasks is
`planned`; a stage whose tasks are all dropped is `done`.

## Task (`tasks/<id>.json`)

```json
{
  "id": "10008-5-102-00",
  "title": "Canonical encoder",
  "stage": "5-1",
  "executor": "worker",
  "status": "planned",
  "summary": "Optional longer description.",
  "acceptance": ["Encodes X deterministically", "Rejects Y with error Z"],
  "deliverables": ["amk/encoder.md"],
  "companions": [],
  "blocked_by": [
    {"type": "task", "ref": "10008-5-101-00"},
    {"type": "decision", "ref": "D-07"}
  ],
  "spec_refs": ["REQ-101"],
  "context": [
    {"source": "target", "path": "amk/amk-ssot.md", "label": "SSOT"},
    {"source": "target", "path": "amk/types.md", "role": "edit"}
  ],
  "verify": {"method": "manual"}
}
```

- `executor`: `worker` or `operator` (operator tasks are never ordered).
- `deliverables`/`companions`: repo-relative paths, not under `engine/`, `plans/`, `.github/`; they must also
  satisfy the plan's `deliverable_roots` and `deliverable_patterns` when set.
- `context`: URLs only, into the private `PROJECT-dev` repository. `source: target` is PROJECT content as mirrored in
  `PROJECT-dev` `main` (`<target_base>/<commit>/<path>`; run `cbridge sync` first so the commit exists there);
  `source: plan` is a file under `plans/<plan>/package/` on `build-engine` (`--plan-ref <commit>`, default the
  engine repo HEAD). If `context.gateway` is configured, each printed item also gets a signed, expiring `gateway_url` for
  agents that can only make plain HTTPS GET requests (see `docs/CONTEXT-EXPORT.md`); signed links are minted at print
  time and never written to `orders/<id>.json`. `plan_tool.py links <plan> <order>` re-mints them. `role: edit`
  marks a file the task replaces; `order --target` adds an `edit` entry automatically for every deliverable
  that already exists.
- `blocked_by`: `task` refs must be `done` (merged); `decision` refs must be resolved in `decisions.json`
  (`plan_tool.py decide`); `item` refs need `"resolved": true`.
- `evidence` and `history` are written by `plan_tool.py set`; never edit them by hand.

## Status transitions (`plan_tool.py set`)

| From | To | Requires |
|---|---|---|
| planned | in_progress | `--by`; task eligible (deps merged, decisions resolved, gates done) |
| in_progress | pr_open | `--by --commit <task-branch head>` |
| pr_open | done | `--by --merge-sha <sha> --pr <n>` |
| in_progress | done | operator tasks only: `--by --notes` |
| in_progress / pr_open | planned | `--by --notes <reason>`; clears pr/commit/merge_sha |

`dropped`, `superseded` and dependency edits are structural operator edits followed by `render` and `check`.

## Work orders

`plan_tool.py order <plan> <ids> --target <PROJECT-dev main checkout> [--write] [--start]` prints a plain-text WORK
ORDER (`--json` for the machine form). Context is URLs pinned to the checkout's HEAD (`--ref <40-hex commit id>` pins one
explicitly; branch names and short ids are refused). Hashes in the order are of the files as committed at that commit,
never of uncommitted working-tree edits. `plan.json` `order_rules` are printed in every order.

Open orders are limited by the concurrency matrix: an order is refused if one of its tasks shares a file with an
in-progress task, and, if configured, when `max_open_orders` (plan.json, else engine.json `limits`) is reached.
`0` or unset means no cap beyond the matrix.

## Concurrency (`CONCURRENCY.md`, generated, automatic)

Derived from dependencies and file use, never declared by hand. Per stage: waves of tasks that may run at the same
time, same-file conflicts, tasks waiting on an open decision, and a dependency matrix (`D` = row depends on
column, `X` = same-file conflict).

## Decisions (`decisions.json`)

Owner-level decisions: `{"id": "D-01", "title": "...", "status": "open"}`. Tasks cite them in `blocked_by`.
Resolve with `plan_tool.py decide <plan> D-01 --by <name> --notes "<resolution>"`.

## Coverage

`coverage_exempt.json` lists spec items that intentionally have no task. The inventory is
`plans/<plan>/spec_items.json` (`{"items": [...]}`) or a scan of the target using `plan.json` `spec`.
`coverage --fail` fails on any uncovered item or any task citing an unknown item.

## plan.json

```json
{"plan_id": "PROJECT-framework", "title": "...", "plan_number": "10008",
 "deliverable_roots": ["amk/"], "deliverable_patterns": ["\\.md$"],
 "order_rules": ["Markdown only; no implementation code."],
 "spec": {"root": "amk/", "glob": "**/*.md", "item_regex": ""},
 "verify": {"commands": []}}
```
