# plans/

One self-contained directory per plan. Create one with:

    python3 engine/tools/plan_tool.py new <plan_id> --number <NNNNN> --title "<Title>"

Each plan directory holds `plan.json`, `stages.json`, `tasks/*.json`, `coverage_exempt.json`,
optional `spec_items.json` and `package/`, the generated `PLAN.md`, `orders/` and `submissions/`.
See `docs/TASK-FORMAT.md`. No plans exist yet.
