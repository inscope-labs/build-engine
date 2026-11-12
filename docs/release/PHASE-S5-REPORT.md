# Stage S5: write gateway — staging acceptance and production (BE-5)

**Stage:** S5 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (build plan BE-5).
**Entry gate:** S3 PASS (`main` carries S3's hardening). **The entry gate's three `[E]`
conditions are met** — section 0 shows how each was verified.
**Baseline:** `main` at `c88bca9`. `VERSION` = `0.5.0`.
**Branch:** `s5/write-gateway-acceptance`. **Pull request:** see section 6.
**Scope:** `ops/staging-pilot.py`, `ops/staging-estate.py`, `ops/staging-estate.json`,
`.github/workflows/staging-pilot.yml`, `release/rollout-gate.sh`, `docs/release/`.
**No merge, no tag, no publication.** Every production run waits at the environment's approval
prompt, and the agent never clears it.

---

## 0. The entry gate, condition by condition

The plan's `[E]` conditions for S5, and how each one was verified. **This stage did not take
any of them on trust.**

### 0.1 The submissions repository, the branch and the task folders exist

ADR 0012 recorded `acme-pilot-dev` for **both** the read repository and the submissions
repository, and the S5 entry gate requires the submissions repository to be distinct from the
read and consumer repositories — *"unless the operator has recorded a new decision accepting
that or naming a separate repository, this is BLOCKED-EXTERNAL"*.

**ADR 0014 is that decision**, and it is **decided (2026-11-10)**: *"Two repositories per
plan"*, the weaker separation accepted, the submissions branch named `submissions`, the
submissions repository `inscope-labs/acme-pilot-dev`, the consumer `inscope-labs/acme-pilot`,
and the read and write tokens scoped to the development repository alone.

Verified by API read, from the agent's own credential:

| | Result |
|---|---|
| the submissions repository | `inscope-labs/acme-pilot-dev` — **present**, private, default branch `submissions` |
| the branch | `submissions` — **present**, head `5708275` |
| the task folders | `plans/acme-pilot/submissions/10001-S001` — **present** |
| the consumer repository | `inscope-labs/acme-pilot` — **present**, public |

The gateway **never creates** the branch or the folders, so their existence is the operator's
to establish and this stage's to read.

### 0.2 The write credential reaches the submissions repository only

The plan requires this *"verified from the token's repository list through the API using the
configured secret **inside the workflow**, never printed"*. The operator built that check
(`verify-write-credential-scope.yml`) and ran it; the last run, **42949381010**, **succeeded**:

```
- submissions repository (from the gateway configuration): `inscope-labs/acme-pilot-dev`
- consumer repository: `inscope-labs/acme-pilot`
- repositories_listed: 31
- submissions_repository_listed: True
- submissions_repository_writable: True
- consumer_listed: True
- consumer_writable: False
- other_repositories_probed: 29
- other_writable: 0
- other_private: 0
Result: PASS
```

The credential can write the submissions repository, **cannot** write the consumer repository,
and reaches nothing else. The gateway therefore has no access to the consumer repository.

### 0.3 The write gateway's production secrets exist by name

`check-production.py` passes on `main` — every check, including the one that failed three days
ago:

```
ok   the production submissions repository is named (not a placeholder)
ok   the production submissions branch is named
ok   the production key ids are declared
ok   production does not declare the staging guard
ok   staging is a different Worker from production
ok   production and staging share no key id
ok   production does not write to the staging destination
production check: OK
```

And the `production` environment holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`CTXGATE_BASE_URL`, `READ_GH_TOKEN` and `WRITE_GH_TOKEN` — **names only**; no value was read,
printed or stored (ADR 0013 item 4).

### 0.4 What the entry gate did **not** need

S3's `[E]` condition — the `production` environment's required reviewer — is met: the rule
names `inscope-xlabs`, `can_admins_bypass` is `false`, and `prevent_self_review` is `true`.
ADR 0013 records that login, so the approval gate is real.

---

## 1. The compatibility-date review (R0-008's open half for the write gateway)

`docs/release/COMPATIBILITY-DATE-REVIEW-WRITE.md`. A review and a recommendation; **the
decision is the operator's and nothing has been applied.**

The short answer: **bump the date to the deployment date, and keep the runtime's surface
exactly as it is today** with `compatibility_flags = ["no_nodejs_compat",
"no_nodejs_compat_v2"]`. Cloudflare supports old dates forever, so there is no deprecation
pressure; the one behaviour a bump brings is the Node.js compatibility layer switching on by
default, and this gateway's bundle uses none of it.

What differs from the read gateway's review, and why it is not a copy of it:

- **The write gateway holds two Durable Object classes** — `TaskSession` and `AuditStream` —
  and a bump cannot invalidate either, because a migration is keyed by its tag and class.
- **The write gateway holds the record of decisions about work**: a seal and an audit trail.
  So the proof is stronger than the read gateway's: **a task sealed before the bump must still
  be sealed after it**, and the audit stream must still carry the commit, the seal and the
  revocation.
- **The `node:` imports are real, and they are not in the bundle.** `scripts/` uses
  `node:fs`, `node:path` and `node:url` — those run under Node in CI. The Worker's entry is
  `src/index.ts`, `src/` imports no `node:` module, and its crypto is WebCrypto
  (`crypto.subtle`). The bundle check builds the Worker for every environment, so a script
  that found its way into the bundle would show up there.
- **The change is two lines in one committed file.** The write gateway's `wrangler.toml` is
  committed directly; the read gateway's is generated.

---

## 2. The staging half

### 2.1 The deploy

Run **42975489428**, `deploy-write-gateway-staging.yml`, from `main`: **success**. Both jobs
green — the gate (typecheck, the whole test suite, the contract documents, the log-hygiene
gate, the static staging separation) and the publish (the bundle builds, the staging Worker
has its secrets, the deploy, and *the published gateway is the staging one*).

The staging write gateway answers at `https://ctxgate-write-staging.qnuralink.workers.dev`:
`{"status":"ok","protocol":"ctxwrite-v1","deploy_env":"staging","policy":{"key_ids":["sk1"]}}`.

### 2.2 The deployed probes

Twelve checks against the two deployed staging gateways, run both locally and as a recorded
run (**42975698144**, `staging-pilot.yml` in `probes-only` mode: **success**):

- both gateways are reachable and answer `200`;
- the read gateway serves key id `s1`, the write gateway `sk1`;
- the separation gate passes for both;
- a link with a bad signature is refused (403), and so is one for an unknown order;
- the read and write **audit** and **revocation** channels refuse an unauthenticated caller
  (401).

The probes-only mode needs no secret, so it is repeatable. The signed leg is not — and
section 3 says what had to change for it to be.

---

## 3. The signed pilot: what had to change first

The signed leg is the exit gate's core evidence — *"Real delivery to a disposable submissions
repository; sealing blocks further writes; revocation ends access; each is a recorded run with
evidence"*.

**It could not be re-run as it stood.** The pilot's identifiers are hard-coded
(`PLAN_NUMBER = "10008"`, and the task ids derived from it), and the first deployed run
(41964576712, 2026-11-05) **revoked** that order and that task in the deployed Durable
Objects. A seal and a revocation are durable by design — the script's own docstring says the
run *"is NOT repeatable against a deployed target"* and *"the second run has to use a fresh plan
number (and the estate re-seeded for the new task folder)"*.

So the identifiers are now **derived from one number, and the number is an argument**:

- `ops/staging-pilot.py --plan-number N` derives the order id, the three task ids and the
  wrong-order probe's order id from `N`;
- `ops/staging-estate.py seed --plan-number N` derives the task folder from the same `N`,
  using the shape the record holds, so the folder the gateway commits into and the folder the
  pilot computes come from one place and **cannot disagree** — the gateway never creates the
  folder (protocol section 12.3), so a disagreement would be refused rather than worked
  around;
- `.github/workflows/staging-pilot.yml` takes a `plan_number` input and **seeds the estate for
  that number before the pilot runs**, so the run is self-contained and the number cannot
  disagree with itself.

Verified locally before proposing it: the estate seeds for `10009`, the branch then holds
`plans/pilot-001/submissions/10009-S001`, and the probes pass with the new number.

**And then the whole signed workflow was run end to end against the local runtime**, on its
own plan number so that the deployed run's number was not burned: `THE PILOT PASSED`
(**42 checks**) — the file scaffolded, the chunk staged, the three refusals (a denied file
type, a path outside the task folder, a file over the size limit), the staged content read
back byte for byte, the commit landed, the retry a replay and not a second commit, the
branch head the commit, the task sealed, a write after the seal refused, the order and both
tasks revoked with their capabilities stopping, and the audit records holding **no** secret,
no content and no signature.

That run is the validation, not the evidence: the exit gate asks for the pilot against the
**deployed** gateway, and that run needs the merged parameterisation.

---

## 4. The gate, so that S5's exit gate means something

`release/rollout-gate.sh S5` gained the stage's own checks, modelled on S4's:

| Check | What it holds the deployment to |
|---|---|
| `S5-PROD-CONFIG` | `check-production.py` passes — a named submissions repository and branch, declared key ids, and staging separate from production |
| `S5-STAGING` | the deployed staging write gateway answers, **reports itself as the staging one**, and serves the **committed** staging key ids (`sk1`) |
| `S5-PROBES` | the deployed write gateway refuses what it must (the pilot's own probes, against the published Worker) |
| `S5-APPROVAL` | the production run shows an environment approval by a login ADR 0013 records, and that login is not the identity that dispatched it |

**One thing had to be corrected in S4's version of the approval check as well.** It identified
the production run by its workflow path — which is enough for the read gateway, whose stale
production records come from a *different* workflow. For the write gateway the stale records
are runs of **the same** `deploy.yml`, push-triggered, from before S3 hardened it. The check
now requires three facts together: the workflow, the **event** (`workflow_dispatch` — the
hardened workflow runs by hand and nowhere else) and the **branch** (`main` — it publishes from
`main` only). Both checks now say *"the production gateway has not been deployed yet"* rather
than naming a six-day-old push-triggered run.

---

## 5. Not done, and not verified

*This section was written when the stage's pull request was opened. **Section 7 records what
happened next**; the items below are kept as they were written, because a report that is edited
to look finished is not a report.*

- **The signed pilot has not been run in this stage.** It needs the change in section 3 to be
  merged, and then a run against the deployed staging gateways, which consumes the plan number
  it uses.
- **The production write gateway has not been deployed.** `ctxgate-write.qnuralink.workers.dev`
  answers **404**. `production-init` for the write half and then the write gateway's
  production deploy are both outstanding, and both wait at the environment's approval prompt.
- **The read gateway's production deploy has not been published through the reviewed path.**
  The production read Worker exists (the `production-init` run created it and set its
  secrets), but `deploy-read-gateway.yml` has never published to `production`, so S4's
  `S4-APPROVAL` is still open. That is S4's item and the operator's to sequence.
- **The privacy scan over the production logs** cannot be run until there are production logs.

---

## 6. The pull request

One pull request carries the stage's code: the parameterisation of the pilot's identifiers,
the workflow's `plan_number` input and its seeding step, the estate record's task-folder
shape, S5's gate checks, the correction to S4's approval check, the compatibility-date review
and this report. **The operator merges it** (G-12); the agent never merges.

**Pull request #65, merged by the operator on 2026-11-11** (`9982ece`).

---

## 7. After the report: the stage completed (2026-11-12)

Everything section 5 listed as outstanding has since happened. It is recorded here, and in
`docs/release/GATE-2-SUMMARY.md`, which is the exit gate's own item.

| | What | Run |
|---|---|---|
| the signed pilot, against the **deployed** staging gateways | **`THE PILOT PASSED` — 44 checks**: the delivery, the seal, a write after the seal refused, the revocation of the order and of both tasks, and the audit records holding no secret, no content and no signature | **43120286426** |
| the write gateway's **production** deploy | **success**; the production gateway answers `200`, reports `deploy_env: production`, serves the committed production key ids (`k1`) and writes to ADR 0014's repository and branch | **43209697603**, approved by `inscope-xlabs` |
| the read gateway's **production** deploy | **success**; the production gateway answers `200` and serves the committed production key ids (`p1`) | **43211834638**, approved by `inscope-xlabs` |
| the privacy scan over the captures | **0 hits** over six run logs, eight credential shapes and three content fixtures — with a positive control proving the scan can fail | see `GATE-2-SUMMARY.md` |

The gate, after the two new production-deployment checks were added:

| Stage | Result |
|---|---|
| S4 | **7 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** (`S4-WORKER-SECRETS`) |
| S5 | **6 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** (`S5-WORKER-SECRETS`) |

**The one condition both stages still cannot close is the same one**: the check that reads the
deployed Workers' secret names needs the Cloudflare credential, and the agent does not hold it
(ADR 0013 item 4). It is the operator's check to run, and it is one command.

### 7.1 What this stage found, and what it cost

**The pilot's identifiers were hard-coded, and a deployed pilot is single-use.** The first
deployed run revoked its own order and task in the deployed Durable Objects, and a seal and a
revocation are durable by design. The parameterisation in section 3 is what made the second run
possible, and it cost a plan number rather than a stage.

**The approval check named a stale run.** For the write gateway, the production deployment
records that predate S3's hardening are runs of the *same* workflow, push-triggered, and every
one of them failed. Identifying the production run by its workflow path alone was therefore not
enough, and the check said so by naming a six-day-old push run.

**A probe that hard-codes one environment's key id can only ever be pointed at that
environment.** The deployed probe built its bad-signature URL from the staging key id, so it
could not ask the production gateways the question at all. It now reads the key id from the
deployment's own `/healthz`, and it asks the separation question of the environment it is
pointed at — the staging gate for staging, and the committed production configuration for
production. The production pair now answers **21 checks**, all passing.
