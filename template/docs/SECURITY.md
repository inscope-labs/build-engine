# Security model

## Boundaries

| Asset | Where | Who can touch it |
|---|---|---|
| plans, prompts, reviews, records | private `build-engine` | operator, supervisor |
| product code | public `PROJECT` | operator via `cbridge publish` and merge |
| public-repo credentials | operator's Termux `gh` login | operator only |

The supervisor token is scoped to `PROJECT-dev`. A leaked or misused supervisor token cannot push to or
open PRs in the public repo. Rotate it on a schedule.

## Leak controls on the public path (`cbridge publish`)

- Only the exact, guarded commit SHA is pushed; nothing else leaves the private repo.
- Task branches must descend from upstream `main`; any `build-engine` ancestry is refused.
- Denied paths (`engine/`, `plans/`, `.github/` by default), merge commits, secret patterns, private names in
  commit messages and PR title/body (`DENY_TEXT`), and optionally author emails (`ALLOW_EMAIL_RE`).
- `cbridge doctor` and every command that writes private content refuse to run unless `PROJECT-dev` is
  confirmed private through the GitHub API.

Published commits expose authorship, timestamps and diffs. Use a noreply email for task commits.

## Context gateway (reference only; not deployed in this version)

Limited agents read context through signed, expiring, read-only links served by a gateway (`docs/CONTEXT-EXPORT.md`).
The signing secret exists only on the operator machine (`CTXGATE_SECRET`) and in the gateway's secret store; the
repository token exists only in the gateway; agents hold neither. Links are never written to the repository.
A leaked link exposes one file at one commit until it expires or its order is revoked.

## Known limitations

- **No branch protection on a free private repo.** Direct pushes to `PROJECT-dev` `main` are possible and
  are detected, not prevented (G0 tripwire, `verify-main`).
- **Fine-grained PAT scopes cannot be introspected.** The supervisor prompt cannot verify its own token's
  permissions. Keep the token narrowly scoped at creation and short-lived.
- **Task branches live in the public repo** (outbox = PROJECT) between publish and merge. Delete them after
  merge. Their contents are, by design, only deliverable files.
- **Worker output is untrusted.** `SUBMISSION.json` `worker.*` fields are informational. Hashes and
  provenance come from `cbridge upload` (`UPLOAD.json`, manifest), not from the worker.
- **Verification commands run on the operator/supervisor machine.** `verify.argv` and plan suite commands
  come from plan files you control; review plan changes like code.

## Credentials hygiene

Never paste tokens into chats, issues or commit messages. A token pasted anywhere outside a secret store
should be revoked and replaced. Tokens never belong in this repository (`.gitignore` blocks common names;
`cbridge` and `plan_tool.py` scan submissions for key patterns).
