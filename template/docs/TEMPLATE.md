# Using the engine in another repository

> **Preferred route:** install a release with `engine/bin/update.sh` instead of copying files by hand. It verifies the artifact, never overwrites your `engine/engine.json`, and records what it installed in `.build-engine.lock`. The manual steps below describe what a release contains and what you configure.

The portable unit is `engine/` plus `operator/` and `docs/`. Plans are data and are not copied.

1. Create a new **private** repository for the target project (`<owner>/<project>-dev`). Keep the target
   project itself in its own (public or private) repository.
2. Create an orphan `build-engine` branch and copy in `engine/`, `operator/`, `docs/`, `plans/README.md`,
   `.gitignore` and `.github/workflows/engine-ci.yml`. (Or use a GitHub template repository with
   "Include all branches" if you maintain this repo as a template.)
3. Edit `engine/engine.json`: `private_slug`, `target.upstream_slug`, `target.base_branch`, `target.pr_base`.
   Adjust `report_headings`, `deny_in_task_branches` and `limits` if your project needs it.
4. Edit `operator/cbridge.config.example` (URLs, slugs, outbox) and the slugs in `operator/install.sh`.
5. Update `README.md` and `docs/SETUP.md` slugs. Do not carry any `plans/<id>/` directories over.
6. Create plans: `python3 engine/tools/plan_tool.py new <plan_id> --number <NNNNN>`; set
   `deliverable_roots`, `spec`, and `verify.commands` in each `plan.json` for the target's toolchain.
7. Run `python3 -m unittest discover -s engine/tools`, then follow `docs/SETUP.md`.

Nothing in `engine/` is specific to Project: language tooling lives in each plan's `verify.commands`,
spec locations in `plan.json`, and repository names in `engine.json` and the cbridge config.

Versioning: `engine/VERSION` follows semver. When you improve the engine in one repo, copy `engine/` over
the others and re-run the tests there; plans carry no engine code.
