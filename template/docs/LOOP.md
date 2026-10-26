# The loop

```
PLAN LIFECYCLE (build-engine)
  plans/<plan>/stages.json + tasks/*.json  --plan_tool.py render-->  PLAN.md (generated)
        |
ORDER   operator:  plan_tool.py next <plan>
        operator:  plan_tool.py order <plan> <ids> --write --start --target <PROJECT checkout>
        -> WORK ORDER text (submission id, tasks, acceptance, deliverables, context URLs pinned to a commit)
        |
WORKER  operator gives the worker AGENT-WORKER-PROMPT.md once, then the WORK ORDER text
        worker reads the context URLs, uses whatever tools it has -> file blocks + READY_FOR_SUPERVISOR / BLOCKED_<id>
        |
UPLOAD  operator:  unpack_blocks.py out.txt ./sub     (or use the worker's zip)
        operator:  cbridge upload <plan> ./sub   -> SUBMISSION: <id>   (to build-engine, never main)
        |
SUPERVISOR  operator sends "SUBMISSION: <id>"
        G0 intake  G1 layout  G2 report  G3 review  G4 build+verify  G5 commit+guard+push
        G6 plan integrity (pr_open)   G7 exit report
        outcome: ACCEPTED_PR_OPEN | PARTIAL_PR_OPEN | RETURNED_FOR_REWORK | BLOCKED_NEEDS_OPERATOR
        |
PUBLISH operator:  cbridge publish task-<id> --body-file PR-BODY.md   (per task; guarded)
        |
MERGE   operator reviews and merges each PR in PROJECT
        operator:  cbridge reconcile <plan> <id> task-<id>...   -> MERGED: <id> | CLOSED: <id>
        |
RECONCILE  operator sends the line; supervisor verifies, sets done / planned, re-renders, pushes
        |
NEXT    read EXIT-REPORT.md "Next orders"; plan_tool.py next
```

Side lanes: `cbridge sync` keeps `PROJECT-dev:main` equal to upstream. `cbridge halt` stops everything at
the next gate. Operator-executor tasks skip the worker (see GATES.md).

## Rework

A failed review never changes a task id. The supervisor sets the task back to `planned` with a reason; the operator
re-orders it with `plan_tool.py order <plan> <ids> --rework-of <order id> --write`. The new work order has a new
`PLAN-Snnn` id; task ids, branch names (`task-<id>`) and the PR stay the same. Earlier submissions are never edited.
