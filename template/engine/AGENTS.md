# Engine rules (all plans)

Authoritative rules for every actor in the build-engine loop. Plan-specific rules live in
`plans/<plan_id>/AGENTS.md` and may add to, never relax, these.

## Actors

| Actor | Does | Never does |
|---|---|---|
| Operator (human, Termux) | orders, hands over, uploads, publishes, merges | edits submissions after handover; commits to PROJECT-dev `main` |
| Worker (agent) | produces files + report from one WORK ORDER, using whatever tools it has | pushes to `PROJECT` or to `PROJECT-dev` `main`; treats a source other than the order's context URLs as authoritative |
| Supervisor (agent with repo access) | gates, builds task branches, updates plan state, writes the exit report | touches the public repo; force-pushes; merges; edits `main` |
| `plan_tool.py` | the only writer of task status/evidence and `PLAN.md` | commits or pushes |
| `cbridge` | the only component that crosses public/private | is given to agents |

## Invariants

1. `PROJECT-dev` `main` receives no commits except fast-forwards from upstream `main`, made by `cbridge sync`.
2. `build-engine` is never merged anywhere. Product code never lives on it.
3. A `task-<id>` branch is cut from `PROJECT-dev` `main`, contains deliverable files only, and reaches
   public `PROJECT` only through `cbridge publish`.
4. Task status and evidence change only through `plan_tool.py set`. Structural edits (adding, dropping,
   superseding tasks, changing dependencies, resolving decisions) are operator edits, followed by
   `plan_tool.py render` and `check`. `PLAN.md` is generated and never hand-edited.
5. A task is `done` only after its pull request is merged into public `PROJECT` (verified by
   `cbridge reconcile` and re-checked by the supervisor).
6. Submissions are immutable once handed over. Corrections are a new order with a `-rN` suffix.
7. If a `HALT` file exists (repo root or plan directory), every actor stops at the next boundary.
8. Nothing private (plan content, repo names, internal paths) appears in public commit messages, PR
   titles or bodies, or branch contents.

## Identifiers

Task id: `PLAN-PHASE-TASK-SUB`, for example `10008-5-102-00`.

- PLAN: 5-digit plan number from the repo's atomic counter (`plans/counter.json`); unique within this repo only.
- PHASE: any positive integer (unlimited, no phase 0). TASK: three digits; the hundreds digit is the stage
  (`102` = stage 1, task 02), so at most 9 stages per phase and 99 tasks per stage. SUB: two digits.
- A sub-task (`-01`, `-17`...) is a task in its own right, usually a revision of the same task. Which earlier
  sub-tasks are cancelled is a planning decision, not enforced by tooling.
- A failed review never changes a task id. The same id names the task file, its branch (`task-<id>`), its PR, its
  dependencies and its submission.
- Stage id: `PHASE-STAGE` (`5-1`). Work order (submission) id: `PLAN-Snnn`; a re-order after a failed review is a
  new work order with `rework_of` set, and the task ids and branches stay the same.

## Context

A work order carries only URLs as context, pinned to commits. They point at files in the private `PROJECT-dev`
repository (PROJECT content as mirrored in `PROJECT-dev` `main`, and plan files on `build-engine`). Agents never
use the public repository. Authenticated agents read them with git or curl; limited agents use signed gateway links
(plain HTTPS GET, expiring, read-only; see `docs/CONTEXT-EXPORT.md`) when the order lists them. No gateway is deployed in
this version.

## Handover vocabulary (closed)

Operator to supervisor: `SUBMISSION: <id>`, `MERGED: <id>`, `CLOSED: <id>`.

Worker: per task `READY_FOR_SUPERVISOR: <task id>` or `BLOCKED_<task id>: <reason>`.

Supervisor outcome: `ACCEPTED_PR_OPEN` | `PARTIAL_PR_OPEN` | `RETURNED_FOR_REWORK` | `BLOCKED_NEEDS_OPERATOR`.

Task status: `planned` -> `in_progress` -> `pr_open` -> `done` (also `dropped`, `superseded`).

## Submission format

```
plans/<plan_id>/submissions/<submission_id>/
  SUBMISSION.json              worker-written; see engine/schemas/submission.schema.json
  <task_dir>/REPORT.md         exactly the nine `##` headings from the order, in order
  <task_dir>/files/<path>      one file per deliverable and companion, at its final repo path
  UPLOAD.json, MANIFEST.sha256 written by cbridge at upload (never by the worker)
  EXIT-REPORT.md               written by the supervisor at G7
  RECONCILE.json               written by cbridge after merge
```

The files under `files/` must be exactly the task's deliverables plus companions: no more, no fewer.
All files are UTF-8 text. No secrets, no symlinks.

## Engineering defaults (plans may tighten)

- Smallest change that satisfies the acceptance criteria. No drive-by edits.
- No `TODO`/`FIXME`, no placeholder implementations, no commented-out code in deliverables.
- Every acceptance criterion maps to evidence in the report (a file:line or a verification result).
