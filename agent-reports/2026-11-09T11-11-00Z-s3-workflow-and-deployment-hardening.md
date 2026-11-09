# S3 work package — workflow and deployment hardening

- **Stage:** S3 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-3)
- **Branch:** `s3/workflow-and-deployment-hardening` — **pull request #53**
- **Baseline:** `main` at `b5d20dd` — *"Merge pull request #52 from inscope-labs/s2/contract-and-capability-closure"*,
  merged by the operator on 2026-11-09. `VERSION` = `0.5.0`; tag `v0.5.0` → commit `c95ae51`.
- **Run:** 2026-11-09T10:40Z → 2026-11-09T11:20Z
- **Scope:** `.github/workflows/**`, `ops/`, `release/`, `gateway/read/production/ops/`, `docs/release/`.
  **No gateway source, no shipped payload (except one word in another stage's report), no conformance
  vector, no signing scheme, no GitHub environment, no merge, no tag, no deploy.**

## 1. Intent

The operator's brief was: *"Execute stage S3. I will not merge the PR until all the external
blockages are successfully removed, but go ahead and complete the stage as normal while I work on
the blockages."*

So the instruction is: do the whole stage, and do not pretend the external part is done.

S3's entry gate has two conditions. The `[R]` one — S2 PASS — is met: PR #52 is merged and CI is
green on `main`. The `[E]` one is not: the `production` environment has **no protection rule at
all**, and ADR 0013 records no GitHub login, so there is no reviewer to check against and no way
for the agent to name one. **The agent did the whole stage and recorded the external condition as
BLOCKED-EXTERNAL.** The stage's result is not PASS, and the report says so.

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 3.1 | Resolve every `\|\| true` in `.github/workflows/` and gateway CI | **done** | 12 sites removed from the deployment path (the 3 the plan named, plus 9 more of the same shape in `ops/`, `release/` and the read gateway's deploy gate). `S3-PERMISSIVE` and `S3-POLICY` both pass; no hit anywhere in the scan set. |
| 3.2 | Lockfiles committed; installs deterministic (`npm ci`) | **done** | Both lockfiles were **already** committed and every workflow already used `npm ci` — the baseline was already true, and the report says so. What was missing was that nothing *checked* it: `release/check-installs.py` now checks the lockfile's agreement with the manifest (the comparison `npm ci` makes), that no workflow installs non-deterministically, and that every `cache-dependency-path` exists. Wired into CI. |
| 3.3 | Production deploy is a fail-closed sequence | **done** | `deploy.yml` and `deploy-read-gateway.yml` are now `gate → staging-acceptance → publish`, joined by `needs:`. The sequence is typecheck → unit and integration → conformance → privacy and log hygiene → bundle verification → staging acceptance → explicit approval. The approval is the `production` environment's reviewer; the staging acceptance is a live check of the deployed staging gateway, and the publishing job waits for it. `S3-SEQUENCE` checks the graph and the order; mutations M09–M12 show it fails when the graph is broken. |
| 3.4 | Scan finds no unreviewed `\|\| true` / `continue-on-error` | **done** | No `continue-on-error` anywhere. The four outside the deployment path (`tests/`, `template/`) are read and recorded with the reason each cannot affect a gate — and one of them turned out to be a real defect, **F0-077**. |
| 3.5 | A deliberately failing gate demonstrably blocks deployment | **done** | Two runs on the throwaway branch `s3/planted-failure-demo`, **not merged**: run **42606008496** (the read gateway's staging deployment) — the gate job failed on a planted type error and the **publish job was skipped**; run **42606042389** (the write gateway's production deployment) — the gate failed at "Only main may deploy" and the **deploy job was skipped**. Nothing was published. |
| 3.6 | The release verifier still excludes the gateway infrastructure | **done** | `C-ISO` PASS: no `gateway/**`, `conformance/**`, `ops/**`, `variants/**` or `.github/**` path, and no deployment configuration, in the artifact. |
| 3.7 | The existing gates still catch their planted regressions | **done** | A mutation battery of **21 planted regressions**: the four S3 checks, the write gateway's separation and production checks, the log-hygiene gate, the fault injector's own tests and the packaging gate. **21 caught, 0 missed.** It found two holes in the new checks, fixed in `cde117f`. |
| 3.8 | `C-PROT`, `C-CI`, `C-SECRETS` | **done** | All three PASS. `C-SECRETS` first **FAILED** on an inherited hit — see §4. |
| 3.9 | The `production` environment's required reviewer | **not done** | **BLOCKED-EXTERNAL.** `protection_rules: []`, and ADR 0013 has no login. The agent's credential authenticates as `inscope-labs`, the operator's own login, so a reviewer from the operator's account would be the dispatching identity. The operator is resolving this. |
| 3.10 | Merge, tag, publish, deploy, or change any environment | **not done** | None of them. The agent never merges (G-12). |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-PROT` | `GET /repos/inscope-labs/build-engine/branches/main/protection` | 0 | pull request required, required check `test`, force-push blocked |
| `C-CI` | `GET /repos/inscope-labs/build-engine/commits/main/check-runs` | 0 | 7 check runs on `main`, all `success` |
| `C-BASE` | `python3 -m unittest discover -s template/engine/tools` | 0 | `OK` |
| `C-BASE` | `release/test-release.sh` | 0 | `94 passed, 0 failed` |
| `C-BASE` | `tests/test_update.sh` | 0 | `150 passed, 0 failed` + `22 passed, 0 failed` |
| `C-CONF` | `python3 conformance/harness/run.py all --reference` | 0 | `94 passed, 0 failed` |
| `C-CONF` | `python3 -m unittest discover -s conformance -p 'test_*.py'` | 0 | `OK` |
| `C-CONF` | `python3 -m unittest discover -s ops -p 'test_*.py'` | 0 | `OK` |
| `C-READ` | `npm test`, `npm run ops:check`, `npm run check:bundle`, `npm run check:staging:read` (from `gateway/write`), the reference gateway's unittest | 0 | `# fail 0`; `wrangler.toml matches ops/environments.json`; `the Worker builds for every environment`; `OK: the read staging environment is separate from production`; `OK` |
| `C-WRITE` | `npm run typecheck`, `npm test`, `npm run check:contract`, `npm run check:staging` | 0 | the typecheck over three programs; `# fail 0`; `the contract documents agree`; `staging environment is separate` |
| `C-ISO` | `release/package.sh dist` + `release/verify.sh … --test-payload` | 0 | `verify: OK`; no gateway/conformance/ops/variants/`.github` path and no deployment configuration in the artifact |
| `C-SECRETS` | the gate runner's own scan over the tree and the diff | 0 | no credential shape in 373 files or in the diff against `origin/main`; 8 deliberate sentinels excluded and listed |
| `C-DIFF` | `git diff --name-status v0.5.0..HEAD -- template/ release/manifest.txt release/forbidden.txt tests/` | 0 | nothing removed; 5 files changed, none of them by this stage |
| `S3-POLICY` | `python3 release/check-workflow-policy.py` | 0 | 35 deployment-path files free of permissive expressions, 8 deployment workflows not triggered by a push or a pull request, 10 workflows with pinned actions, 2 publishing workflows with a fail-closed sequence |
| `S3-INSTALLS` | `python3 release/check-installs.py` | 0 | 2 packages with a committed and agreeing lockfile, 10 workflows installing with `npm ci` |
| `S3-PERMISSIVE` | the gate runner's own grep over the deployment path | 0 | no permissive expression in `.github/workflows`, `ops`, `release` or the gateway deploy scripts |
| `S3-LOCKFILE` ×2 | `git ls-files --error-unmatch` | 0 | both lockfiles are committed |
| `S3-TRIGGER` ×3 | grep | 0 | none of the three publishing workflows is pull-request triggered |
| `S3-SEQUENCE` ×2 | grep over the job graph | 0 | in both publishing workflows the staging acceptance job exists and the publishing job waits for it |
| `S3-ENV` | `GET /repos/inscope-labs/build-engine/environments/production` | — | `protection_rules: []` → **BLOCKED-EXTERNAL** |
| the whole gate | `release/rollout-gate.sh S3` | **2** | **33 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** |
| the mutation battery | 21 planted regressions | 0 | **21 caught, 0 missed** |
| the planted-failure runs | `POST …/dispatches` (ref `s3/planted-failure-demo`) | — | run 42606008496 **failure**, publish skipped; run 42606042389 **failure**, deploy skipped |

## 4. Two things the operator should know before merging

**The `C-SECRETS` failure was inherited, not introduced.** The first full gate run FAILED on a
hit in `docs/release/PHASE-S2-REPORT.md` — the S2 report quoted a sentinel's shape in the
sentence that recorded the sentinels its own run had excluded, and the shape is what the scan
looks for. It was confirmed on a clean checkout of `main` at `b5d20dd`, so every stage from S3
onwards would have failed its entry gate on it. Recorded as **F0-076** and fixed: the report now
names the sentinel instead of reproducing it. The addendum that records F0-076 reproduced the
sentinel on its first draft too, and the scan caught the addendum — which is the second half of
the finding.

**One file outside this stage's scope was touched**: that one sentence in the S2 report. It is
the only change this branch makes outside the S3 scope, and it was needed to get the standing
gate green.

## 5. Deviations from the plan's wording

1. **Action pinning** (all ten workflows) is beyond the plan's three work items. It is included
   because the release workflow already required pinned actions (F0-023) and the deploy
   workflows are where the deployment credentials are. Each pin is the commit its tag named,
   verified through the API.
2. **The production deploy is now blocked until staging is accepted.** Strictly stronger than the
   baseline, and intended, but it means a production deploy cannot succeed until S4/S5 have
   deployed and accepted staging.
3. **The `production` environment's protection rules were not touched.** Adding a required
   reviewer is the operator's authorization to record (G-12), and the reviewer cannot be named
   correctly without the login ADR 0013 does not have.
4. **The read gateway's privacy stage is its isolation proof**, not a log-hygiene script: the
   write gateway's `verify:log-hygiene` is about the write gateway's audit stream, and the read
   gateway has no audit stream.
5. **`F0-077` is recorded and left open.** `template/engine/bin/update.sh` discards the
   rollback's own failure and then prints "the previous state was restored" either way. It is in
   the shipped payload, so it belongs to S8.
