# BE-0 work package 4 — production moves to `workers.dev`

- **Stage:** BE-0 (contract reconciliation and decisions) — build-engine 0.6.0 Standard
- **Branch:** `feature/be-0-production-workers-dev`
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07), clean checkout
- **Run:** 2026-11-07T09:4xZ
- **Scope:** the deployment gate for both gateways, and the documents and contract that state it.

## 1. Intent

ADR 0008 decision 2: the operator chose `workers.dev` for **production** as well as staging. ADR 0008's
consequences name the gate change as separate work: *"`gateway/read/production/ops/render-environments.py`
and `environments.json`/`environments.md` forbid production on `workers.dev`; the write gateway's production
block pins `workers_dev = false` (protocol section 12.5). Changing them is code work."*

This pull request is that work, and it must keep ADR 0008 item 4's shared-zone mitigations in force.

**Nothing was deployed.** No Cloudflare resource was created, changed or read with a credential. The
production repository is still the operator's placeholder, and the deploy gate still refuses to publish it —
which is now the *only* thing standing between this tree and a production publish, and that is the intended
state until the operator names the repository and approves the deploy.

## 2. What changed, file by file

### 2.1 The read gateway (`gateway/read/production/`)

| File | Change |
|---|---|
| `ops/environments.json` | production's `exposure` is `workers_dev`, not `route`. The `routes` array (whose only entry was the placeholder `REPLACE-WITH-THE-GATEWAY-HOST.example.com`) is gone. The notes now say why the shared zone is safe: distinct Worker names, distinct key ids, distinct repositories, no wildcard routes. |
| `ops/render-environments.py` | The rule *"production may not be exposed on workers.dev"* and the rule *"production declares no route"* are **replaced**, not deleted: the renderer now checks that every environment declares how it is exposed (`none`, `workers_dev` or `route`), that a `route` exposure has a route, that **no route is a wildcard**, and that **an environment has exactly one host** (a `workers_dev` exposure may not also declare a route). |
| `ops/environments.md` | The environments table, the separation section, the rules table, "what the operator has to fill in" and "what is not done here" all follow. The last of those was stale in a way this change had to fix: it said *"No environment has been published"* — the staging deployment **is** published and was exercised on 2026-11-05. |
| `wrangler.toml` | **Regenerated** by the renderer (`python3 ops/render-environments.py`), not edited by hand. |

### 2.2 The write gateway (`gateway/write/`)

| File | Change |
|---|---|
| `wrangler.toml` | the top-level `workers_dev = false` → **`workers_dev = true`**. The top-level table *is* the production deployment; the staging environment keeps its own `workers_dev = true`. The comment above it explains the F0-070 trap (a `workers_dev` written after `[vars]` is a variable and does nothing) and what now holds the shared zone safe. |
| `scripts/check-staging-separation.py` | The check *"production is not exposed on workers.dev"* becomes *"production is exposed on workers.dev (ADR 0008, decision 2), and the setting says so"*. The read half's *"production is reachable on one named host only"* check (which asserted a route existed) is replaced by *"production declares no route of its own: it has exactly one host"*. The docstring's list of what the gate checks was rewritten, because the gate's purpose changed. |
| `scripts/check-production.py` | The same change to the production gate's `workers_dev` check. |
| `docs/protocol.md` §12.5, §12.5.1 | The **contract** pinned `workers_dev: false in production`. It is normative, so it had to change with the configuration: the setting is `true`, the host is the worker's own, and a new paragraph states what a shared zone is held safe by. |
| `docs/security-checklist.md` item 27 | The requirement was *"no `workers.dev`, explicit routes"*. It now states the exposure, the host and the separation. |
| `docs/operator-runbook.md` §7.1 | The operator-facing table follows the contract. |
| `ci/staging-separation.yml` | The header comment described the gate's second check; it now describes what the gate actually does. |

### 2.3 Repository documents that stated the old rule

| File | Change |
|---|---|
| `docs/release/PRODUCTION-WORKFLOWS.md` | *"the gates still require `workers_dev = false`"* → the gates no longer do, and the shared-zone mitigations are what holds the zone safe instead. |
| `docs/release/DEFECT-REGISTER.md` — R0-008 and its stage-ownership row | R0-008 was *"Worker deployment defaults not pinned"*, and its row said *"production is not exposed on workers.dev"*. Both now record the change and what replaced the rule. **The `compatibility_date` half of R0-008 stays open** — both gateways still pin `2025-09-01`, and a deliberate bump belongs to BE-4 and BE-5. |

### 2.4 What was **not** changed, and why

