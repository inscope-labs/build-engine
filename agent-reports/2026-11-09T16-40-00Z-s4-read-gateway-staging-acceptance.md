# S4 work package — the read gateway's staging acceptance, and what is still the operator's

- **Stage:** S4 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-4)
- **Branch:** `s4/read-gateway-staging-acceptance` — **pull request #54**
- **Baseline:** `main` at `83e15e15` — *"Merge pull request #53 from inscope-labs/s3/workflow-and-deployment-hardening"*,
  merged by the operator on 2026-11-09. `VERSION` = `0.5.0`.
- **Run:** 2026-11-09T16:40Z → 2026-11-09T17:45Z
- **Scope:** `release/rollout-gate.sh`, `ops/`, `.github/workflows/`, `docs/release/`, and the
  read gateway's **staging** deployment. **No production deploy, no merge, no tag, no
  publication, and no change to any GitHub environment, protection rule or secret.**

## 1. Intent

The operator's question was: *"Confirm you can implement stage S4 now? is there anything blocking
S4 execution?"* — and then the session credential was supplied.

**The answer is: the staging half is executable and is now done; the production half is blocked
on four conditions that are the operator's, and one that waits on a merge.** The stage's own
work was carried out to the end of what the repository can do.

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 4.1 | Review the compatibility-date bump (R0-008 open half) | **done** | `docs/release/COMPATIBILITY-DATE-REVIEW.md`: Cloudflare supports old dates forever (so this is staleness, not a deprecation), the one behaviour a bump would change here is `nodejs_compat` switching on by default at 2026-08-04, and the Durable Object's migrations are keyed by tag and class so **a bump cannot invalidate a revocation**. The recommendation is the deployment date plus `no_nodejs_compat` + `no_nodejs_compat_v2`. **Nothing applied; the decision is the operator's.** |
| 4.2 | Dispatch the staging deploy and acceptance workflow | **done** | [run 42660470167](https://github.com/inscope-labs/build-engine/actions/runs/42660470167) — **success**: the gate job, the staging acceptance job and the publish job. The gateway is published at `https://ctxgate-read-staging.qnuralink.workers.dev`, serving the staging key id `s1`, with `conformance_clock: false`. |
| 4.3 | Run the shared conformance suite against the deployed gateway | **done for the secret-free half** | the deployed probes, 7/7 against the published gateway; and the archived gate log's `58 passed, 0 failed`. **The signed half is not done** — a valid link, an expiry, a replay and a revocation against the published gateway all need the operator's staging signing secret. |
| 4.4 | Verify remote revocation and audit after restart, key rotation, unavailable state storage and provider failure | **half** | the *closed* half is proved remotely: the audit and revocation channels refuse an unauthenticated caller (401) on the published gateway. The *open* half needs the operator's channel credential. The **unavailable-state** half is built and waiting on a merge (row 4.6). |
| 4.5 | Dispatch the production deploy workflow | **not done, deliberately** | `production` has **no required reviewer**, so a production run would have auto-approved itself and published without a human — the exact failure ADR 0008's approval gate exists to prevent. The production configuration also still carries the `OWNER/REPO` placeholder and `render-environments.py --assert-deployable production` refuses it. |
| 4.6 | Make the stage's gate mean something | **done** | `release/rollout-gate.sh S4` implemented two external presence checks and nothing else. It now states the read gateway's exit gate: `S4-PROD-CONFIG`, `S4-STAGING` (the deployed gateway answers **and serves the committed staging key ids**), `S4-PROBES`, `S4-APPROVAL` (an approval by a login ADR 0013 records, not by the dispatching identity). |
| 4.7 | The deployed state-failure proof | **built, not run** | `ops/state-failure-probe.py` and `.github/workflows/staging-state-failure.yml`. The probe is proven against the healthy gateway. **GitHub answers 404 for a workflow that is not on the default branch**, so it waits on the merge of PR #54. |
| 4.8 | The privacy scan over the log capture | **done for the capture this stage has** | the archived run log (43,518 bytes), eight credential shapes, **0 hits**. The platform's Worker logs are the operator's to export. |
| 4.9 | Merge, tag, publish, or change any environment | **not done** | none of them. |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-PROT` | `GET /repos/…/branches/main/protection` | 0 | pull request required, required check `test`, force-push blocked |
| `C-CI` | `GET /repos/…/commits/main/check-runs` | 0 | 10 check runs on `main`, all `success` |
| `C-BASE` | the three shipped-engine and release self-tests | 0 | `OK`; `94 passed, 0 failed`; `150 passed, 0 failed` + `22 passed, 0 failed` |
| `C-CONF` | the harness, the conformance unittest, the fault injector's unittest | 0 | `94 passed, 0 failed`; `OK`; `OK` |
| `C-READ` | `npm test`, `ops:check`, `check:bundle`, `check:staging:read`, the reference unittest | 0 | `# fail 0`; `wrangler.toml matches ops/environments.json`; `the Worker builds for every environment`; `OK: the read staging environment is separate from production`; `OK` |
| `C-WRITE` | `typecheck`, `npm test`, `check:contract`, `check:staging` | 0 | three programs; `# fail 0`; `the contract documents agree`; `staging environment is separate` |
| `C-ISO` | `package.sh` + `verify.sh --test-payload` | 0 | `verify: OK`; no infrastructure or deployment configuration in the artifact |
| `C-SECRETS` | the gate runner's own scan | 0 | no credential shape in 378 files or in the diff; 8 sentinels excluded and listed |
| `C-DIFF` | the diff against `v0.5.0` | 0 | nothing removed |
| `S4-PROD-CONFIG` | `render-environments.py --assert-deployable production` | 1 | `GITHUB_REPO is still a placeholder: OWNER/REPO` → BLOCKED-EXTERNAL |
| `S4-STAGING` | `GET https://ctxgate-read-staging.qnuralink.workers.dev/healthz` | 0 | `key_ids ["s1"]` — the committed staging key ids |
| `S4-PROBES` | `ops/staging-pilot.py --probes-only --only read` | 0 | `THE PROBES PASSED (7 checks)` |
| `S4-APPROVAL` | ADR 0013's recorded logins | — | none → BLOCKED-EXTERNAL, the plan's own wording |
| `S4-SECRETS` | `GET /environments/production/secrets` | 403 | "Resource not accessible by personal access token" |
| `S4-WORKER-SECRETS` | the Cloudflare secret list | — | no Cloudflare credential in the environment → BLOCKED-EXTERNAL |
| the whole gate | `release/rollout-gate.sh S4` | **2** | **26 PASS, 0 FAIL, 4 BLOCKED-EXTERNAL** |
| the staging deploy | `POST /actions/workflows/deploy-read-gateway.yml/dispatches` | 204 | run 42660470167, **success** |
| the local staging gate | `bash ops/deploy-gate.sh --env staging` | 0 | "THE GATE PASSED. Nothing was published." |
| the privacy scan | 8 credential shapes over the archived run log | 0 | **0 hits** over 43,518 bytes |
| the deployed probe | `ops/state-failure-probe.py --expect 403` | 0 | PASS against the published gateway |
| the new workflow's dispatch | `POST …/staging-state-failure.yml/dispatches` | **404** | the workflow is not on `main` yet |

## 4. Four things the operator should know

1. **The read gateway is published.** The staging deployment happened and the gateway answers,
   serves the staging key id and refuses what it must. The production host still answers 404.
2. **The credential cannot read secret lists.** `GET /environments/*/secrets`,
   `/actions/secrets` and `/actions/variables` all answer **403 "Resource not accessible by
   personal access token"**. The S3 report read that as "empty"; it is **unverified**, and the
   S3 report is corrected. The `staging` environment demonstrably *does* hold the secrets the
   deploy needed — that is how the deploy succeeded.
3. **A new workflow needs the operator's merge before it can be dispatched.** GitHub answers
   404 for a workflow that is not on the default branch. Every existing workflow could be
   dispatched from a branch (and ran the branch's version); a **new** one cannot. This is what
   the deployed state-failure proof is waiting on.
4. **The production deploy was deliberately not dispatched.** `production` has no required
   reviewer, so it would have auto-approved itself and published without a human.

## 5. The order the operator's work needs to happen in

1. Give `production` a required reviewer, and **name the login in ADR 0013**. The identity
   available to the agent is `inscope-labs` — the operator's own login — so the reviewer must be
   a **second** login, or the approval gate approves itself. This clears S3's `S3-ENV`, S4's
   `S4-APPROVAL`, and S5's and S9's equivalents.
2. Set the production read repository to `acme-pilot-dev` (ADR 0012 item 3) in
   `gateway/read/production/ops/environments.json` and regenerate (`npm run ops:render`).
3. Provision the `production` environment (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CTXGATE_BASE_URL`) and the production Worker's three secrets.
4. Merge PR #54, then dispatch `staging state failure` — it plants the failure, proves the
   `503 state-unavailable`, and restores the gateway.
5. Decide the compatibility date, with `docs/release/COMPATIBILITY-DATE-REVIEW.md` in hand.
