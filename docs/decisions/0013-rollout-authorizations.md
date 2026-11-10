# 0013: authorizations for the v0.6.0 rollout plan

Status: **decided** (2026-11-08); the identity conditions are met (2026-11-09); the token-revocation condition stands

Adopts `docs/release/V0.6.0-ROLLOUT-PLAN.md` and records the operator's authorizations for its execution. Closes the S0 review of the three BE-0 documents.

## Question
What may the executing agent do while running the plan, who authorizes and approves, and are the three BE-0 documents approved?

## Decision
1. **Plan adopted (1.1).** `V0.6.0-ROLLOUT-PLAN.md` is the governing plan for 0.6.0, to be merged by the operator.
2. **Repository actions (1.2).** The agent works on branches and opens pull requests. It never merges, never pushes to `main`, and never tags or publishes before the S9 authorization (G-12).
3. **Deploy workflows (1.3).** The agent may dispatch the staging and production workflows and then waits. The environment reviewer approves each production run in GitHub; the agent never approves its own deploy.
4. **Secrets (1.4).** The agent checks secrets by name only. It never reads, prints, copies or stores a value. A missing secret is reported as BLOCKED-EXTERNAL.
5. **Session token (1.5).** The operator will revoke the token pasted into the earlier chat **at the end of this assignment**, not before. Until then the exposure is an accepted risk, recorded in the S0 report.
6. **Agent identity (1.6).** The agent runs as a separate identity from the operator, so the plan's approval gate holds as written: the approver must not be the dispatching identity.
7. **Authorizer and approver (1.7).** Stated as "John Wendell / inscope-labs".
8. **S9 authorization (1.8).** A comment by the authorizing login on the release PR reading `authorize v0.6.0 at <full commit SHA>`. The agent verifies author, version, and that the SHA equals the tip of `main`.
9. **BE-0 documents (5.1).** `COMPATIBILITY-MATRIX.md`, `CAPABILITY-CONFORMANCE.md` and `CBRIDGE-COVERAGE-MATRIX.md` are reviewed and approved with the answers in ADRs 0010 to 0012. Their "DRAFT" status is removed.

## Conditions
- **Login.** Met — see the addendum of 2026-11-09 below. The approver's login is named there, on the line the release gate reads.
- **Separate identity.** Met — see the addendum below. The session credential authenticates as a login that is not the approver's, so the plan's approval gate holds as written.
- **Token revocation.** Still stands. Item 5 means a credential exposed in chat stays valid during the assignment. The replacement session credential, if any, must be fine-grained and limited to `inscope-labs/build-engine`. The operator revokes the exposed token at the end of this assignment.

## Rationale
Records the operator's answers to the S0 questionnaire.

## Consequences
- The rollout plan's S0 exit gate checks ADRs 0010 to 0013 for status `decided` (the repository's own status word).
- The plan's S9 authorization mechanism is the one in item 8.

## Blocks resolved
S0 exit gate items: plan adoption, authorization records, BE-0 document review.

## Operator authorization
Recorded from the operator's completed S0 decisions questionnaire, uploaded 2026-11-08. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1.1 to 1.4, 1.6, 1.8 and 5.1 were answered with the defaults (A). Statement 1.5 was answered B. Statement 1.7 was answered "John Wendell / inscope-labs".

## Addendum (2026-11-09)
Recorded from the operator's completed S4 unblock questionnaire, uploaded 2026-11-09. This addendum supplies the identity details the conditions above required, and records the authorizations for the production half of S4. It does not change items 1.1 to 1.9 above.

### Identity
- **Login.** `inscope-xlabs`
- The approver of the production environment is the login named on the line above. It is distinct from the login the agent dispatches workflows as, so the approval gate in item 3 holds: the agent never approves its own deploy.
- The login is also the identity recorded for the S9 authorization comment in item 8.

### Production read repository
The production read gateway's repository is `acme-pilot-dev`, as ADR 0012 records it, with the allowlist `amk/,plans/*/package/`. The committed configuration carried the placeholder `OWNER/REPO`; it now carries these values, and `gateway/read/production/wrangler.toml` is re-rendered from them.

### Authorizations granted
The operator authorizes the agent to do each of the following, and no more than these:

1. **Write the production environment's required-reviewer protection rule**, naming the approver recorded above.
2. **Write this addendum** — the approver's login and these authorizations. (Done, in this section.)
3. **Edit the committed production configuration** (`GITHUB_REPO`, `ALLOW_PREFIXES`) and re-render `gateway/read/production/wrangler.toml`. (Done.)
4. **Dispatch `production-init` and the production deploy, and record the approval** the environment reviewer gives.

Each authorization was granted explicitly in the questionnaire; none was inferred. The agent does not merge, does not tag or publish, does not approve its own deploy, and does not widen access beyond the protection rule named above. Item 1.4 still holds: the agent checks secrets by name only, and never reads, prints, copies or stores a value.

### Session credential scope
The operator grants the session credential the Secrets (read) and Environments (read/write) permissions on this repository, so the release gate can list the production environment's secret and variable *names*. A credential that cannot list them leaves the secret-list check BLOCKED-EXTERNAL and is reported as such; it is not a failure of the deployment, which cannot succeed without its secrets.

### Reading the approver's login
The release gate reads the approver's login from this ADR by matching the line that begins `**Login.**` followed by a backticked GitHub login. This convention is deliberate: the line carries exactly one backticked token, so no other word in the ADR can be mistaken for a login.

## Addendum 2 (2026-11-09): the production reviewer rule is written

The operator answered "Yes" on 2026-11-09 to the agent writing the production environment's required-reviewer
rule, with self-review prevented and administrator bypass turned off. The first is authorization 1 of the
addendum above; the other two settings were put to the operator in the same question and approved in the same
answer.

**What was written, through the GitHub API, with the operator's credential:**

| Setting on the `production` environment | Value |
|---|---|
| required reviewer | `inscope-xlabs` (user id 354669671), the login the addendum above records |
| prevent self-review | on |
| administrators can bypass | **off** (it was on) |
| wait timer | none |
| deployment branch policy | none (unchanged) |

The `staging` environment was **not** changed.

**What it does.** A production deployment cannot proceed until `inscope-xlabs` approves it. That account is a
different identity from `inscope-labs`, the login the agent dispatches workflows as, so the agent never approves
its own deploy (item 3, and item 6 as amended by the addendum above). With administrator bypass off, the owner
account cannot skip the approval either.

**Checked.** `GET /repos/inscope-labs/build-engine/environments/production` returns the rule as written, and the
release gate's `S3-ENV` check passes against it (see `PHASE-S3-REPORT.md` section 8).

**Not changed, and still open.**
- The approver's login is recorded as `inscope-xlabs` for both the production approval and the S9 authorization
  comment (item 8). If the operator wants `inscope-labs` to post the S9 authorization instead, this ADR needs a
  further addendum; the gates read what the ADR records.
- No deployment branch policy was set. A production deployment can be dispatched from any branch the workflow
  allows; the workflows themselves refuse to publish from anything but `main`, and the operator may add a branch
  policy of `main` to the environment as well.

