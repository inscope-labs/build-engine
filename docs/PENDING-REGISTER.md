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
   release), `DROPPED` (operator decision; give the date and reason), `CANCELLED` (the entry was **entered in
   error**: the work it describes is not to be done, and the reason is given).
4. **Priority and target release are set by the operator.** `unassigned` means nobody has decided. Do not infer one.
5. **Published releases are immutable.** Work that changes shipped content lands in a later release.
6. **Done needs evidence:** PR number, the commit or release that carries it, and the check that proves the
   acceptance criteria. Move the entry to the Closed section when done.

## Summary

| ID | Title | Status | Priority | Target release | Origin |
|---|---|---|---|---|---|
| P-001 | Remove all references and constraints about the host repository's visibility | CANCELLED | unassigned | unassigned | Operator, 2026-10-29 — cancelled 2026-11-07, entered in error |
| P-002 | Plan-specific repositories are configured into the gateway infrastructure | OPEN | unassigned | 0.6.1 | Operator, 2026-11-10 |
| P-003 | The submissions branch and task folder are plan-specific, not infrastructure | OPEN | unassigned | 0.6.1 | Operator, 2026-11-10 |

## Open entries

Both entries below are **pending decisions**: nothing is built or changed for release 0.6.0. The operator set
the target release (0.6.1); priority is not set.

### P-002 — Plan-specific repositories are configured into the gateway infrastructure

- **Request (operator, 2026-11-10):** "repositories that are linked only to a specific plan is nevertheless tied
  intricately to the system's infrastructure. Doesn't seem like industry standards to me." Asked for a pending
  decision entry, "pending for release 0.6.1".
- **Status:** OPEN (pending decision; not started)
- **Priority / target release:** unassigned / 0.6.1 (target set by the operator, 2026-11-10)
- **Type:** decision, then a change to the gateways' design (configuration, authorization, credentials)
- **Why it matters:** ADR 0008 item 5 records that read and submissions repositories are per plan and not known
  beforehand. ADR 0012 (DX-1) closed the credential model as an operator-declared allowlist of plan repositories in
  the gateway configuration, with the operator widening the GitHub token's repository selection by hand at onboarding
  and no GitHub App. A repository that belongs to one plan is therefore held in shared gateway configuration, and
  onboarding a plan means changing that configuration and the token by hand.
- **Direction to decide (not decided):** a plan-agnostic gateway. The repository, branch and task come from the signed
  capability and are checked against an operator-managed registry held as data, not as gateway configuration.
  Credentials per repository come from a broker held by the gateway (for example a GitHub App installation), so agents
  never hold them.
- **Constraint:** release 0.6.0 keeps the ADR 0012 allowlist model; S4 and S5 verify against it. This entry changes
  nothing before 0.6.1.
- **Open questions for the operator:**
  1. Where should the registry live, and who may change it (operator console only)?
  2. ADR 0012 chose no GitHub App because many agents cannot use Apps. Does that still hold if only the gateway holds
     the App credential?
  3. Does the current capability format already carry the repository identity, or does it need a new version?
  4. How do 0.6.0 deployments migrate, and how do the S4 and S5 style gates change?
- **Related records:** ADR 0008 item 5 and open item DX-1; ADR 0012 item 5.
- **Owner:** operator decides scope and release; implementation owner not yet assigned.

### P-003 — The submissions branch and task folder are plan-specific, not infrastructure

- **Request (operator, 2026-11-10):** "the same thing goes for the branch and folder - it's tied directly to a
  specific plan - nothing to do with the build-engine infrastructure." Asked to record it "as pending for release
  0.6.1".
- **Status:** OPEN (pending decision; not started)
- **Priority / target release:** unassigned / 0.6.1 (target set by the operator, 2026-11-10)
- **Type:** decision, then a change to the write gateway's design
- **Why it matters:** the write gateway takes the submissions branch as configuration (`SUBMISSIONS_BRANCH`) and
  requires that the branch and the task-id folder already exist, because the gateway never creates them. Both belong
  to one plan, yet one is fixed in gateway configuration.
- **For 0.6.0:** a branch name and folder layout are chosen for the pilot plan and recorded with the S5 decision.
  They are plan values, not build-engine conventions.
- **Direction to decide (not decided):** branch and task folder are plan-level settings carried by the work order,
  validated by the gateway against the registry in P-002 rather than fixed in its configuration.
- **Depends on:** P-002 (same registry and authorization design).
- **Open questions for the operator:**
  1. Who creates the branch and the task-id folder, and when (plan onboarding or work-order creation)?
  2. Which naming pattern does the gateway enforce, and who owns it?
- **Related records:** ADR 0012 section 4 and its S5 condition; `gateway/write` configuration.
- **Owner:** operator decides scope and release; implementation owner not yet assigned.

## Closed entries

### P-001 — Remove all references and constraints about the host repository's visibility

- **Request (operator, 2026-10-29):** "Remove all references / constraints to the visibility of the host repository."
- **Status:** CANCELLED
- **Cancelled (operator, 2026-11-07):** the entry was **entered in error**. The work it describes is not to be
  done, and none of the inventory, the scope or the acceptance criteria below applies. The entry is kept, as
  the register's rules require, so that the record shows what was asked for and why it was not done.
- **Priority / target release:** unassigned / unassigned
- **What follows this line is the record of what was asked for on 2026-10-29.** It is kept verbatim, and it is
  **not** a work plan: the entry was cancelled, so the scope, the inventory, the acceptance criteria and the
  open questions below describe work that is not to be done.
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

## Change log

| Date | Change |
|---|---|
| 2026-10-29 | Register created with P-001 (operator request). |
| 2026-11-07 | P-001 cancelled by the operator: entered in error. The entry is kept and moved to Closed entries; nothing else changed. |
| 2026-11-10 | P-002 and P-003 added as pending decisions, target release 0.6.1 (operator request). |
