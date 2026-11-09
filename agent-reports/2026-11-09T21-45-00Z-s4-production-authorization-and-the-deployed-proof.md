# S4 work package — the operator's authorization for the production half, and the deployed proof's fix

- **Stage:** S4 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-4)
- **Branch:** `s4/production-authorization` — **pull request #55** (open; CI 7/7 green)
- **Baseline:** `main` at `608155f` — *"Merge pull request #54 from inscope-labs/s4/read-gateway-staging-acceptance"*,
  merged by the operator on 2026-11-09. `VERSION` = `0.5.0`.
- **Run:** 2026-11-09T20:10Z → 2026-11-09T21:45Z
- **Scope:** `docs/decisions/0013-rollout-authorizations.md`, `gateway/read/production/ops/environments.json`,
  `gateway/read/production/wrangler.toml`, `ops/state-failure-probe.py`,
  `.github/workflows/staging-state-failure.yml`, `release/rollout-gate.sh`, `docs/release/`.
  **No merge, no tag, no publication, no production deploy, and no change to any GitHub
  environment's protection rule or secrets.** The only deployment this run performed was the
  **staging** one the state-failure proof needs, and the proof's restore step put the good
  build back.

## 1. Intent

The operator answered S4's four unblock questions in a filled `S4-UNBLOCK-QUESTIONS.md` and
said *"go ahead and complete the assignment"*. The answers were: **A** for the approver (a
second personal account, login `inscope-xlabs`), **A** for the production repository
(`acme-pilot-dev`, allowlist `amk/,plans/*/package/`), **A** for the credential's scope, and
**all four** authorizations granted.

**The answer to "can S4 complete?" is: the repository's half is now done and in review; the
production deploy is blocked on two things that only the operator can do, and one of them
turned out to be a factual error in the answer rather than a task.**

## 2. What the answers made possible, and what was applied

