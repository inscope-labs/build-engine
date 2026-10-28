# Operator guide (Termux)

Shorthand used below:

    PT="python3 $HOME/cbridge/engine/engine/tools/plan_tool.py"   # runs inside the engine worktree
    cd ~/cbridge/engine                                           # build-engine checkout (created by cbridge)

`cbridge upload`, `reconcile`, `halt` and `resume` commit and push to `build-engine` for you. For edits you
make yourself (orders, new plans, structural plan changes) commit and push from `~/cbridge/engine` with
`git add -A && git commit -m "..." && git push private HEAD:build-engine`; run `cbridge status` first to
refresh it. cbridge resets that worktree to the remote `build-engine` on every upload, reconcile, halt and
resume, and refuses to run if it is dirty, so push your commits before running another cbridge command.

## Daily loop

1. **Sync and check.** `cbridge sync && cbridge verify-main` (must print `main == upstream`).
2. **Pick work.** `$PT next <plan> --all`.
3. **Order.** Keep a checkout of `PROJECT-dev` `main` (it pins the context URLs to its HEAD; `cbridge sync` first), then:
   `$PT order <plan> <ids...> --target ~/src/PROJECT-dev --write --start`
   Commit and push the new order file and status changes. Give the worker `engine/prompts/AGENT-WORKER-PROMPT.md`
   once, then paste the printed WORK ORDER text. The URLs point into the private repo at that commit, so `PROJECT-dev` `main`
   must already contain it.
4. **Collect.** Save the worker's reply to `out.txt` and run
   `python3 ~/cbridge/engine/engine/tools/unpack_blocks.py out.txt ./sub` (or use a zip the worker produced).
5. **Upload.** `cbridge upload <plan> ./sub`. It prints `SUBMISSION: <id>`.
6. **Supervise.** Give the supervisor `engine/prompts/AGENT-SUPERVISOR-PROMPT.md` once, then send
   `SUBMISSION: <id>`. Read its `EXIT-REPORT.md`.
7. **Publish.** For each pushed task: `cbridge publish task-<ID> --body-file <PR-BODY.md>` (confirm the
   prompt). It guards, pushes to the outbox and opens the PR.
8. **Merge** each PR in `inscope-labs/PROJECT` after your own review.
9. **Reconcile.** `cbridge reconcile <plan> <id> task-<ID> ...`, then send the printed `MERGED: <id>` (or
   `CLOSED: <id>`) to the supervisor.

## Reworks

`$PT order <plan> <ids> --rework-of <order id> --target ... --write`. Task ids and branches do not change. Add the
supervisor's findings as a context file under `plans/<plan>/package/` first (structural edit), commit and push, then order.

## Structural edits

Adding tasks, dropping or superseding them, changing `blocked_by`, resolving decisions: edit the JSON by
hand, then `$PT render <plan> && $PT check <plan>`, commit and push. Never edit `PLAN.md`, `evidence` or
`history`.

## Operator-executor tasks

`$PT set <plan> <ID> in_progress --by operator`, do the work, upload evidence as a submission, let the
supervisor run its light gates. If no code ships: `$PT set <plan> <ID> done --by operator --notes "..."`.

## Emergency stop

`cbridge halt` (all plans) or `cbridge halt <plan>`; `cbridge resume` to lift it. `plan_tool.py` refuses
writes while a HALT file exists, and the supervisor prompt stops at the next gate.

## What `plan_tool.py` guarantees

- **Orders need a valid plan.** `order`, `render` and `next` refuse a plan that fails `plan_tool.py check`, and say why.
- **Pinned context.** Context URLs always carry a full 40-character commit id. A moving ref such as `main` is refused.
- **One writer at a time.** Commands that change files take a per-plan lock; a second run waits up to 15 seconds
  (`PLAN_LOCK_TIMEOUT`) and then reports that another run is still writing.
- **All-or-nothing files.** Each file is replaced atomically. If a multi-file command (`order --write --start`, `decide`,
  `new`) fails part-way, the files it already wrote are restored.
- **Exit codes.** 0 success; 1 validation or operator error; 2 usage error; 70 unexpected internal error (set
  `PLAN_DEBUG=1` for a traceback); 130 interrupted.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `verify-main` exits 1 (diverged) | someone committed to PROJECT-dev `main`. Inspect `git log upstream/main..private/main`; do not force. |
| `verify-main` exits 10 | behind upstream; run `cbridge sync`. |
| `publish` refuses | read the guard message; fix the branch (the supervisor re-cuts it from `main`). |
| `upload` says submission exists | submissions are immutable; use a new `-rN` order. |
| push to build-engine rejected | the supervisor pushed meanwhile; rerun the command. |
| `doctor` says not private | stop. Fix the repo visibility before anything else. |
