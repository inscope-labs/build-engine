# S5 work package — the write gateway's staging acceptance, and the production half's approvals

- **Stage:** S5 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-5)
- **Branch:** `s5/write-gateway-acceptance` — **pull request #65** (CI 7/7 green, waiting on the operator's merge)
- **Baseline:** `main` at `c88bca9` — *"Merge pull request #64 from inscope-labs/ci/write-credential-probe"*,
  merged by the operator. `VERSION` = `0.5.0`.
- **Run:** 2026-11-11T06:40Z → 2026-11-11T07:20Z
- **Scope:** `ops/staging-pilot.py`, `ops/staging-estate.py`, `ops/staging-estate.json`,
  `.github/workflows/staging-pilot.yml`, `release/rollout-gate.sh`, `docs/release/`.
  **No merge, no tag, no publication, no change to any environment, protection rule or secret.**
  **No approval was given by the agent** — `current_user_can_approve` for the agent's
  credential is `false`, and that is the proof the gate is real.

## 1. Intent

Execute S5: verify the entry gate, review the compatibility date for the write gateway,
deploy the write gateway to staging and run the acceptance workflow, make the signed pilot
re-runnable, and carry the production half as far as the approval gate allows.

**The entry gate is met, the staging half is done, and the production half is waiting at
two approvals that are the operator's.**

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 5.1 | Verify the entry gate's three `[E]` conditions | **done, all three** | **ADR 0014** (decided 2026-11-10) is the operator's decision that resolves ADR 0012's condition: two repositories per plan, the weaker separation accepted, the branch named `submissions`. By API read: `inscope-labs/acme-pilot-dev` (private, default branch `submissions`), the branch `submissions` @ `5708275`, the folders `plans/acme-pilot/submissions/10001-S001`; the consumer `inscope-labs/acme-pilot` is public. **The write credential's reach:** the operator's own `verify-write-credential-scope.yml`, run **42949381010**, **PASS** — the submissions repository listed and writable, the consumer listed but **not** writable, 29 other repositories probed, none writable. **The production configuration:** `check-production.py` → **OK**, and the production environment holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CTXGATE_BASE_URL`, `READ_GH_TOKEN`, `WRITE_GH_TOKEN` and the variable `DELIVERY_PUBLIC_KEY` — **names only**. |
| 5.2 | Review the compatibility-date bump (R0-008's open half for the write gateway) | **done, review only** | `docs/release/COMPATIBILITY-DATE-REVIEW-WRITE.md`: bump to the deployment date, keep the surface with `no_nodejs_compat` + `no_nodejs_compat_v2`. The write gateway's proof is **stronger** than the read gateway's — it holds two Durable Object classes (`TaskSession`, `AuditStream`) and the record of decisions about work, so the proof is that **a sealed task stays sealed and the audit stream survives**. **Nothing applied; the decision is the operator's.** |
| 5.3 | Deploy the write gateway to staging and run the acceptance workflow | **done** | run **42975489428** (`deploy-write-gateway-staging.yml` from `main`): **success** — the gate job and the publish job, and *the published gateway is the staging one*. Live at `https://ctxgate-write-staging.qnuralink.workers.dev`: `{"status":"ok","protocol":"ctxwrite-v1","deploy_env":"staging","policy":{"key_ids":["sk1"]}}`. |
| 5.4 | Run the deployed probes | **done** | twelve checks against the two deployed staging gateways, recorded as run **42975698144** (`staging-pilot.yml`, `probes-only`): **success**. Both gateways answer 200, the read serves `s1` and the write `sk1`, the separation gate passes for both, a bad signature and an unknown order are refused (403), and both audit and revocation channels refuse an unauthenticated caller (401). The probes-only mode needs no secret, so it is repeatable. |
| 5.5 | Make the signed pilot re-runnable | **done** | **The pilot could not be re-run as it stood.** Its identifiers were hard-coded (`PLAN_NUMBER = "10008"`, and the task ids derived from it), and the first deployed run (41964576712, 2026-11-05) **revoked** that order and that task in the deployed Durable Objects — *a seal and a revocation are durable by design*. The script's own docstring says a second run needs "a fresh plan number (and the estate re-seeded for the new task folder)". The identifiers are now **derived from one number, and the number is an argument**: `ops/staging-pilot.py --plan-number N`, `ops/staging-estate.py seed --plan-number N`, and `.github/workflows/staging-pilot.yml` takes a `plan_number` input and **seeds the estate for that number before the pilot runs**, so the folder the gateway commits into and the folder the pilot computes cannot disagree (the gateway never creates the folder — protocol 12.3). **Validated by a full local signed run on plan 10010: 42 checks, `THE PILOT PASSED`** — create, append, the three refusals, the byte-for-byte read-back, the commit, the replay that is not a second commit, the seal, the write after the seal refused, the revocation of the order and of both tasks, the capabilities that stop working, and the audit records that hold no secret, no content and no signature. |
| 5.6 | Make the stage's gate mean something | **done** | `release/rollout-gate.sh S5` gained `S5-PROD-CONFIG`, `S5-STAGING`, `S5-PROBES` and `S5-APPROVAL`. **S4's approval check needed correcting as well** — it identified the production run by its workflow path, which is enough for the read gateway (whose stale production records come from a *different* workflow) but **not** for the write gateway, whose stale records are runs of the **same** `deploy.yml`, push-triggered, from before S3 hardened it. The check now requires three facts together: the workflow, the **event** (`workflow_dispatch`) and the **branch** (`main`). Both checks now say *"the production gateway has not been deployed yet"* rather than naming a six-day-old push-triggered run. |
| 5.7 | Run the signed pilot against the **deployed** gateway | **not done — waits on the merge** | the pilot's `--target deployed` needs the merged `--plan-number`, because the deployed run consumes the plan number it uses. The local validation above proves the code path; the deployed run is the evidence the exit gate asks for. |
| 5.8 | Dispatch the production write gateway | **partly — one approval is open** | `production-init` with `target=write`, `replace=no`, `create_if_missing=yes` → run **42976257752**, **`waiting`** at the `production` environment (id `25907172738`). The write gateway's production deploy (`deploy.yml`) is **not** dispatched: it waits for the signed pilot's evidence, because the init's own deploy already publishes a serving Worker — so publishing production before the acceptance would invert the plan's "staging then production" order. |
| 5.9 | Deploy the read gateway to production through the reviewed path | **not done — the operator's to sequence** | the production read Worker exists (the `production-init` run created it and set its secrets) and answers 200, but `deploy-read-gateway.yml` has **never** published to `production`. That is S4's `S4-APPROVAL`, still open. |
| 5.10 | Merge, tag, publish, approve, or change an environment | **not done** | none of them. |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-ENTRY-REPOS` | `GET /repos/inscope-labs/acme-pilot-dev`, `GET .../branches/submissions`, `GET .../contents/plans/acme-pilot/submissions` | 0 | the repository is private with the default branch `submissions`; the branch exists; the folders `10001-S001` exist |
| `C-ENTRY-SCOPE` | the operator's run **42949381010** | 0 | `submissions_repository_writable: True`, `consumer_writable: False`, `other_writable: 0`, `other_private: 0` — **PASS** |
| `C-PRODCFG` | `python3 gateway/write/scripts/check-production.py` | 0 | `production check: OK` — seven checks, including the separation ones |
| `C-STAGING-DEPLOY` | run **42975489428** | 0 | `success`; the publish step records *the published gateway is the staging one* |
| `C-STAGING-PROBES` | run **42975698144** (`probes-only`) | 0 | `success`; twelve checks against the published gateways |
| `C-LOCAL-SIGNED` | `python3 ops/staging-pilot.py --target local --plan-number 10010` | 0 | **`THE PILOT PASSED` (42 checks)** — the parameterised identifiers, the delivery, the seal, the revocation and the audit privacy |
| `C-ESTATE` | `python3 ops/staging-estate.py seed --plan-number 10010` | 0 | `staging/source@bbd4253`, `staging/submissions@736f61c`, the folder `10010-S001` present |
| `C-GATE-S5` | `release/rollout-gate.sh S5` | 1 | **4 PASS, 1 FAIL, 1 BLOCKED-EXTERNAL** — `S5-PROD-CONFIG` PASS, `S5-STAGING` PASS (`sk1`), `S5-PROBES` PASS (5 checks), `S5-SECRETS` PASS, `S5-APPROVAL` FAIL (the production write gateway has not been deployed yet), `S5-WORKER-SECRETS` BLOCKED-EXTERNAL (no Cloudflare credential in the agent's environment — ADR 0013 item 4) |
| `C-GATE-S4` | `release/rollout-gate.sh S4` | 1 | **5 PASS, 1 FAIL, 1 BLOCKED-EXTERNAL** — `S4-APPROVAL` FAIL, unchanged in substance |
| `C-PROD-HOST` | `GET https://ctxgate-write.qnuralink.workers.dev/healthz` | — | **404** — the production write gateway does not exist yet |
| `C-APPROVAL-GATE` | `GET .../actions/runs/42976257752/pending_deployments` | 0 | `env=production id=25907172738 current_user_can_approve=false` — the agent **cannot** approve its own run |
| `C-PR65-CI` | `GET .../commits/<sha>/check-runs` | 0 | **7 of 7 `success`** on PR #65's head |

## 4. The two things that are the operator's

1. **Merge PR #65.** The signed pilot's deployed run needs the merged `--plan-number`, and the
   deployed run consumes the plan number it uses. The merge also carries S5's gate checks,
   the compatibility-date review and the stage report.
2. **Approve run 42976257752** (the write gateway's production init) as `inscope-xlabs`, and
   then decrypt the delivery bundle it produces. After that the production deploy can be
   dispatched, and it waits at its own approval.

**The agent did not approve anything.** `current_user_can_approve` is `false` for the
agent's credential, and the `production` rule has `prevent_self_review: true`,
`can_admins_bypass: false` and `required_reviewers: ["inscope-xlabs"]`.

## 5. What was deliberately not done

- **The compatibility date was not bumped.** A review and a recommendation; the operator decides.
- **The production deploy was not dispatched** before the signed pilot's evidence. The init's
  deploy already publishes a serving Worker, so publishing production first would invert the
  plan's "staging then production" order.
- **No plan number was burned on the deployed gateway** by a trial run: the validation was run
  against the **local** runtime on its own number (10010), and the deployed run's number
  (10009) is untouched.
- **No credential was read, printed or stored.** The session token lives in `/workspace/.gh-token`
  (mode 600) and is read through an askpass script for `git push`, so it never enters the
  remote URL or `.git/config`. The Cloudflare credential is not in the agent's environment at
  all — `S5-WORKER-SECRETS` is BLOCKED-EXTERNAL for that reason and not by choice.
