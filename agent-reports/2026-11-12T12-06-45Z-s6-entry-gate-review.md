# S6 entry-gate review — and the work that unblocks it

- **Question asked:** *"confirm S6 can be executed now"*
- **Answer:** **No — not the implementation.** S6's entry gate has two conditions and **both are
  unmet**: S5 is not yet a PASS, and the `[O]` ADR approving the transfer design does not exist.
  One of them the agent may do the first half of; the other is the operator's alone.
- **Stage reviewed:** S6 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-6, R0-011 for Standard)
- **Baseline:** `main` at `6aa8854` — *"Merge pull request #66 from inscope-labs/fix/write-worker-name-ctxgate-write"*
- **Run:** 2026-11-12T11:00Z → 2026-11-12T12:10Z
- **Scope:** `ops/`, `release/rollout-gate.sh`, `docs/decisions/`, `docs/release/`.
  **No merge, no tag, no publication, no production deploy, no approval, and no change to any
  environment, protection rule or secret.**

## 1. The entry gate, condition by condition

> **Entry gate:** S5 PASS. `[O]` ADR approving the transfer design (Q-CB-2 answered) exists on
> `main`. Without it the agent may write the design as a draft ADR but may not implement:
> **BLOCKED-EXTERNAL.**

### 1.1 "S5 PASS" — not yet

The stage's gate is clean, and one condition is outside the agent's reach:

| | Result |
|---|---|
| `release/rollout-gate.sh S5` | **6 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** |
| `release/rollout-gate.sh S4` | **7 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** |

The single unmet condition in both is `*-WORKER-SECRETS`: the check reads the **deployed
Workers' secret names** through the Cloudflare API, and the Cloudflare credential is not in the
agent's environment — ADR 0013 item 4 says the agent does not hold it and is not given it. It
is one command for the operator, and the agent did not ask for the credential.

The plan's own S5 exit-gate items are now all but one archived:

| Item | State |
|---|---|
| real delivery, sealing blocks further writes, revocation ends access | **done** — the signed pilot against the deployed gateways, run **43120286426**, `THE PILOT PASSED`, **44 checks** |
| the privacy scan over the captured staging and production logs | **done for the captures the agent can reach** — **0 hits** over six run logs (see §3); the platform's own Worker logs are the operator's export |
| GET-only protections tested on the deployed route | **done on staging** (the 58-case suite, and the deployed refusals); the published **production** Worker has the secret-free half only, because the suite mints capabilities with the production signing key — the operator's |
| production approval evidence as in S4, `check-production.py`, staging separate from production | **done** — `S5-APPROVAL` PASS (run 43209697603, approved by `inscope-xlabs`, who is not the dispatching identity) |
| Gate 2 summary | **written** — `docs/release/GATE-2-SUMMARY.md` |

### 1.2 The `[O]` ADR — does not exist, and could not

**Q-CB-2 is answered.** ADR 0011 (decided 2026-11-08) closes Q-CB-1, Q-CB-2 and Q-CB-3: both
routes are supported in 0.6.0, `cbridge upload` is retired only after the console's real upload
passes OC-8, and the artifact keeps it until then. That half of the condition is met.

**The approval of the design is not.** The ADR index ends at 0014, and none of 0001–0014 approves
a transfer design: ADR 0006 puts the transfer path *in the 0.6.0 scope*, and that is all.
STATUS.md still says *"The submissions-to-consumer transfer path is not designed or built
(BE-6)"*, and the write gateway's protocol says the same — *"The transfer path and the
pre-creation tooling are register entry R0-011, and they are not yet designed."*

**The design does exist, but not as an ADR**: `docs/release/PHASE-1.1-PRODUCT-CONTRACT.md`
section 1.1.5 (2026-10-26) is a full design — the actor, the pre-conditions, the conflict
handling, the validation, the failure recovery and audit, and the authority boundary. So the
gap is precisely the gap the plan names: **the design was written, and nobody recorded the
approval of it.**

### 1.3 What the plan permits without it

*"Without it the agent may write the design as a draft ADR but may not implement."* That is
exactly what this turn did — and it is the whole of what may be done.

## 2. What was done

