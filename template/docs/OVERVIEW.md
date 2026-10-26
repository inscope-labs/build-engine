# Overview

## Purpose

A deterministic, human-gated loop that turns a plan into merged code in a public upstream repository
using AI workers and a supervising agent, while keeping the plan, prompts, reviews and records private.

## Principles

1. **Context by URL.** A work order carries only URLs, pinned to a commit. Workers are free to use any
   capability they have to execute it; what they must not do is act outside the order's scope.
2. **One write path per artifact.** Task status and evidence: `plan_tool.py set`. `PLAN.md`: generated.
   Public repo: `cbridge publish`. private consumer `main`: `cbridge sync`.
3. **Humans hold the keys.** The operator orders, uploads, publishes and merges. Nothing runs
   autonomously; CI only validates `build-engine`.
4. **Private by construction.** Plans never live in the public repo; public commits and PR text are
   scanned for private names.
5. **Done means merged.** A task is `done` only after its PR is in the public upstream `main`.
6. **Portable.** `engine/` is plan-agnostic; plans are data under `plans/<plan_id>/`.

## Topology

| Repo / branch | Visibility | Role |
|---|---|---|
| `<owner>/<project>` `main` | public | the product; receives PRs |
| `<owner>/<project>` `task-<id>` | public, short-lived | outbox branches created by `cbridge publish` |
| `<owner>/<project>-dev` `main` | private | locked copy of upstream `main`; fast-forward syncs only |
| `<owner>/<project>-dev` `build-engine` | private (default branch) | engine, plans, submissions, records |
| `<owner>/<project>-dev` `task-<id>` | private, short-lived | supervisor-built, guarded, then published |

The private consumer repository (`<project>-dev`) is a detached private repository, not a fork: a public repo's forks are public, and a repository cannot be forked into its own owner. Consequently the PR path is `cbridge`, not GitHub's fork machinery.

## Actors

See `engine/AGENTS.md` for the authoritative table and invariants.

| Actor | Credential |
|---|---|
| Operator | own `gh` login on Termux (can write to both repos) |
| Supervisor | fine-grained PAT, private consumer repository only, Contents + Pull requests (read/write) |
| Worker | none by default |

## Plans

A plan is a directory of JSON: stages (some are *gates*), tasks with acceptance criteria, deliverables,
dependencies and verification. A task may start only when its dependencies are `done` (merged), its open
decisions are resolved, and every earlier gate stage is `done`. Many plans coexist under `plans/`.