| Place | Why not |
|---|---|
| The production `GITHUB_REPO` (`OWNER/REPO`) and the write gateway's `SUBMISSIONS_REPO` | They are the operator's to name (DX-1). The deploy gate refuses to publish while they are placeholders, and that refusal is now the **only** thing between this tree and a production publish — which is the intended fail-closed state. |
| `docs/decisions/0001`, `0002`, `0008` | Decision records. ADR 0001 already says *"`workers.dev` hostnames are used for all environments for now"* — this change makes the gates agree with it. ADR 0002 requires the host to be named in the work order, not that it be operator-owned. |
| The staging configuration | Unchanged. Staging was already on `workers.dev`. |
| `ctxgate-v1`, `ctxwrite-v1`, `ctxop-v1` | Domain separators, not hosts. |
| The gateways' own version constants | A component version, not a deployment default. Recorded as a BE-8 item in work package 3. |

## 3. The shared-zone mitigations (ADR 0008, item 4), and where each one is now checked

| Mitigation | Checked by |
|---|---|
| **1. distinct Worker names per gateway and environment** | `check-staging-separation.py` (both halves): *"staging is a different Worker, so its Durable Object namespaces are its own"*. Distinct names also mean distinct hosts, because a Worker is served at `<worker-name>.<account-subdomain>.workers.dev`. |
| **2. distinct signing keys and distinct GitHub credentials per environment** | The key ids are disjoint and checked (*"staging and production share no key id"*). The credentials are per environment by construction: they are `wrangler secret put --env <env>` values, and `environments.json` lists each environment's secrets separately. |
| **3. no wildcard routes** | **New check** in the renderer: *"<env> declares a wildcard route: …"*. The read gateway's renderer is the only place a route can be declared, so this is where the rule is enforced. |
| **4. distinct destinations per environment** | `check-staging-separation.py`: *"staging writes to a different repository than production"*, *"…a different branch…"*, *"staging reads a different repository than production"*. |
| **5. links minted per environment host, so a link from one environment is not accepted by another** | The key-id disjointness is what enforces it: a staging-minted link carries `s1`, production serves `p1`, and the gateway refuses an unknown key id *before it looks at anything else* (`gateway/read/production/src/rules.ts`, check 4). The host is part of the work-order contract (ADR 0002). |
| **6. explicit operator approval for every production deploy** | Unchanged and outside this pull request: the deploy workflows run from protected environments with the operator as the required reviewer. |

**The host is no longer part of the separation.** That is the point of the change, and it is why item 5 is
now carried by the key ids rather than by the host.

## 4. Checks run in this session

| Command | Result |
|---|---|
| `python3 ops/render-environments.py --check` (read gateway) | `wrangler.toml matches ops/environments.json, and the configuration is valid.` |
| `python3 ops/render-environments.py` (read gateway) | `wrote …/gateway/read/production/wrangler.toml` — the file is **generated**, not hand-edited |
| `bash ops/bundle-check.sh` (read gateway) | `test ok`, `staging ok`, `production ok` — "the Worker builds for every environment, and every configuration is understood." |
| `npm run typecheck` (write gateway) | exit 0, no output — the three programs |
| `npm run check:contract` (write gateway) | `OK: the contract documents agree` |
| `npm run check:staging` (write gateway) | `OK: the write staging environment is separate from production` |
| `npm run check:staging:read` (write gateway) | `OK: the read staging environment is separate from production` |
| `npm run check:bundle` (write gateway) | `--dry-run: exiting now.` — the bundle builds |
| `npm run test:unit` (write gateway) | `# tests 255` — `# pass 255`, `# fail 0` |
| `npm run test:integration` (write gateway) | `# tests 85` — `# pass 85`, `# fail 0` |
| `npm test` (read gateway) | `# tests 20` — `# pass 20`, `# fail 0` |
| `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |
| `python3 conformance/harness/run.py all --reference` | `94 passed, 0 failed` |
| `release/test-release.sh` | `94 passed, 0 failed` |
| `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| `python3 gateway/write/scripts/check-production.py` | `production check: FAILED (1)` — **the pre-existing placeholder refusal**: *"the production submissions repository is named (not a placeholder)"*. This script is **not** run by CI, by its own docstring: *"It is NOT run by CI, because the placeholders are expected to be there until the operator names the production destination; it is run by the deploy and production-init workflows, where a placeholder must stop the run."* Every other check in it passes, including the new `workers_dev` one. |

### 4.1 The gates were proved to fail when they should

