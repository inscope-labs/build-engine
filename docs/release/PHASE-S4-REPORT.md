# Stage S4: read gateway — staging acceptance and production (BE-4)

**Stage:** S4 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (build plan BE-4).
**Entry gate:** S3's `[R]` work is on `main` (PR #53 merged as `83e15e15`; `PHASE-S3-REPORT.md`).
**Baseline:** `main` at `83e15e15` when this stage opened; **PR #54 is merged** (`608155f`).
**VERSION** = `0.5.0`.
**Branch:** `s4/read-gateway-staging-acceptance` (PR **#54**, merged). The production half and
the deployed proof's fix are together on `s4/production-authorization` (PR **#55**).
**Result:** **the staging half is done and verified. The production half is authorized and its
changes are in review; it is still blocked on the operator for two things** — the second
approver account and the production environment's values (section 7).
`release/rollout-gate.sh S4` → **26 PASS, 0 FAIL, 4 BLOCKED-EXTERNAL** (exit 2) before the
operator's answers; see section 7 for the state after them.

> **Section 7 is an addendum**, written on 2026-11-09 after the operator answered S4's unblock
> questionnaire. Sections 0 to 6 are the stage as it was delivered; section 7 supersedes them
> where it says so.
**The read gateway is published.** `https://ctxgate-read-staging.qnuralink.workers.dev` answers,
serves the staging key id `s1`, and refuses what it must.
**Scope kept:** no merge, no tag, no publication, no production deploy, and **no change to any
GitHub environment, protection rule or secret**. The only deployment this stage performed is
the **staging** one the plan asks for, on the disposable environment.

---

## 0. What is blocked, and on whom

S4's entry gate names four `[E]` conditions. Two are met; **two are not, and both are the
operator's**.

| `[E]` condition | State | Evidence |
|---|---|---|
| the environment secrets for the read gateway exist for `staging` and `production` | **staging: met** (the deploy succeeded, which is only possible if the staging Worker holds `SIGNING_KEYS`, `OPERATOR_TOKEN` and `GITHUB_TOKEN`, and if `CTXGATE_BASE_URL` is set). **production: unverifiable** | the deploy run's publish job passed the secret check and the deploy |
| the production `GITHUB_REPO` is not a placeholder | **not met** — `OWNER/REPO` | `ops/environments.json` lines 36 and 128; `render-environments.py --assert-deployable production` answers *"GITHUB_REPO is still a placeholder: OWNER/REPO"* and exits 1 |
| the hostnames are ADR 0012's, the production read repository is `acme-pilot-dev`, the allowlist model is DX-1, the Cloudflare plan is Paid | **hostname: met** (ADR 0012 records `ctxgate-read.qnuralink.workers.dev`; the deployed staging host is `ctxgate-read-staging.qnuralink.workers.dev`). **the rest: not verifiable** | ADR 0012 items 3 and DX-1; the Cloudflare account and its plan tier are the operator's |
| S3 PASS | **not met** — `production` has `protection_rules: []` | `GET /environments/production` |

**And the credential cannot read the secret lists at all.** `GET /environments/production/secrets`,
`/environments/staging/secrets`, `/actions/secrets` and `/actions/variables` all answer **403
"Resource not accessible by personal access token"**. So whether the production environment has
its secrets is **unverified, not "none"** — and the gate runner says exactly that
("the secret list of 'production' could not be read"). A credential with the Secrets read
permission is needed to check that by name. *(This corrects a claim in the S3 report, which
read the same 403 as an empty list. The correction is in `PHASE-S3-REPORT.md` §6 and §7.)*

**What the agent did not do, and why:**

- **It did not dispatch the production deploy.** ADR 0008 requires an explicit operator approval
  for every production deployment, and `production` has **no required reviewer** — so a
  production run would have auto-approved itself and published without a human. That is exactly
  the failure the plan's approval gate exists to prevent.
- **It did not add the reviewer.** Adding a required reviewer is the operator's authorization to
  record (G-12), and the reviewer cannot be named correctly without the login ADR 0013 does not
  have.
- **It did not write `acme-pilot-dev` into the configuration.** ADR 0012 records that repository,
  but the configuration is the operator's to set, and the production environment that would use
  it has no credentials yet.

---

## 1. What was done

### 1.1 The staging deployment, and the deployed evidence

**The staging deploy was dispatched and it succeeded.**
[run 42660470167](https://github.com/inscope-labs/build-engine/actions/runs/42660470167) ·
`workflow_dispatch` · ref `main` · commit `83e15e15` · deployment `7660949696` (environment
`staging`) · **conclusion: success**.

| Job | Result |
|---|---|
| `1-6 the gate` | **success** — the whole read-gateway deploy gate |
| `7 - staging acceptance` | **success** — the static separation gate; the live step is correctly skipped for a staging publication, because *this* deployment is the staging acceptance |
| `8 - publish to staging` | **success** — the gate ran again with `--deploy`, the Worker was published, and `verify-deployment.py` checked the published gateway against the configuration |

**The archived run log is the conformance evidence the exit gate asks for.** The gate job's log
holds:

```
58 passed, 0 failed
[conformance] PASSED: the production gateway passes the conformance suite
[local]      PASSED: the abuse controls hold
[staging]    PASSED: the gateway behaves as a deployed service
[staging]    PASSED: the gateway is read-only and keeps no copy of what it served
== THE GATE PASSED. Nothing was published. ==
```

**58 cases, 0 failures** — the plan's expected count for the Worker conformance suite. The same
gate was also run locally, against the same commit: `bash ops/deploy-gate.sh --env staging`
→ **exit 0**, "THE GATE PASSED. Nothing was published."

**The published gateway answers, and it is the staging one:**

```
$ curl -sS https://ctxgate-read-staging.qnuralink.workers.dev/healthz
{"status":"ok","version":"0.5.0","scheme":"ctxgate-v1","clock_skew_tolerance":120,
 "max_ttl":259200,"max_bytes":1048576,"key_ids":["s1"],"conformance_clock":false}
```

`key_ids: ["s1"]` is the **staging** key id — the production key id is `p1`, and the two are
disjoint — and `conformance_clock: false` says the published gateway is not the test build.
The **production** host `ctxgate-read.qnuralink.workers.dev` answers **404**, so production is
correctly not deployed.

### 1.2 The deployed gateway refuses what it must

The repository's own deployed-probe harness, `ops/staging-pilot.py --probes-only`, now takes
`--only`, so a stage that owns one gateway can prove that half (the write gateway is S5's and
is not deployed). **7 checks, all passing, against the published gateway:**

```
ok   the read gateway at https://ctxgate-read-staging.qnuralink.workers.dev is reachable
ok   the read gateway answers (200)        scheme ctxgate-v1, key ids ['s1']
ok   the separation gate passes for the read gateway
ok   a link with a bad signature is refused (403)
ok   a link with an unknown order is refused (403)
ok   the read audit channel refuses an unauthenticated caller (401)
ok   the read revocation channel refuses an unauthenticated caller (401)
THE PROBES PASSED (7 checks)
```

The separation gate is the **live** one: `check-staging-separation.py --kind read --base-url …`
asks the published gateway what it is and compares the answer with the committed configuration.

### 1.3 The privacy scan over the captured logs

The exit gate's last item asks that the read gateway's log capture hold no signature, URL
secret, content or credential. The archived run log (43,518 bytes) was scanned for eight
shapes:

| Shape | Hits |
|---|---|
| a signed capability URL | none |
| a capability path (`/v1/{kid}/{exp}/{order}/{ref}/{sig}/…`) | none |
| a `Bearer` literal | none |
| a GitHub token shape | none |
| a fine-grained PAT shape | none |
| a private key header | none |
| the fixture's file content | none |
| a signing secret shape | none |

**0 hits.** This is the capture this stage has; the platform's own Worker logs are the
operator's to export, and they are not reachable from here.

### 1.4 The compatibility-date review — R0-008's open half

S4's first work item. **The review is written; nothing has been applied.** It is
`docs/release/COMPATIBILITY-DATE-REVIEW.md`, and its conclusions are:

- **Cloudflare supports old compatibility dates forever.** The register's phrase *"the runtime
  date is over a year old"* describes **staleness, not a deprecation risk**. Nothing breaks if
  the date is left alone.
- **What staleness costs** is the documentation: Cloudflare's docs describe only the *current*
  date's behaviour, and a gateway whose behaviour is a security boundary should be readable
  from the documentation that describes it.
- **The one behaviour a bump would change** is that `nodejs_compat` and `nodejs_compat_v2`
  switch **on by default** for compatibility dates on or after **2026-08-04**. This gateway uses
  **no Node.js API at all** and declares no flags, so the bump would give it a Node.js surface
  it does not use, and a bigger bundle.
- **What a bump would not change**: the Durable Object's storage and migrations (they are keyed
  by tag and class, **not** by the date — so a bump cannot invalidate a revocation), the signing
  scheme, the capability format, the key ids, or anything the gateway exposes on `/healthz`.
- **The recommendation:** bump to the deployment date, with
  `compatibility_flags = ["no_nodejs_compat", "no_nodejs_compat_v2"]` so the runtime's surface
  is exactly what it is today — and do it **after** staging has been accepted, so the bump is
  proved on the disposable environment first. The write gateway's date is **S5's**, and gets the
  same treatment and the same proof.
- **The decision is the operator's.** The review states the exact one-line change, in which
  file, and the regeneration and check commands — it does not apply it.

### 1.5 The S4 stage checks, so the gate means something

`release/rollout-gate.sh S4` implemented **two external presence checks and nothing else**. A
stage whose exit gate it never looked at could have been reported as a pass. It now states the
read gateway's exit gate:

| Check | What it establishes |
|---|---|
| `S4-PROD-CONFIG` | the production configuration is deployable — **BLOCKED-EXTERNAL** today, naming the placeholder |
| `S4-STAGING` | the deployed staging gateway answers and serves the **committed staging key ids** — a gateway at the staging host that served `p1` would fail this |
| `S4-PROBES` | the deployed gateway refuses what it must — the pilot's read-half probes, against the published gateway |
| `S4-APPROVAL` | the production run carries an environment approval **by a login ADR 0013 records and not by the dispatching identity**. No approval is a FAIL; no recorded login is BLOCKED-EXTERNAL, which is the plan's own wording |

The approval check finds the production deployment through the **deployments** API — the run
object's `environment` field is `null` even for a run that used an environment, so the run
cannot be told apart from a staging one that way — and reads the approving reviewers from
`GET /actions/runs/{id}/approvals`.

---

## 2. The exit gate, item by item

| Exit-gate item | Verdict | Evidence |
|---|---|---|
| `[R]` Staging conformance run archived (run id, counts, zero failures) | **PASS** | run **42660470167**; the archived gate log holds `58 passed, 0 failed`, the abuse controls, the operational checks and the isolation proof |
| `[R]` Production conformance archived | **not done** | production has never been deployed: `ctxgate-read.qnuralink.workers.dev` answers 404 |
| `[R]` Unavailable-state test fails closed on the deployed gateway | **prepared, not yet run** | `ops/state-failure-probe.py` (7 checks, proven against the healthy gateway) and `.github/workflows/staging-state-failure.yml`, which plants the failure by publishing a build whose Durable Object constructor throws — the harshest of the two branches, where the object cannot be reached at all — and then restores the good build. **The workflow must exist on `main` before it can be dispatched** (GitHub answers 404 for a workflow that is not on the default branch), so it waits on the merge of PR #54 |
| `[R]` Revocation and audit verified remotely (after restart and after key rotation); audit retrieval works | **half** | the *closed* half is proved remotely: the audit and revocation channels refuse an unauthenticated caller (401) on the published gateway. The *open* half — a real revocation, an audit retrieval, and both across a restart and a key rotation — needs the operator's channel credential (`CTXGATE_OPERATOR_TOKEN`), which lives in the `staging` environment and which this credential cannot read |
| `[R]` The production run shows an environment approval by a login recorded in ADR 0013 that is not the dispatching agent's identity | **BLOCKED-EXTERNAL** | no production run exists, and ADR 0013 records no login. The plan's own wording: *"If ADR 0013 has no login recorded yet, the gate is BLOCKED-EXTERNAL."* |
| `[R]` `verify-deployment.py` post-deploy check passes for production; the hostname serving matches; no wildcard route; the shared-zone separation holds | **staging: PASS; production: not done** | the publish job ran `verify-deployment.py --env staging --base-url …` and it passed; the live separation gate passes for the read gateway; the published gateway serves the committed staging key ids and the staging worker name |
| `[R]` The read gateway's log capture holds no signature, URL secret, content or credential | **PASS** for the capture this stage has | 0 hits over 43,518 bytes of the archived run log, 8 shapes (section 1.3) |
| `[R]` `C-PROT`, `C-CI`, `C-SECRETS` | **PASS** | section 3 |

**The stage is not PASS.** Two of the six items are blocked on the operator and one is waiting
on a merge.

---

## 3. The gate, as it was run

```
$ GITHUB_TOKEN=… release/rollout-gate.sh S4
rollout gate: stage S4
repository:   inscope-labs/build-engine
main:         1563bd2
started:      2026-11-09T17:13:45Z
```

| Check | Result |
|---|---|
| `C-PROT` | PASS — pull request required, required check `test`, force-push blocked |
| `C-CI` | PASS — 10 check runs on `main`, all successful |
| `C-BASE` | PASS — shipped-engine unittest `OK`; `release/test-release.sh` 94 passed, 0 failed; `tests/test_update.sh` 150 + 22 passed, 0 failed |
| `C-CONF` | PASS — harness 94 passed, 0 failed; `conformance` unittest `OK`; the fault injector's own tests `OK` |
| `C-READ` | PASS — unit suite (`# fail 0`); `ops:check`; `check:bundle`; the read staging separation; the reference gateway's unittest `OK` |
| `C-WRITE` | PASS — the typecheck over three programs; the whole suite (`# fail 0`); `check:contract`; `check:staging` |
| `C-ISO` | PASS — no gateway/conformance/ops/variants/`.github` path and no deployment configuration in the artifact |
| `C-SECRETS` | PASS — no credential shape in 380 files or in the diff against `origin/main`; 8 deliberate sentinels excluded and listed |
| `C-DIFF` | PASS — nothing removed from `template/`, the allowlist, the forbidden rules or the tests |
| `S4-PROD-CONFIG` | **BLOCKED-EXTERNAL** — the production configuration is not deployable: `GITHUB_REPO` is still a placeholder: `OWNER/REPO` |
| `S4-STAGING` | PASS — the staging gateway at `ctxgate-read-staging.qnuralink.workers.dev` answers and serves the staging key ids (`s1`) |
| `S4-PROBES` | PASS — `THE PROBES PASSED (7 checks)` against the deployed gateway |
| `S4-APPROVAL` | **BLOCKED-EXTERNAL** — ADR 0013 records no GitHub login |
| `S4-SECRETS` | **BLOCKED-EXTERNAL** — the secret list of `production` could not be read (403) |
| `S4-WORKER-SECRETS` | **BLOCKED-EXTERNAL** — no Cloudflare credential in the environment (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) |

**26 PASS, 0 FAIL, 4 BLOCKED-EXTERNAL.** The exit code is **2**.

**The pull request's own CI is green:** `GET /repos/…/commits/1563bd2/check-runs` answers
**7 runs, all `success`** — `test`, `read gateway (typecheck, unit, conformance)`,
`write gateway (typecheck, bundle, contract)`, `write gateway (unit)`,
`write gateway (integration)`, `write gateway (log hygiene and the credential boundary)` and
`write gateway (staging is separate from production)`. The gate was run twice, at `4a2781d` and
at `1563bd2`, and the result was the same both times.

---

## 4. What the operator has to do, and in what order

1. **Give `production` a required reviewer, and name the login in ADR 0013.** The reviewer must
   not be the identity that dispatches the run. The identity available to the agent is
   `inscope-labs` — the operator's own login — so a reviewer drawn from the operator's account
   would be the dispatching identity. **A second login is needed.** This clears S3's `S3-ENV`,
   S4's `S4-APPROVAL`, and S5's and S9's equivalent gates.
2. **Set the production read repository to `acme-pilot-dev`** in
   `gateway/read/production/ops/environments.json` (ADR 0012 item 3) and regenerate
   (`npm run ops:render`). `render-environments.py --assert-deployable production` refuses the
   placeholder, and `ops:check` fails if the generated file drifts.
3. **Provision the `production` environment** with `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID` and `CTXGATE_BASE_URL`, and set the production Worker's three
   secrets (`production-init`). The `staging` environment already has what the staging deploy
   needed — that is how the deploy above succeeded.
4. **Merge PR #54.** The deployed state-failure proof cannot run before it: GitHub answers
   **404** for a workflow that is not on the default branch. After the merge, dispatch
   `staging state failure` with a reason; it plants the failure, proves the `503`, and restores
   the gateway.
5. **Decide the compatibility date** (`docs/release/COMPATIBILITY-DATE-REVIEW.md`). The
   recommendation is the deployment date plus `no_nodejs_compat` and `no_nodejs_compat_v2`.
   It should be applied **after** the staging acceptance it is reviewed against.

---

## 5. Not done, and not verified

- **Nothing was deployed to production.** The production host answers 404.
- **No GitHub environment, protection rule or secret was changed.**
- **No merge, no tag, no publication.**
- **The signed deployed conformance was not run**: a valid link, an expiry, a replay and a
  revocation against the *published* gateway all need the operator's staging signing secret,
  which lives in the `staging` environment and which this credential cannot read. The unsigned
  refusals were proved; the signed ones are not.
- **The remote revocation-and-audit evidence** (a real revocation, an audit retrieval, and both
  across a Worker restart and a key rotation) is **not** proved. The deployed operational
  checks cover a cold start, provider failures, an unavailable source repository, expiry, a
  revoked order and key rotation — but the **operator channel** credential is needed to drive
  them against the published gateway.
- **The deployed state-failure proof has not been run** — it needs PR #54 merged (section 4).
- **The compatibility date has not been bumped.** The review is written; the decision and the
  change are the operator's.
- **The production conformance run is not archived**, because production is not deployed.

---

## 6. The commands, and what they answered

| Command | Answer |
|---|---|
| `release/rollout-gate.sh S4` | 26 PASS, 0 FAIL, 4 BLOCKED-EXTERNAL; exit 2 |
| `POST /actions/workflows/deploy-read-gateway.yml/dispatches` (`ref: main`, `environment: staging`) | 204 → **run 42660470167, success** |
| the archived run's gate log | `58 passed, 0 failed`; abuse controls, operational checks and isolation proof all PASSED |
| `curl https://ctxgate-read-staging.qnuralink.workers.dev/healthz` | `{"status":"ok","scheme":"ctxgate-v1","key_ids":["s1"],"conformance_clock":false}` |
| `curl https://ctxgate-read.qnuralink.workers.dev/healthz` | **404** — production is not deployed |
| `python3 ops/staging-pilot.py --probes-only --only read --read-base …` | **7 checks, all passing** |
| `bash ops/deploy-gate.sh --env staging` (local, same commit) | **exit 0** — "THE GATE PASSED. Nothing was published." |
| the privacy scan over the archived run log | **0 hits** over 43,518 bytes, 8 shapes |
| `python3 ops/state-failure-probe.py --base-url … --expect 403` | **PASS** (the healthy gateway) |
| `GET /repos/…/environments/production` | `protection_rules: []` |
| `GET /repos/…/environments/production/secrets` | **403 "Resource not accessible by personal access token"** |
| `GET /repos/…/deployments` | the deployment records the environment (the run object does not) |
| `GET /repos/…/actions/runs/42660470167/approvals` | `[]` — and the endpoint works |
| `POST /actions/workflows/staging-state-failure.yml/dispatches` | **404** — the workflow is not on `main` yet |
| `python3 ops/render-environments.py --assert-deployable production` | exit 1 — `GITHUB_REPO is still a placeholder: OWNER/REPO` |


---

## 7. The production half, after the operator's answers (2026-11-09)

The operator answered S4's unblock questionnaire on 2026-11-09 and authorized all four actions
the questionnaire asked about. This section records what that made possible, what was applied,
what the answers did **not** make possible, and the two findings the stage produced when it
ran the deployed proof.

### 7.1 The answers

| Question | Answer | What it changed |
|---|---|---|
| the approver on `production` | **A** — a second personal account, login `inscope-xlabs` | ADR 0013's addendum records the login; the protection rule is authorized |
| the production repository and allowlist | **A** — `acme-pilot-dev`, `amk/,plans/*/package/` | the committed configuration carries them and `wrangler.toml` is re-rendered |
| the credential's scope | **A** — the operator grants Secrets (read) and Environments (read/write) | the secret lists became readable **by name** (section 7.3) |
| the authorizations | **all four** | the protection rule, the ADR addendum, the configuration edit, and the dispatches |

### 7.2 What was applied

- **ADR 0013 gained an addendum.** The two conditions it carried are met: the approver's login
  is supplied, and it is not the login the agent dispatches as. The addendum names the four
  authorizations, each of which the operator granted explicitly.
- **The production configuration carries the real values.** `GITHUB_REPO` was the placeholder
  `OWNER/REPO`, which `render-environments.py` refuses to deploy; it is now `acme-pilot-dev`,
  and `wrangler.toml` is re-rendered from it. One line in each file.
  `--assert-deployable production` now answers *"the 'production' environment is ready to deploy"*.
- **The gate's lookup of the recorded login is precise.** It reads the one line the addendum's
  convention defines, so no other backticked word in the ADR can be mistaken for a login, and
  with no addendum it yields nothing and the approval gate stays BLOCKED-EXTERNAL.
- **Pull request #55** carries all of it. CI is 7/7 green. **The operator merges it** (G-12).

### 7.3 The credential now reads the secret lists

With the scope the operator granted, all four listings answer 200. The names are:

| Environment | Secret and variable names |
|---|---|
| `staging` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CTXGATE_BASE_URL`, `CTXGATE_OPERATOR_TOKEN`, `CTXGATE_SECRET`, `CTXGATE_WRITE_OPERATOR_TOKEN`, `CTXGATE_WRITE_SECRET`, `READ_GH_TOKEN`, `WRITE_GH_TOKEN`, and the variable `DELIVERY_PUBLIC_KEY` |
| `production` | **none** — no secret and no variable |
| repository level | **none** |

**Names only. No value was read, printed or stored** (ADR 0013 item 4). The production
environment is therefore **unprovisioned**, which is the operator's outstanding checklist item,
and the `production-init` run would fail on it. The `staging` environment shows what a
provisioned environment looks like.

### 7.4 The two things the answers did not make possible

**The approver account does not exist yet.** `GET /users/inscope-xlabs` answers **404**, and
`GET /repos/inscope-labs/build-engine/collaborators` lists **one** account with access:
`inscope-labs`, which is the identity the agent dispatches as — so it cannot also be the
reviewer. There **is** a pending collaborator invitation (id `342406426`, `write`, created
`2026-11-09T10:53:04Z`), and its `invitee` is `null`: it was sent to an address, not to an
existing login, so **no GitHub user id exists for it yet**. GitHub's required-reviewer rule
takes a numeric user id, so the protection rule cannot be written until the account is created
and the invitation is accepted. Adding `inscope-labs` as the reviewer would satisfy the API
and defeat the ADR: the approval gate would approve itself.

**The production environment holds no values.** Section 7.3. The operator's checklist covers
this, and it is the only way to set it: GitHub has no API for a secret's value, and ADR 0013
item 4 says the agent never handles one.

### 7.5 The deployed proof failed, and the failure was the point

With PR #54 merged, the state-failure proof became dispatchable. **Run `42701286443` failed**,
and it failed honestly: the restore step ran, the good build was published again, and the
gateway serves (`/healthz` answers 200, key ids `['s1']`).

    the unsigned request answered 403: forbidden (link invalid, expired or revoked)
    FAIL the request is refused with 503, not served
    FAIL the refusal names state-unavailable (forbidden (link invalid, expired or revoked))

**The cause was not the gateway.** Cloudflare's default Durable Object code-update strategy is
`deferred`, with a maximum delay of 300 seconds: an object that is already running keeps
running the **old** code after a deploy, so the planted constructor throw was never executed
for the object that was serving. The workflow deployed and asked the gateway within half a
second, so it reached a healthy store — and the gateway was right to answer `403`, because it
could read its state and had no reason to answer `503`. This is **F0-078**, and the second
finding, that the run's summary asserted the proof's conclusion instead of reporting it, is
**F0-079**.

The fix is in PR **#55**: the probe waits for the planted failure to become live (`--wait`,
longer than the vendor's maximum delay), prints every attempt so a timeout says what was
answered and when, and asks the operator channel — the one route that reaches the state store
directly — so the evidence distinguishes *"the gateway refused"* from *"there was nothing to
read"*. The plant is unchanged: **the state store itself is still the thing that is broken.**

The gate gained `S4-STATE-FAILURE`, which requires the most recent proof run to have
**concluded `success`**. A failed run is not a weak proof; it is no proof, and the gate now
says so.

### 7.6 The state after the answers

| Item | State | Whose |
|---|---|---|
| PR #55 — the ADR addendum, the configuration, the gate's login lookup | open, CI 7/7 | **operator: merge** |
| PR #55 — the proof's fix and `S4-STATE-FAILURE` (same pull request) | open | **operator: merge** |
| the `inscope-xlabs` account and its invitation | does not exist | **operator: create and accept** |
| the production environment's five secrets and one variable | unprovisioned | **operator: set** |
| the protection rule on `production` | not written | agent, once the account exists |
| the production deploy | not dispatched | agent, once the rule and the values are in place |

**Nothing was merged, tagged, published or deployed to production.** The only deployment this
stage performed after the answers was the **staging** one the state-failure proof needs, and
the proof's restore step put the good build back.