| # | Task | Done | Evidence |
|---|---|---|---|
| 2.1 | Record the approver's login in ADR 0013 | **done** | `docs/decisions/0013-rollout-authorizations.md` gains an addendum: the approver's login, the four authorizations, the production repository, and the credential's scope. The two conditions the ADR carried (the login, the separate identity) are now met; the token-revocation condition still stands. |
| 2.2 | Name the repository the production gateway reads | **done** | `gateway/read/production/ops/environments.json`: production's `GITHUB_REPO` is now `acme-pilot-dev` instead of the placeholder `OWNER/REPO`; `wrangler.toml` is re-rendered from it. `--assert-deployable production` now answers *"the 'production' environment is ready to deploy"*. One line in each file. |
| 2.3 | Make the gate read the recorded login precisely | **done** | `release/rollout-gate.sh`'s lookup was `grep '\*\*login'` over the whole ADR, which would have matched any backticked word on any line mentioning "login". It now reads the one line the addendum's convention defines. Verified both ways: with the addendum it yields `inscope-xlabs`; **without** it (the ADR as it was before) it yields nothing, so the gate cannot false-pass. |
| 2.4 | Write the `production` environment's required-reviewer rule | **not done — blocked** | GitHub's rule takes a numeric user id. `GET /users/inscope-xlabs` answers **404**: the account does not exist. There is a pending collaborator invitation (id `342406426`, `write`, created `2026-11-09T10:53:04Z`) whose `invitee` is `null` — it was sent to an address, so no user id exists for it yet. Naming `inscope-labs` as the reviewer would satisfy the API and defeat ADR 0013 item 6: the gate would approve itself. |
| 2.5 | Dispatch `production-init` and the production deploy | **not done — blocked** | Both need 2.4 (the environment's reviewer) and the production environment's values (2.6). Dispatching them now would publish without a human, which is the failure ADR 0008's approval gate exists to prevent. |
| 2.6 | Check the production environment's provisioning | **done — and the answer is that it is unprovisioned** | With the scope the operator granted, all four secret and variable listings answer 200. The `production` environment has **no secret and no variable**. The `staging` environment has nine secrets and the variable `DELIVERY_PUBLIC_KEY`. **Names only; no value was read, printed or stored** (ADR 0013 item 4). |
| 2.7 | Run the deployed state-failure proof | **run, and it failed** | Run **42701286443**. The restore step ran, the good build was published again, and the gateway serves. The failure was the stage's most useful result: see section 3. |

## 3. The two findings

### F0-078 — The proof asked the gateway before the failure was live

The first run of the deployed proof answered `403` where the proof expected `503
state-unavailable`:

    the unsigned request answered 403: forbidden (link invalid, expired or revoked)
    FAIL the request is refused with 503, not served
    FAIL the refusal names state-unavailable (forbidden (link invalid, expired or revoked))

**The cause was not the gateway.** Cloudflare's default Durable Object code-update strategy is
`deferred`, with a maximum delay of 300 seconds: an object that is already running keeps
running the **old** code after a deploy, so the planted constructor throw was never executed
for the object that was actually serving. The workflow deployed and asked the gateway within
about half a second, so it reached a *healthy* store. The gateway was right to answer `403`:
it could read its state and had no reason to answer `503`. A naive reading of the failed run —
"the gateway did not fail closed" — would have been the opposite of the truth.

The fix keeps the plant unchanged (**the state store itself is still the thing that is broken**)
and fixes the two things that were wrong about the *proof*: it now waits for the planted failure
to become live, for longer than the vendor's maximum delay (`--wait 420`), and it prints every
attempt so a run that times out says what the gateway answered and when. It also asks the
operator channel — the one route that reaches the state store directly — so the evidence
distinguishes *"the gateway refused"* from *"there was nothing to read"* (`--check-admin`).

Verified locally against the live healthy gateway: `--expect 403` passes; `--expect 503`
waits and then fails with the gateway's **real** answer rather than a stale one.

### F0-079 — The run's summary asserted the conclusion instead of reporting it

The summary step ran with `if: always()`, so it ran after the failed probe too, and its text
stated the conclusion as fact: *"It answered 503 state-unavailable instead of serving it"*. A
failed run left a summary in the run's record saying the proof had passed. It now reports
`steps.probe.outcome` and `steps.restore.outcome` explicitly and claims nothing it did not
observe.

### A third defect, found while fixing the first

`S4-APPROVAL` read the most recent production *deployment record* and asked about the run
behind it. That record is not always the run that would publish production: before S3 hardened
the workflows, production deploys were push-triggered, and several of those records still
exist, all failed, all from a workflow that can no longer deploy. The gate therefore named a
six-day-old push-triggered run and reported that it had no environment approval, when the truth
is that production has not been deployed at all. The check now selects the run by the workflow
that published it.

## 4. The gate, as it stands

`release/rollout-gate.sh S4` — **26 PASS, 3 FAIL, 2 BLOCKED-EXTERNAL** (exit non-zero), on
`40ea687`:

| Check | State | Why |
|---|---|---|
| `S4-PROD-CONFIG` | **PASS** (was BLOCKED-EXTERNAL) | the production configuration is deployable |
| `S4-STAGING` | PASS | the deployed staging gateway answers and serves the committed staging key ids (`s1`) |
| `S4-PROBES` | PASS | 7/7 against the deployed gateway |
| `S4-STATE-FAILURE` | **FAIL** (new) | the proof run concluded `failure`. The check exists to refuse to count a failed proof as a proof. |
| `S4-APPROVAL` | **FAIL** | the production read gateway has not been deployed yet |
| `S4-SECRETS` | BLOCKED-EXTERNAL | secret names **absent** from `production`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CTXGATE_BASE_URL`. **This check used to say the list could not be read; with the operator's scope it now says what is actually missing.** |
| `S4-WORKER-SECRETS` | BLOCKED-EXTERNAL | no Cloudflare credential in the agent's environment (names only, by ADR 0013 item 4) |
| `C-CI` | **FAIL** | the failed proof run is the latest check run on `main`'s tip, and `C-CI` requires every check run on the tip to have concluded `success`. **The tip of `main` is red because of it.** |

`C-CI` failing is the gate telling the truth, not a defect: a failed run on `main` is a red
mark on `main`. Merging PR #55 lands a green `test` run on `main`, and re-running the proof
after the fix lands a green one too.

## 5. What is the operator's, and in what order

1. **Merge PR #55.** It carries the ADR addendum, the production configuration, the gate's two
   corrections and the proof's fix. CI is 7/7 green. **The agent never merges** (G-12).
2. **Create the `inscope-xlabs` account and accept the invitation** (id `342406426`, `write`).
   GitHub's required-reviewer rule takes a numeric user id, and there is none until the account
   exists. The agent cannot create a GitHub account.
3. **Set the `production` environment's values**: the secrets `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `CTXGATE_BASE_URL`, `READ_GH_TOKEN`, `WRITE_GH_TOKEN`, and the
   variable `DELIVERY_PUBLIC_KEY`. GitHub has no API for a secret's value and ADR 0013 item 4
   says the agent never handles one. `staging` shows the shape of a provisioned environment.
4. **Re-run the state-failure proof** once 1 is merged, so the S4 exit gate's
   `S4-STATE-FAILURE` can pass.

Then, and only then, the agent: writes the protection rule naming `inscope-xlabs`; dispatches
`production-init` (`target: read`, `create_if_missing: yes`, from `main`); the operator decrypts
the delivery bundle with the delivery private key; the agent dispatches the production deploy;
**the operator approves it as the reviewer**; and the agent runs the S4 exit-gate checks
against the deployed production gateway.

## 6. Credential hygiene

- The session credential was supplied twice in this session and was **never** written into the
  repository, a fixture, a URL, a workflow file, a log, a report or this file. It lives only
  in `/workspace/.gh-token` (mode 600) and in `/workspace/.askpass.sh`, which reads it for
  `git push` so that it never appears in a remote URL or in `.git/config`. The remote URL is
  `https://github.com/inscope-labs/build-engine.git` — clean.
- The credential's scope changed mid-session: the first token answered **403** on every secret
  and variable listing, the second answers **200**. The credential still authenticates as
  `inscope-labs`, which is the dispatching identity and therefore cannot also be the reviewer.
- **The operator revokes the exposed tokens at the end of this assignment** (ADR 0013 item 5).
  The copy in the sandbox is the operator's to revoke.
- `C-SECRETS` scanned the tree and the diff against `origin/main` on every gate run: **no
  credential shape** in 380 files.

## 7. Commands run, and what they answered

| Command | Answer |
|---|---|
| `GET /users/inscope-xlabs` | **404** — the approver's account does not exist |
| `GET /repos/…/collaborators` | one account with access: `inscope-labs` (admin), which is the dispatching identity |
| `GET /repos/…/invitations` | one pending invitation, `write`, `invitee: null` — sent to an address, so no user id |
| `GET /repos/…/environments/production/secrets` | **200**, and **no secrets** (was 403 before the scope was granted) |
| `GET /repos/…/environments/staging/secrets` | **200**: nine names, and the variable `DELIVERY_PUBLIC_KEY` |
| `GET /repos/…/environments/production` | `protection_rules: []` — unchanged, because the reviewer does not exist |
| `python3 ops/render-environments.py --assert-deployable production` | **exit 0** — "the 'production' environment is ready to deploy" (was exit 1) |
| `POST /actions/workflows/staging-state-failure.yml/dispatches` (`ref: main`) | **204** → run **42701286443**, **failure** |
| the run's transcript | the proof asked before the planted failure was live; the restore step ran and the gateway serves |
| `python3 ops/state-failure-probe.py --base-url … --expect 403` | **PASS** (the healthy gateway) |
| `python3 ops/state-failure-probe.py --base-url … --expect 503 --wait 35` | **FAIL, honestly**: it waited, then reported the gateway's real answer |
| `curl https://ctxgate-read-staging.qnuralink.workers.dev/healthz` | `{"status":"ok","key_ids":["s1"], …}` — the good build is published again |
| `curl https://ctxgate-read.qnuralink.workers.dev/healthz` | **404** — production is still not deployed |
| `release/rollout-gate.sh S4` | **26 PASS, 3 FAIL, 2 BLOCKED-EXTERNAL** |