| # | Task | Done | Evidence |
|---|---|---|---|
| 2.1 | **Draft the transfer ADR** | **done — ADR 0015, status `open`** | `docs/decisions/0015-submissions-to-consumer-transfer.md`: the proposed decision (the actor and its operator-supplied task-scoped token; the tool in build-engine, not a gateway operation; the six-step fail-closed validation sequence; the conflict rule; the single commit plus pull request; the no-partial-writes rule; the audit record; the console's existing contracts) and **four open points that are the operator's**: which hash is authoritative, the consumer-side destination layout, the token's scope, and whether the transfer ever touches the consumer's `main` directly. |
| 2.2 | **Write the Gate 2 summary** | **done** | `docs/release/GATE-2-SUMMARY.md`: the four deployments and the run that published each, the conformance counts, the revocation and audit evidence from both environments, the privacy scan, and the four items that are the operator's. |
| 2.3 | **Make the deployed probe usable against production** | **done** | `ops/staging-pilot.py` built its bad-signature URL from the **staging** key id, so it could not ask the production gateways anything; it now reads the key id from the deployment's own `/healthz`. Its separation step now asks the question of the environment it is pointed at: the staging gate for staging, and the committed production configuration for production (`--expect-env`). The production pair now answers **21 checks, all passing**. The staging probes are unchanged in behaviour and now report 13 checks. |
| 2.4 | **Add the production-deployment checks to the gates** | **done** | `S5-PROD-DEPLOYED` — the production write gateway answers, **is** the production one, serves the committed production key ids (`k1`) and writes to ADR 0014's repository and branch. `S4-PROD-DEPLOYED` — the production read gateway answers and serves the committed production key ids (`p1`). Both were missing: the gates proved the *staging* deployments and the *approvals*, and never that the production gateway is the production one. |
| 2.5 | **Write the privacy scan as a tool** | **done** | `ops/privacy-scan.py` — scans for credential **shapes** and for exact **needles** read from a file, so a value never reaches a command line, a process list or the output; a hit is reported as a shape name and a line number, never as a value (F0-076). Its **positive control** — a planted token shape — is caught, so its silence means something. |
| 2.6 | **Update the S5 report** | **done** | `docs/release/PHASE-S5-REPORT.md` §7 records what happened after the report was written, and §5 is kept as it was written: *a report that is edited to look finished is not a report.* |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-ADRS` | `ls docs/decisions/`, read the ADR index | 0 | 0001–0014; **no transfer-design ADR**; the index now carries 0015 as `open` |
| `C-Q-CB-2` | `git show origin/main:docs/decisions/0011-…` | 0 | *"Both are supported in 0.6.0 … `cbridge upload` is retired only after the console's real upload passes OC-8"* — **Q-CB-2 is answered** |
| `C-DESIGN` | `git show origin/main:docs/release/PHASE-1.1-PRODUCT-CONTRACT.md` §1.1.5 | 0 | the design exists: actor, pre-conditions, conflict handling, validation, failure recovery and audit, authority boundary |
| `C-GATE-S5` | `release/rollout-gate.sh S5` | 1 | **6 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** (`S5-WORKER-SECRETS`) |
| `C-GATE-S4` | `release/rollout-gate.sh S4` | 1 | **7 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** (`S4-WORKER-SECRETS`) |
| `C-DEPLOYS` | `curl …/healthz` × 4 | 0 | read staging `s1`, read production `p1`, write staging `sk1`, write production `k1` + `deploy_env: production` + `submissions_repo: inscope-labs/acme-pilot-dev` |
| `C-PILOT` | run 43120286426's steps and log | 0 | **signed**, against the deployed gateways, `THE PILOT PASSED (44 checks)`; the steps *the estate is seeded*, *the pilot, signed*, *no secret is in the output*, *keep the evidence* — all success |
| `C-PROD-PROBES` | `ops/staging-pilot.py --target deployed --probes-only --expect-env production --read-base …ctxgate-read… --write-base …ctxgate-write…` | 0 | **21 checks, `THE PROBES PASSED`** |
| `C-STAGING-PROBES` | the same, without `--expect-env` | 0 | **13 checks** — the staging behaviour is unchanged |
| `C-PRIVACY` | `ops/privacy-scan.py` over six run logs, eight shapes, three fixtures | 0 | **0 hits** over 254,106 bytes |
| `C-PRIVACY-POSITIVE` | the same scan over a file holding a planted token shape | 1 | the shape is caught — the scan can fail |
| `C-NO-SECRET-IN-THIS-REPORT` | the report names shapes and counts only | — | no capability URL, no signature, no token, no content |

## 4. What the operator's answer has to settle

1. **Approve ADR 0015, or send it back.** The status is `open` and the four open points are
   marked as the operator's. **Until it is `decided`, S6's implementation is BLOCKED-EXTERNAL**
   — the plan says so in as many words, and this turn did not implement anything.
2. **Run the deployed Workers' secret-name check** — one command, with the Cloudflare
   credential the agent does not hold. It closes `S4-WORKER-SECRETS` and `S5-WORKER-SECRETS`,
   and with them the last BLOCKED-EXTERNAL condition on both stages.
3. **Export the platform's Worker logs, metrics, traces and error records** if the exit gate's
   privacy scan is to cover them. The scan is written and runs over them unchanged.
4. **Optionally: the signed leg against production**, which needs the production signing keys.

## 5. What was deliberately not done

- **No S6 implementation.** The plan forbids it without the ADR, and the ADR is `open`.
- **The ADR's four open points were not decided.** They are the operator's, and the ADR says so
  rather than presenting a recommendation as a decision.
- **No approval, no merge, no tag, no publication, no production deploy.** The agent's
  credential reports `current_user_can_approve: false` for the `production` environment, and it
  stays that way.
- **The Cloudflare credential was not requested.** `S5-WORKER-SECRETS` is BLOCKED-EXTERNAL
  because the agent does not hold it, not because the check is awkward.
