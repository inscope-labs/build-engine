# One-time setup

## 1. Repositories

- Private repo `inscope-labs/castiel-dev` (exists). Not a fork.
- Public repo `inscope-labs/castiel`.
- Make `build-engine` the default branch of `castiel-dev` (Settings -> General -> Default branch), or let
  `cbridge bootstrap` do it via `gh`. Scheduled and dispatched workflows only run from the default branch,
  and a default branch of `build-engine` keeps `main` free of anything but upstream commits.
- Settings -> Actions: allow workflows (CI only runs unit tests and plan validation).

## 2. Operator machine (Termux)

    pkg install git gh jq unzip coreutils python
    gh auth login                      # an account with write access to both repos
    gh auth setup-git                  # lets git (and cbridge) use that login over HTTPS
    gh api -H "Accept: application/vnd.github.raw" \
      "repos/inscope-labs/castiel-dev/contents/operator/install.sh?ref=build-engine" | sh
    export PATH="$HOME/bin:$PATH"      # if the installer says so
    chmod 600 ~/.config/cbridge/config # review it; pre-filled for inscope-labs
    cbridge init
    cbridge doctor                     # confirms castiel-dev is private
    cbridge bootstrap                  # seeds castiel-dev main from castiel main (once)

## 3. Supervisor identity

Create a fine-grained personal access token (ideally from a dedicated bot account with Write access to
`castiel-dev` only):

- Resource owner: `inscope-labs`; repository access: **only** `castiel-dev`.
- Permissions: Contents (read/write), Pull requests (read/write), Metadata (read). Add Workflows only if
  the supervisor must edit `.github/workflows/`; it normally should not.
- Short expiry (30-90 days). Store as an agent secret. Never commit it.

The supervisor has no token for `inscope-labs/castiel`. Public repo reads need none.

## 3b. Branch protection

On a free plan, rulesets and branch protection are unavailable for private repositories, so nothing blocks
a direct push to `castiel-dev` `main`. Enforcement is by detection: `cbridge verify-main` and supervisor G0
fail on any non-upstream commit. A paid plan (Pro / Team) allows real rulesets; if you upgrade, protect
`main` (no pushes except the sync identity), `build-engine` (no force-push, no deletion) and `task-*`.

## 4. First plan

    cd ~/cbridge/engine
    python3 engine/tools/plan_tool.py new castiel-framework --number 10008 --title "Castiel framework completion"
    # edit plans/castiel-framework/plan.json (verify commands, deliverable_roots, spec) and stages.json
    git add -A && git commit -m "plan: castiel-framework" && git push private HEAD:build-engine

## 5. Dry run

Before real work: create one trivial task, run the full loop with a throwaway `task-test` branch, close
the PR unmerged, and run `cbridge reconcile`. Confirm `gh pr list --head <branch>` finds PRs created from
an in-repo branch (the reconcile step assumes it does).

## 6. Context gateway (optional, for agents that can only make HTTPS GET requests)

Not deployed yet: see `docs/CONTEXT-EXPORT.md` for the design, the proof of concept and the production path.
To try the proof of concept locally: `python3 gateway/ctxgate.py serve --config gw.json --repo <private repo checkout>` from a checkout of the build-engine source repository (the gateway is not part of releases),
set `context.gateway.base` in `engine.json`, export `CTXGATE_SECRET`, then order as usual.