A gate that has never been seen to fail is not known to be a gate. Four regressions were planted in scratch
copies of the tree (never in the working repository) and the gates were run:

| Regression planted | Result |
|---|---|
| the write gateway's production `workers_dev` reverted to `false` | `FAIL production is exposed on workers.dev (ADR 0008, decision 2), and the setting says so` → `FAILED: 1 check(s)`, exit 1 |
| the read gateway's production given a wildcard route `*.qnuralink.workers.dev` | `configuration is invalid: production declares a wildcard route: '*.qnuralink.workers.dev'` → `refusing to render` |
| the read gateway's production `exposure` removed | `configuration is invalid: production does not declare how it is exposed (one of none, workers_dev, route)` → `refusing to render` |
| the read gateway's production given **both** `workers_dev` and a route | `configuration is invalid: production is exposed on workers.dev and declares a route as well: an environment has exactly one host, and the host is part of the work-order contract` → `refusing to render` |

The fourth case is a rule this pull request **added**: an environment with two hosts would make the host
ambiguous, and the host is part of the work-order contract.

## 5. Deviations from the brief's file list, and why

The brief names `render-environments.py`, `environments.json`, `environments.md` and "the write gateway's
production `workers_dev` setting". Those four are all changed. **Eight more files were changed, and the
reason is that leaving them would have made the repository contradict itself or made CI red:**

| Extra file | What happens if it is not changed |
|---|---|
| `gateway/write/scripts/check-staging-separation.py` | CI's `write-gateway-staging-separation` job **fails**: it asserts `workers_dev is False`. |
| `gateway/write/scripts/check-production.py` | The production deploy gate refuses every production deploy. |
| `gateway/write/docs/protocol.md` §12.5 | The **contract** (normative, and the single authority for the write protocol) keeps saying `workers_dev: false in production` while the configuration says `true`. |
| `gateway/write/docs/security-checklist.md` | The checklist keeps requiring *"no `workers.dev`"* — a requirement the operator has now declined. |
| `gateway/write/docs/operator-runbook.md` | The operator's runbook tells the operator to pin `workers_dev: false`. |
| `gateway/write/ci/staging-separation.yml` | The gate's own definition file describes a check that no longer exists. |
| `docs/release/PRODUCTION-WORKFLOWS.md` | Says the gates still require `workers_dev = false`. |
| `docs/release/DEFECT-REGISTER.md` (R0-008) | The register's stage-ownership row says *"production is not exposed on workers.dev"*, which is the gate's old rule, in the register that holds the gate's rules. |

## 6. Risks and unresolved questions

**Risks.**

- **Production on a public `workers.dev` hostname is a wider exposure than a named host.** The operator
  chose it, with the shared-zone mitigations in place. What the change removes is the guarantee that
  production is reachable on *one named host only*; what it keeps is the guarantee that a link minted in
  one environment is refused by another, and that the operator approves every production deploy.
- **The gate now pins a hosting decision rather than a security property.** Before this change the gate
  said "production must not be on workers.dev"; now it says "production must be on workers.dev". Both are
  the gate enforcing a signed decision (ADR 0008). A follow-up ADR that moves production to an
  operator-owned domain has to amend the renderer and the two gate scripts, and the agent has recorded
  that rather than leaving it implicit.
- **The production deploy is one placeholder away from happening.** The `workers_dev = true` change
  removes the gate that used to stop it, and the repository placeholder is now the only thing that does.
  The operator's approval gate at run time is unchanged, and the production deploy workflow is manual.

**Unresolved questions:**

- The production `GITHUB_REPO` and the write gateway's `SUBMISSIONS_REPO` and branch are still the
  operator's placeholders. **The production deployment cannot proceed until they are named** (BE-4, BE-5).
- R0-008's `compatibility_date` half is still open: both gateways pin `2025-09-01`, and a deliberate bump
  belongs to the deployment stages.
- ADR 0008 item 2's remaining condition — *"the exact per-Worker hostnames are fixed at first deployment and
  recorded then"* — is still open for production. The names the operator gave (DX-2) are recorded in
  `docs/release/COMPATIBILITY-MATRIX.md` §6, and they will be confirmed at the first production deploy.

## 7. What the agent needs before the next stage

- **The operator's production decisions**, for BE-4 and BE-5: the production read repository, the write
  gateway's submissions repository and branch, the production signing keys, the operator tokens and the
  GitHub credentials (read-only for the read gateway; limited to the submissions repository for the write
  gateway). None of them is in this repository and none of them can be applied from it.
- **The operator's approval at run time for every production deploy.**
- The operator merges; the agent does not merge, tag or release.
