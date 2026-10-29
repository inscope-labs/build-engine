# Build Engine — Pending Register

Work that is decided or requested but not yet done, and has no place in the Phase 0 defect register
(`docs/release/DEFECT-REGISTER.md`, which records defects found in audits) or in a stage report. Read it before
planning a release; update it in the same pull request that changes an item's status.

- Repository: `https://github.com/inscope-labs/build-engine`
- Register created: 2026-10-29 (after the 0.5.0 Basic release)
- Not shipped: this file lives outside `template/` and is never part of a release artifact.

## Rules

1. **One entry per piece of work.** IDs are `P-NNN`, assigned in order, never reused or renumbered.
2. **Statement first.** The `Request` line records what the operator asked for, in their words as nearly as possible.
   Everything else is analysis and may be corrected; the request is not edited, only superseded by a new entry.
3. **Status words:** `OPEN` (accepted, not started), `IN PROGRESS` (a branch or PR exists; link it), `BLOCKED`
   (waiting on a decision or another item; say which), `DONE` (merged and, where relevant, released; give the PR and
   release), `DROPPED` (operator decision; give the date and reason).
4. **Priority and target release are set by the operator.** `unassigned` means nobody has decided. Do not infer one.
5. **Published releases are immutable.** Work that changes shipped content lands in a later release.
6. **Done needs evidence:** PR number, the commit or release that carries it, and the check that proves the
   acceptance criteria. Move the entry to the Closed section when done.

## Summary

| ID | Title | Status | Priority | Target release | Origin |
|---|---|---|---|---|---|
| P-001 | Remove all references and constraints about the host repository's visibility | OPEN | unassigned | unassigned | Operator, 2026-10-29 |

## Open entries

### P-001 — Remove all references and constraints about the host repository's visibility

- **Request (operator, 2026-10-29):** "Remove all references / constraints to the visibility of the host repository."
- **Status:** OPEN
- **Priority / target release:** unassigned / unassigned
- **Type:** change to shipped content (engine, operator script, documentation, prompts) and to tests
- **Why it matters:** release 0.5.0 assumes the engine is hosted in a **private** repository next to a **public**
  upstream, and enforces it. A repository that hosts the engine in any other arrangement (for example a single public
  repository holding both the plans and the product, which is how `castiel` now uses it) is refused by `cbridge` and is
  described incorrectly by the documentation and by the text printed in every work order.

**Scope.** Nothing the engine ships or tells an operator or agent may state, assume, check or depend on whether the
host repository is public or private. That covers four kinds of content:

1. **Checks that enforce it.** `operator/cbridge` runs `assert_private` (via `gh api ... .private`) before `bootstrap`,
   `sync`, the engine-worktree sync (used by `upload`, `reconcile`, `halt` and `resume`) and `publish`, and `doctor` fails when the repository is not private. It also refuses
   `OUTBOX_URL` or `UPSTREAM_URL` equal to the private repository.
