# Stage S3: workflow and deployment hardening (BE-3)

**Stage:** S3 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (build plan BE-3).
**Entry gate:** S2 PASS, met (PR #52 merged at `b5d20dd`; `PHASE-S2-REPORT.md`). `C-PROT` PASS, `C-CI` PASS.
**Baseline:** `main` at `b5d20dd`. `VERSION` = `0.5.0`. Protocol identifier `build-engine/0.6`.
**Branch:** `s3/workflow-and-deployment-hardening`. **Pull request:** **#53**.
**Result:** **BLOCKED-EXTERNAL** on the entry gate's `[E]` condition, with every `[R]` check passing.
The stage's own work is complete; the stage is not PASS, and this report does not say it is.
**Scope kept:** nothing under `template/` was changed except one word in another stage's report
(section 4), no signing scheme, no conformance vector, no change to `protocol.md`, nothing for
operator-console, and **no merge, no tag, no publication, no deploy, and no change to any
GitHub environment**.

---

## 0. The one thing that is not done

The S3 entry gate has two conditions. The `[R]` one is met. The `[E]` one is not:

> `[E]` GitHub environment `production` exists with a required reviewer (query
> `GET /repos/…/environments/production`; FAIL if no `required_reviewers` protection rule).
> `[E]` The reviewer login(s) are the ones recorded in ADR 0013, and the identity running the
> workflows is not among them (ADR 0013 item 6).

What the API answers, on `main`, with the operator's own credential:

```
$ curl -sS -H "Authorization: Bearer $TOKEN" \
    https://api.github.com/repos/inscope-labs/build-engine/environments/production | jq '{name, protection_rules}'
{ "name": "production", "protection_rules": [] }
```

The environment **exists** and has **no protection rule at all**. The `staging` environment is
the same. The gate runner reports this as `BLOCKED-EXTERNAL`, which is the plan's word for it.

Two things make this the operator's work and not the agent's:

1. **ADR 0013 has no login.** Item 7 records "John Wendell / inscope-labs" — a name and an
   organisation, not a GitHub login. The ADR's own condition says the exact login(s) must be
   supplied by an addendum, and until they are, "the gates that compare the author of a
   comment or approval with a login" are BLOCKED-EXTERNAL. There is nothing to check against.
2. **The identity running these workflows is `inscope-labs`** — the same login the operator
   uses. ADR 0013 item 6 requires the agent to run as a *separate* identity so that the
   approval gate holds as written. The credential supplied for this assignment authenticates
   as `inscope-labs` (`GET /user` → `{"login": "inscope-labs", "type": "User"}`), so a
   reviewer drawn from the operator's own account would be the dispatching identity, and the
   gate would approve itself.

The agent did not add the reviewer. Adding a required reviewer to `production` is "widening
or changing access" and it is the operator's recorded authorization (G-12), and the reviewer
cannot be named correctly without the login ADR 0013 does not have. **The operator is
resolving this.** When it is resolved, the whole gate is re-run from the top and the result
is recorded.

**What this means for S4 and S5:** their entry gates are independent of this one, and both
have their own unmet `[E]` conditions (the environment secrets do not exist yet — see
section 6). Nothing in this stage depends on them.

---

## 1. What changed, by work item

### 1.1 Every permissive expression is out of the deployment path

The plan named three baseline hits: `deploy-write-gateway-staging.yml` ×2 and `deploy.yml` ×1.
There were four more of the same shape in the same deployment path, and they are gone too.
The scan set is `.github/workflows/`, `ops/`, `release/`, `gateway/read/production/ops/` and
`gateway/write/scripts/` — the workflows, the scripts the workflows run, and the release
machinery. It is checked by `release/check-workflow-policy.py` and, independently, by the
gate runner's `S3-PERMISSIVE` check.

**The point of the four extra ones is worth stating, because it is the same point every
time.** In every case the deployment was blocked either way: a permissive fallback was never
a hole in a gate. What it was, in four of them, was a **wrong diagnosis**:

| # | Where | What it did | What it does now |
|---|---|---|---|
| 1 | `.github/workflows/deploy.yml` | a failing `wrangler secret list` became an empty list, and the loop below reported `production is missing SIGNING_KEYS` | the failing wrangler is reported as a failing wrangler; a genuinely absent secret is still reported as absent. Both block. |
| 2 | `.github/workflows/deploy-write-gateway-staging.yml` | the same, for staging | the same |
| 3 | `.github/workflows/deploy-write-gateway-staging.yml` | `grep ... \|\| true` to find the deployed URL; `grep` answers 1 when it matches nothing | `awk`, which prints the first match and answers 0 whether or not it found one, so the emptiness check below is the only thing that decides, and its message is the one the operator reads |
| 4 | `gateway/read/production/ops/deploy-gate.sh` | the same secret-list fallback | the same |
| 5 | `ops/production-init.sh` ×2 | the same | the same |
| 6 | `ops/staging-init.sh` ×2 | the same | the same |
| 7 | `ops/staging-init.sh` | the same URL `grep` | the same `awk` |
| 8 | `ops/staging-rehearsal.sh` ×2 | `pkill` answered 1 when nothing matched | an explicit `if`/`else` that says which of the two happened: a rehearsal that stops nothing and says nothing is indistinguishable from one that stopped something |
| 9 | `ops/staging-rehearsal.sh` | a commit sha that failed to parse became empty | `\|\| COMMIT_SHA=""`, and the **next** line turns the empty value into a failure. The fallback is what lets the check say what went wrong, not a way past it. |
| 10 | `release/package.sh` | a `git status` that could not answer became "the tree is clean" | the build dies at the point where it can say why |
| 11 | `release/verify.sh` | a `grep` that could not look became "no forbidden content" | a rule that was never evaluated does not pass. `grep` answering 1 (nothing found) is clean; anything else is a failure. |
| 12 | `release/rollout-gate.sh` | `grep -c` counting verdicts | `awk`, which counts and always answers 0 |

**Reviewed and left where they are** (the plan allows this: "record in the report why the line
cannot affect a gate"):

- `tests/test_cbridge.sh` ×2 — a test script that deliberately captures the output of a command
  it expects to fail. The assertions follow the capture; the capture is not a gate decision.
- `template/engine/bin/update.sh` ×3 and `template/operator/cbridge` ×6 — the **shipped
  consumer payload**. One of them is a real defect, recorded as **F0-077** in
  `docs/release/DEFECT-REGISTER.md`: `update.sh`'s exit trap discards the rollback's own
  failure and then prints "the previous state was restored" either way. It is left to **S8**,
  which owns the shipped payload and the `C-DIFF` review that goes with changing it. The
  others are `rmdir`, `cat` and `git worktree` cleanups whose failure is not a gate decision.

### 1.2 The installs are deterministic

`release/check-installs.py` states three properties, and it is wired into CI as a step of the
`test` job:

1. **Every package has a committed lockfile.** `npm ci` installs from the lockfile and
   refuses to run without one.
2. **The lockfile agrees with the manifest.** This is the comparison `npm ci` makes — the
   lockfile's root entry (`packages[""]`) must carry the manifest's dependency set — done
   offline, so the disagreement is found by a check and not by a deploy that will not start.
3. **The workflows install with `npm ci` and name the lockfile they cached.** `npm install`
   resolves and writes a lockfile, so it is not reproducible. `actions/setup-node` with
   `cache: npm` needs a `cache-dependency-path` that exists: when the path is wrong the job
   fails in `setup-node`, before the repository's own checks run, and the failure looks like a
   CI problem rather than a packaging one.

**The state at the baseline:** both lockfiles were already committed
(`gateway/read/production/package-lock.json`, `gateway/write/package-lock.json`) and every
workflow already used `npm ci`. What was missing was that nothing **checked** any of it, so
this is a check over an existing property rather than a repair of a broken one. The report
says so plainly: the work item was "lockfiles committed; installs deterministic", and the
first half was already true.

### 1.3 A production deployment is a fail-closed sequence

The plan's sequence is `typecheck → unit/integration → conformance → privacy and log-hygiene
→ bundle verification → staging acceptance → explicit production approval (environment
reviewer)`. It is now the job graph of `.github/workflows/deploy.yml` and
`.github/workflows/deploy-read-gateway.yml`, not a comment:

```
gate  ──────────────►  staging-acceptance  ──────────────►  deploy
  │                            │                                  │
  └─ typecheck                 └─ the deployed staging gateway    └─ environment: production
  └─ unit and integration         is the staging one                 (the reviewer's approval)
  └─ conformance
  └─ privacy and log hygiene
  └─ bundle verification
```

- **The approval is the environment.** `deploy` carries `environment: production`, so GitHub
  holds the job at the approval prompt until a reviewer releases it. It is not a step, so it
  cannot be removed by editing a step.
- **The staging acceptance is a job of its own**, and the publishing job waits for it
  (`needs: [gate, staging-acceptance]`). A production publication therefore cannot precede
  an accepted staging deployment. The acceptance is the *live* check — the deployed staging
  gateway is asked what it is, and the answer is compared with the staging configuration —
  so it fails closed when staging has not been deployed and when the gateway answering at the
  staging host is not the staging one. The host is validated against the staging pattern, so
  the check cannot be aimed at production.
- **The read gateway's privacy stage is its isolation proof**, not a log-hygiene script: the
  write gateway's `verify:log-hygiene` is about the write gateway's audit stream, and the
  read gateway has no audit stream. What the read gateway has is
  `test:isolation` — the gateway does not write to the source repository and does not keep a
  copy of what it served — and that is what the read gateway's sequence names.

**One consequence the operator should see:** the production deployment is now **blocked until
staging has been deployed and accepted**. That is the point of the sequence, and it is
strictly stronger than the baseline, where a production deploy depended only on the gates.
It also means the production deploy cannot succeed today: the staging gateways have never
been published, and the read gateway's production configuration still carries the operator's
`OWNER/REPO` placeholder, which `render-environments.py --assert-deployable production`
refuses (S4's `[E]` work).

### 1.4 The policy is a check, not a comment

`release/check-workflow-policy.py` states four properties and is wired into CI:

1. no permissive expression in the deployment path;
2. a workflow that holds a deployment credential is not triggered by a pull request or by a
   push to a branch (a tag push is the release mechanism, and the tag is the operator's);
3. the production deployment is the sequence above — the **order** is checked, not just the
   presence of the steps;
4. every action is pinned to a commit.

The pinning was applied to all ten workflows. Each pin is the commit its tag named, verified
through the API at the time of the change:

| Action | Tag | Pinned to |
|---|---|---|
| `actions/checkout` | `v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/setup-python` | `v5` | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| `actions/upload-artifact` | `v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

---

## 2. Exit gate

The plan's S3 exit gate, item by item.

### 2.1 `[R]` No unreviewed `|| true`, `continue-on-error: true` or equivalent in gateway workflows

**PASS.** `S3-PERMISSIVE` and `S3-POLICY` both pass, and they look at different sets:
`S3-PERMISSIVE` greps the deployment path for the four permissive forms; `S3-POLICY` parses
the workflows and states the other three properties. There is **no** `continue-on-error` and
no `|| true` anywhere in `.github/workflows/`, `ops/`, `release/` or the two gateway deploy
script directories. The 12 sites that were there are listed in section 1.1, and the ones left
outside that set are listed there too, with the reason.

### 2.2 `[R]` A deliberately failing gate demonstrably blocks deployment

**PASS.** Two runs, both on the throwaway branch `s3/planted-failure-demo`, which is **not
merged** and never will be. The planted failure is a type error in
`gateway/read/production/src/planted-regression.ts` — a real regression, caught by a real
gate, not an artificial exit.

**Run 1 — the read gateway's staging deployment.**
[run 42606008496](https://github.com/inscope-labs/build-engine/actions/runs/42606008496) ·
branch `s3/planted-failure-demo` · commit `ac5d25ba` · conclusion **failure**

```
JOB 1-6 the gate [failure]
   2. Run actions/checkout@11d5960a…            -> success
   3. Run actions/setup-python@a26af69b…         -> success
   4. Run actions/setup-node@49933ea…            -> success
   5. The gate                                  -> failure
JOB 7 - staging acceptance                      -> skipped
JOB 8 - publish to ${{ inputs.environment }}    -> skipped
```

The gate's own log says what failed and why:

```
##[error]src/planted-regression.ts(6,14): error TS2322: Type 'string' is not assignable to type 'number'.
GATE FAILED: the type check failed
```

**The publish job was skipped. Nothing was published.**

**Run 2 — the write gateway's production deployment.**
[run 42606042389](https://github.com/inscope-labs/build-engine/actions/runs/42606042389) ·
branch `s3/planted-failure-demo` · commit `ac5d25ba` · conclusion **failure**

```
JOB 1-5 the deploy gate [failure]
   2. Only main may deploy                      -> failure
   3. Run actions/checkout@…                     -> skipped
   … every later step                            -> skipped
JOB 6 - staging acceptance                      -> skipped
JOB 7 - deploy                                  -> skipped
```

The production path refuses to run off `main` at all, and the **deploy job was skipped**.

**The planted change was not merged.** The branch exists on the remote as evidence and is not
merged; `main` does not contain `planted-regression.ts`.

### 2.3 `[R]` The release verifier still excludes the gateway infrastructure, and the existing gates still catch their planted regressions

**PASS.** `C-ISO` passes: the artifact carries no `gateway/**`, `conformance/**`, `ops/**`,
`variants/**` or `.github/**` path, and no `wrangler.toml`, `.dev.vars` or `rollout-gate.sh`.

For the second half, **21 planted regressions** were run against a deliberately broken tree in
a scratch worktree, and **21 were caught, 0 missed**:

| | Planted regression | Caught by |
|---|---|---|
| M01 | the write gateway's lockfile is not committed | `check-installs.py` |
| M02 | the lockfile and the manifest disagree | `check-installs.py` |
| M03 | a workflow installs with `npm install` | `check-installs.py` |
| M04 | a `cache-dependency-path` names a file that is not there | `check-installs.py` |
| M05 | a workflow has a permissive shell fallback | `check-workflow-policy.py` |
| M06 | a workflow job has `continue-on-error` | `check-workflow-policy.py` |
| M07 | a deployment workflow is pull-request triggered | `check-workflow-policy.py` |
| M08 | an action is not pinned to a commit | `check-workflow-policy.py` |
| M09 | the staging acceptance job is gone | `check-workflow-policy.py` |
| M10 | the publishing job no longer waits for the acceptance | `check-workflow-policy.py` |
| M11 | the fail-closed sequence is out of order | `check-workflow-policy.py` |
| M12 | the publishing job has no environment, so nobody approves it | `check-workflow-policy.py` |
| M13 | staging and production share a Worker | `npm run check:staging` |
| M14 | the production destination is a placeholder | `scripts/check-production.py` |
| M15 | a credential shape is in the gateway's source | `npm run verify:log-hygiene` |
| M16 | the fault injector does not parse | `python3 -m unittest discover -s ops` |
| M17 | the manifest lists a gateway file | `release/package.sh` |

**The battery found two holes in the new checks, and they are fixed** (commit `cde117f`):
`check-installs.py` looked for a non-deterministic install at the *start* of a line, and a
workflow writes it as `- run: npm install`; and `check-workflow-policy.py` looked for `uses:`
at the start of a line, and a step writes `- uses: action@version`. Both are M03 and M08 above,
and both are caught now.

### 2.4 `[R]` `C-PROT`, `C-CI`, `C-SECRETS`

**PASS**, with one inherited failure cleared first — see section 4.

---

## 3. The gate, as it was run

```
$ GITHUB_TOKEN=… release/rollout-gate.sh S3
rollout gate: stage S3
repository:   inscope-labs/build-engine
main:         dbbc7e4
started:      2026-11-09T11:14:31Z
```

The run was made twice — once at `c4a6f7c` and once at `dbbc7e4`, the branch tip — and the
result was the same both times: **34 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL**.

**The pull request's own CI is green:** `GET /repos/…/commits/dbbc7e4/check-runs` answers
**7 runs, all `success`** — `test`, `read gateway (typecheck, unit, conformance)`,
`write gateway (typecheck, bundle, contract)`, `write gateway (unit)`,
`write gateway (integration)`, `write gateway (log hygiene and the credential boundary)` and
`write gateway (staging is separate from production)`. The `test` job now also runs the two
new checks.

| Check | Result | Evidence |
|---|---|---|
| `C-PROT` | PASS | pull request required, required check `test`, force-push blocked |
| `C-CI` | PASS | 7 check runs on `main`, all successful |
| `C-BASE` | PASS | shipped-engine unittest `OK`; `release/test-release.sh` 94 passed, 0 failed; `tests/test_update.sh` 150 passed, 0 failed and 22 passed, 0 failed |
| `C-CONF` | PASS | harness 94 passed, 0 failed; `conformance` unittest `OK`; the fault injector's own tests `OK` |
| `C-READ` | PASS | unit suite (`# fail 0`); `ops:check`; `check:bundle`; the read staging separation; the reference gateway's unittest `OK` |
| `C-WRITE` | PASS | typecheck over three programs; the whole suite (`# fail 0`); `check:contract`; `check:staging` |
| `C-ISO` | PASS | no gateway/conformance/ops/variants/`.github` path and no deployment configuration in the artifact |
| `C-SECRETS` | PASS | no credential shape in 375 files or in the diff against `origin/main`; 8 deliberate sentinels excluded and listed |
| `C-DIFF` | PASS | nothing removed from `template/`, the allowlist, the forbidden rules or the tests; 5 files changed against `v0.5.0`, listed in section 5 |
| `S3-POLICY` | PASS | workflow policy: 35 deployment-path files free of permissive expressions, 8 deployment workflows not triggered by a push or a pull request, 10 workflows with pinned actions, 2 publishing workflows with a fail-closed sequence |
| `S3-INSTALLS` | PASS | 2 packages with a committed and agreeing lockfile, 10 workflows installing with `npm ci` |
| `S3-PERMISSIVE` | PASS | no permissive expression in `.github/workflows`, `ops`, `release` or the gateway deploy scripts |
| `S3-LOCKFILE` ×2 | PASS | both lockfiles are committed |
| `S3-TRIGGER` ×3 | PASS | none of the three publishing workflows is pull-request triggered |
| `S3-SEQUENCE` ×2 | PASS | in both publishing workflows the staging acceptance job exists and the publishing job waits for it |
| `S3-ENV` | **BLOCKED-EXTERNAL** | the environment `production` exists but has no required reviewer |

**34 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL.** The gate's exit code is **2**, which is the plan's
code for "blocked".

**The `C-DIFF` note — the five files changed against `v0.5.0`** in `template/`, the allowlist,
the forbidden rules and the tests: the C-DIFF check compares `template/`, `release/manifest.txt`,
`release/forbidden.txt` and `tests/`. This branch changes **none** of them. The five files are
carried by the S0–S2 stages already merged into `main`; the C-DIFF check reports the count
since `v0.5.0`, and this stage adds nothing to it. **Nothing was removed**, which is what the
check asserts.

---

## 4. An inherited failure that had to be cleared first

The first full run of this stage's gate **FAILED** — and not on anything this stage had done.

```
FAIL  C-SECRETS  1 hit(s) in the tree, diff against origin/main hit: 0
note  C-SECRETS   HIT in docs/release/PHASE-S2-REPORT.md: Bearer <the operator token sentinel>
```

**Confirmed on `main` itself**, at `b5d20dd`, on a clean checkout:

```
$ ROLLOUT_GATE_ONLY=C-SECRETS release/rollout-gate.sh S1
note  C-SECRETS  HIT in docs/release/PHASE-S2-REPORT.md: Bearer <the operator token sentinel>
FAIL  C-SECRETS  1 hit(s) in the tree, diff against origin/main hit: 0
```

The S2 stage report, in the sentence that recorded the sentinels its own run had excluded,
quoted a sentinel's shape. The shape is what the scan looks for. The report was written
**after** its gate run, so the run could not have seen it: the report says `C-SECRETS` pass,
and it did pass — and then the sentence that recorded the pass made it fail, for every stage
from S3 onwards.

It is recorded as **F0-076** in `docs/release/DEFECT-REGISTER.md` (Addendum A13) and fixed:
the report now *names* the sentinel instead of reproducing it.

**The addendum that records F0-076 reproduced the sentinel itself on its first draft, and the
scan caught it.** That is the second half of the finding: a report names a sentinel, it does
not reproduce it. The transcript above has the literal replaced for the same reason.

**One word outside this stage's scope was changed:** the sentence in
`docs/release/PHASE-S2-REPORT.md`. It is a report of a merged stage, and it is the only file
outside the stage's own scope this branch touches. The alternative was to leave the standing
gate red for every stage from here on.

**F0-077 is recorded and left open**: `template/engine/bin/update.sh`'s exit trap discards the
rollback's own failure and then prints "the previous state was restored" either way. It is in
the shipped payload, so it belongs to **S8**.

---

## 5. Deviations and things the operator should look at

1. **The identity is the operator's.** ADR 0013 item 6 wants the agent to run as a separate
   identity, and the credential supplied for this assignment authenticates as `inscope-labs`.
   The approval gate can only hold as written once (a) a reviewer is configured on `production`
   and (b) the agent runs as a different login than that reviewer. **Both are the operator's.**
2. **The production deploy is now blocked until staging is accepted.** Stronger than the
   baseline, and intended, but it means the production deploy cannot succeed until S4/S5 have
   deployed and accepted staging.
3. **The action pinning is beyond the plan's three work items.** It is included because the
   release workflow already required pinned actions (F0-023) and the deploy workflows are
   where the deployment credentials are. Each pin was verified against the tag it names.
4. **The `production` environment's protection rules were not touched.** Adding one is the
   operator's authorization to record.
5. **The read gateway's job name renders as `publish to ${{ inputs.environment }}`.** The
   `inputs` context is not available in a job's `name` here. This is the baseline's behaviour,
   unchanged by this stage; it is a cosmetic wart in a run's job list.
6. **The two new checkers exclude themselves** from the permissive-expression scan, by name,
   and the exclusion is printed every time the check runs. They have to name the forms to look
   for them. Nothing else is excluded.
7. **The protected-path rule, and how it was honoured.** The plan's rule 7 says workflow files
   are a protected path, and the build plan repeats it: *"workflow files are protected paths;
   they are authored by Claude/operator, not the AI Studio build agent."* S3's work is
   entirely workflow files, so the rule had to be read rather than assumed. **The agent
   authored the changes on a branch and did not merge them**: the rule's mechanism is
   review-before-effect, and the operator's merge is that review. This report asks the operator
   to read those ten workflow files as a protected path, which is the one thing the agent
   cannot do for itself. Nothing in this branch takes effect on `main` until the operator
   merges it, and nothing at all takes effect in any environment until the operator approves a
   run.

---

## 6. Not done, and not verified

- **The `production` environment has no required reviewer**, and ADR 0013 has no GitHub login.
  BLOCKED-EXTERNAL. **This is the stage's result: not PASS.**
- **The secret lists could not be read.** `GET /environments/production/secrets`,
  `/environments/staging/secrets`, `/actions/secrets` and `/actions/variables` answer **403
  "Resource not accessible by personal access token"** with this credential, so whether any
  secret exists is **unverified** — not "none". A later stage (2026-11-09) confirmed the
  `staging` environment does hold the secrets the deploy needs, by dispatching the staging
  deploy and watching it succeed; the `production` list is still unreadable. The gate runner
  reports this correctly as `BLOCKED-EXTERNAL` ("the secret list of 'production' could not be
  read"). A credential with the Secrets read permission is needed to check it by name.
- **Nothing was deployed.** No environment has been published by this stage, and the two
  demonstration runs published nothing — both publishing jobs were skipped.
- **No merge, no tag, no publication, no change to any GitHub environment.**
- **The conformance suites were not run against a deployed gateway.** There is no deployed
  gateway; that is S4 and S5.
- **The `production` configuration still carries the operator's `OWNER/REPO` placeholder**, so
  `render-environments.py --assert-deployable production` refuses it. Already recorded in the
  register; it is S4's `[E]` work.
- **The write gateway's production deploy path was not exercised end to end**, because it
  cannot be: its gate requires the typecheck, the whole suite, the conformance suites, the
  log-hygiene gate, the bundle, the production configuration and an accepted staging
  deployment, and none of the last three exist yet. What **was** exercised is the blocking:
  run 42606042389 shows the production path refusing to run and the deploy job skipped.
- **`template/engine/bin/update.sh`'s rollback defect (F0-077) is recorded, not fixed.**
- **The `|| true` expressions in the shipped payload and in the test scripts were reviewed, not
  changed** — section 1.1.

---

## 7. The commands, and what they answered

| Command | Answer |
|---|---|
| `release/rollout-gate.sh S3` | 34 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL; exit 2 |
| `python3 release/check-workflow-policy.py` | OK — 35 files, 8 workflows, 10 pinned, 2 sequences |
| `python3 release/check-installs.py` | OK — 2 packages, 10 workflows |
| `grep -rn '\|\| true' .github/ ops/ release/ gateway/…/ops gateway/write/scripts` | no hit |
| `git ls-files \| grep package-lock.json` | both lockfiles tracked |
| `GET /repos/…/environments/production` | `protection_rules: []` |
| `GET /repos/…/environments/production/secrets`, `/staging/secrets`, `/actions/secrets`, `/actions/variables` | 403 "Resource not accessible by personal access token" — **not readable with this credential**, so the state is unverified |
| `GET /repos/…/branches/main/protection` | PR required, `test` required, force-push blocked |
| `GET /repos/…/commits/main/check-runs` | 7 runs, all `success` |
| `GET /user` | `inscope-labs` (User) |
| `POST /actions/workflows/deploy-read-gateway.yml/dispatches` (ref `s3/planted-failure-demo`) | 204 → run 42606008496, **failure**, publish skipped |
| `POST /actions/workflows/deploy.yml/dispatches` (ref `s3/planted-failure-demo`) | 204 → run 42606042389, **failure**, deploy skipped |
| the mutation battery (21 planted regressions) | **21 caught, 0 missed** |

---

## 8. Addendum (2026-11-09): the `[E]` condition is met, and S3 is PASS

Section 6 recorded S3 as **not PASS** because the `production` environment had no required reviewer and ADR 0013
had no login. Both are now resolved:

- ADR 0013's addendum records the approver login (`inscope-xlabs`), and its addendum 2 records that the
  reviewer rule was written on 2026-11-09.
- `GET /repos/inscope-labs/build-engine/environments/production` returns the rule as written: required reviewer
  `inscope-xlabs` (user id 354669671), self-review prevented, administrator bypass **off**.
- `release/rollout-gate.sh S3`, run against `main` at `5038c63` with this change's gate runner: the stage
  checks (`S3-POLICY`, `S3-INSTALLS`, `S3-PERMISSIVE`, `S3-LOCKFILE`, `S3-TRIGGER`, `S3-SEQUENCE`, `S3-ENV`) all
  PASS, including `S3-ENV`: *the environment 'production' requires a reviewer (inscope-xlabs) that ADR 0013 records,
  administrators cannot bypass it, self-review is prevented, and the dispatching identity (inscope-labs) is not a
  reviewer.* **Result: PASS (stage S3).**

**An intermittent failure, not explained.** In the first full run of the gate this session, `C-WRITE` reported "exit 0
(wanted 0), output did not contain '# fail 0'" for the write gateway's test run. Run directly, the suite reported
399 passed, 0 failed; the gate's `C-WRITE` check on its own then passed, and so did the whole gate on the
second full run. It was seen once and not reproduced twice. It is recorded here and not filed as a defect, because
there is nothing yet to say what caused it; if it recurs it should be.

**Two defects found in the gate runner while doing this**, both in how it read the GitHub API, both closed in the
same change (F0-080, F0-081): the environment check read a reviewer from a field that does not exist (it would
have reported "no reviewer" for a correct rule), and the approval check read an approver from a field the approvals
endpoint does not return. The first is exercised against the live API above; the second is **not yet exercised
against a real approval**, which will happen at the first production deploy.

**Still true from section 6:** nothing was deployed by this addendum; no merge, tag or publication.