2. **Wording that assumes it.** Documentation, agent prompts, the printed work-order text ("URLs into a private
   repository"), error messages and config comments describe repositories as private or public and give rules that
   depend on it.
3. **Design that is built on it.** The leak controls (`DENY_TEXT` defaults to the private repository's name), the
   "private by construction" principle, the context-gateway rationale (source of truth is private) and decision D1
   are justified by visibility.
4. **Tests that lock it in.** `tests/test_cbridge.sh` and the update-flow tests use private/public fixtures and assert
   the privacy refusal.

**Measured inventory (against `main` at `c95ae51`).** Counts are lines matching `private`, `public`, `visib` or
`PROJECT-dev`, so they overstate real changes where a line only uses the word in passing. Re-measure when the work
starts.

| Area | Files (count) |
|---|---|
| Operator script and its docs | `template/operator/cbridge` (36), `operator/README.md` (8), `cbridge.config.example` (6), `install.sh` (5) |
| Shipped docs | `CONTEXT-EXPORT.md` (17), `OVERVIEW.md` (14), `SETUP.md` (13), `SECURITY.md` (12), `OPERATOR-GUIDE.md` (6), `DECISIONS.md` (6), `TASK-FORMAT.md` (3), `GATES.md` (3), `TEMPLATE.md` (2), `LOOP.md` (1) |
| Agent prompts and rules | `engine/AGENTS.md` (12), `AGENT-SUPERVISOR-PROMPT.md` (6), `AGENT-WORKER-PROMPT.md` (1) |
| Engine tool | `plan_tool.py` (5: docstring, context error message, work-order text), `engine.json` (3: `private_slug` key and URL placeholders) |
| Tests | `tests/test_cbridge.sh` (20), `tests/test_update.sh` (3), `test_plan_tool.py` (3) |
| Outside the shipped payload | `README.md` (6), `gateway/read/**/README.md` (4), `docs/proposals/context-export.md` (2), `docs/decisions/0005-class-a-access.md`, `docs/RELEASING.md`, `docs/END-TO-END.md`, `docs/pilot/README.md`, `conformance/harness/README.md` (1 each) |

Historical records (`docs/release/DEFECT-REGISTER.md` and the phase reports) describe past decisions and are not
rewritten; they stay as evidence.

**Acceptance criteria.**

1. A search of the shipped payload (`template/`) and the operator script for `private`, `public`, `visibility` and
   `is private` finds no statement, check or rule about the host repository's visibility. Words used for another
   meaning (for example a private key pattern, or a public API contract) are the only permitted matches and are listed
   in the closing PR.
2. `cbridge` runs identically whatever the visibility of the repositories it is pointed at; no call to the GitHub API
   for the visibility flag remains.
3. The work-order text, prompts, error messages and config comments contain no visibility wording.
4. Leak controls and other safeguards that currently rely on visibility are restated in visibility-neutral terms or
   removed deliberately (see questions 1 and 2), and `docs/SECURITY.md` says what each protects against.
5. Tests no longer assert the privacy refusal; fixtures do not depend on repository visibility. `release/test-release.sh`,
   `tests/test_update.sh`, `tests/test_cbridge.sh` and CI pass.
6. `COMPATIBILITY.md` and `CHANGELOG.md` record the change in the release that carries it, and
   `release/set-version.sh` and `verify.sh --release` pass for that release.

**Open questions for the operator** (answer before work starts; the entry stays `BLOCKED` on them if it is started
earlier):

1. **Topology.** The two-repository flow (a working repository plus a separate upstream, bridged by `cbridge`) exists
   today because one side is private. Should it remain as an optional, visibility-neutral topology (two repositories,
   names and roles configured, no claims about who can read them), or be replaced by a single-repository layout?
2. **Safeguards.** Should the default leak controls (`DENY_TEXT` of the working repository's name, `plans/`,
   `submissions/`) stay as configurable defaults, or be dropped, given they are meaningless when nothing is private?
3. **Config naming.** `private_slug` (in `engine.json`) and `PRIVATE_URL` / `PRIVATE_SLUG` (in the `cbridge` config) carry
   the word. Rename them (for example `host_slug`), with the renamed keys accepted for one release, or break
   compatibility? A rename of a seed file affects every consumer, so it also needs a note in `COMPATIBILITY.md`.
4. **Release.** Which release carries it: a patch, 0.6.0 Standard, or later? 0.5.0 is published and cannot change.

**Related records.** Release 0.5.0 (`v0.5.0`); the `castiel` consumer's `engine/ENGINE-JSON.md` (castiel PR #3, section 6)
documents today's limitation; `docs/decisions/0005-class-a-access.md`.

**Owner:** operator decides scope and release; implementation owner not yet assigned.

## Closed entries

None yet.

## Change log

| Date | Change |
|---|---|
| 2026-10-29 | Register created with P-001 (operator request). |
