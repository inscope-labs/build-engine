# Gate 2 summary — the deployed gateways, staging and production

**Stage:** the S5 exit gate's item *"Gate 2 summary: read and write staging and production
conformance archived, revocation and audit verified remotely"*.
**Date:** 2026-11-12. **Baseline:** `main` at `6aa8854`.
**What this document is:** the record of what is deployed, which run published each deployment,
what evidence exists for each, and what is still the operator's to supply. It cites runs and
counts; it does not restate the stage reports.

---

## 1. The four deployments

| Gateway | Host | Environment | Key ids | Published by | Approval |
|---|---|---|---|---|---|
| read | `ctxgate-read-staging.qnuralink.workers.dev` | staging | `s1` | run **42660470167** (S4) | — |
| read | `ctxgate-read.qnuralink.workers.dev` | production | `p1` | run **43211834638** | `inscope-xlabs` (ADR 0013's login, not the dispatching identity) |
| write | `ctxgate-write-staging.qnuralink.workers.dev` | staging | `sk1` | run **42975489428** (S5) | — |
| write | `ctxgate-write.qnuralink.workers.dev` | production | `k1` | run **43209697603** | `inscope-xlabs` (ADR 0013's login, not the dispatching identity) |

Each was asked what it is, on 2026-11-12:

```
ctxgate-read-staging    {"status":"ok","scheme":"ctxgate-v1","key_ids":["s1"],"conformance_clock":false}
ctxgate-read            {"status":"ok","scheme":"ctxgate-v1","key_ids":["p1"],"conformance_clock":false}
ctxgate-write-staging   {"protocol":"ctxwrite-v1","deploy_env":"staging","policy":{"key_ids":["sk1"],…}}
ctxgate-write           {"protocol":"ctxwrite-v1","deploy_env":"production",
                         "policy":{"key_ids":["k1"],"declared_key_ids":["k1"],
                                   "submissions_repo":"inscope-labs/acme-pilot-dev",
                                   "submissions_branch":"submissions"},…}
```

The write gateway's production deployment writes to the repository and branch ADR 0014 named ✓,
and its key ids are the declared ones ✓.

## 2. Conformance, archived

| Deployment | Evidence | Count |
|---|---|---|
| read staging | the archived gate log of run 42660470167 — the shared conformance suite over real HTTP | **58 passed, 0 failed** |
| read staging | the deployed state-failure proof, run **42857228251** — `503 gateway state unavailable`, `/healthz` 200, the operator channel reporting *"the state store could not be reached"* | 3 steps, both waits fired |
| write staging | the signed pilot, run **43120286426** — the full Class B leg against the deployed gateways | **44 checks, `THE PILOT PASSED`** |
| write staging | the deployed probes | **13 checks** |
| read production | the deployed probes against the production pair | 21 checks, of which 8 are the read gateway's |
| write production | the deployed probes against the production pair | 21 checks, of which 10 are the write gateway's |

**The signed leg against production has not been run.** The pilot's signed run needs the
production signing keys, and those are the operator's (ADR 0013 item 4). The secret-free half of
the evidence — reachability, the declared key ids, the environment, the destination repository
and branch, and every refusal — is archived above for both production gateways.

**The 58-case conformance suite has not been run against the production read gateway**, for the
same reason: it mints capabilities with the production signing key. The suite runs against the
built production configuration in the deploy gate (run 43211834638's gate job, **success**), so
what is unarchived is the suite against the *published* production Worker.

## 3. Revocation and audit, verified remotely

**Staging, both gateways, against the deployed Workers** — the signed pilot, run 43120286426:

| Check | Result |
|---|---|
| the read gateway revoked the order | 200 |
| the read capability no longer works | 403 |
| the write gateway revoked the task | 200 |
| the sealed task's capability no longer works | 410 `task-sealed` |
| the second task's capability worked before its revocation | 200 |
| the second task was revoked | 200 |
| the revoked task's capability no longer works | 410 `task-revoked` |
| the read audit record holds no secret, no content, no signature | ok |
| the write audit record holds no secret, no content, no signature | ok |
| the read audit channel refuses an unauthenticated caller | 401 |
| the write audit channel refuses an unauthenticated caller | 401 |

**Production, both gateways, against the deployed Workers** — the deployed probes:

| Check | read | write |
|---|---|---|
| the audit channel refuses an unauthenticated caller | 401 | 401 |
| the revocation channel refuses an unauthenticated caller | 401 | — |

The write gateway's revocation channel is reached by task rather than by order, so the probe
uses the task form ✓.

## 4. The privacy scan over the captures

`ops/privacy-scan.py` — a new tool, so that the claim is reproducible and not a one-off grep.
It scans for **shapes** (what a credential, a capability and a private payload look like) and
for **needles** (exact values the operator holds, read from a file so the value never reaches a
command line or the output). **It never prints a matched value** — a hit is reported as a shape
name and a line number (F0-076).

Six captures were scanned — the signed pilot, both production deploys, all three production
inits:

| Capture | Bytes | Hits |
|---|---|---|
| run 43120286426 — the signed pilot | 7,752 | **0** |
| run 43209697603 — the write gateway's production deploy | 155,006 | **0** |
| run 43211834638 — the read gateway's production deploy | 70,302 | **0** |
| run 42976257752 — the write production init | 7,109 | **0** |
| run 43147976206 — the write production init (with `replace`) | 7,037 | **0** |
| run 42857199651 — the read production init | 6,900 | **0** |

**Shapes:** a capability root URL, a capability path, a `Bearer` literal, a GitHub token, a
fine-grained PAT, a private-key header, an operator token or signing secret in an assignment, and
a Cloudflare API token. **Fixtures:** the pilot brief, the deliverable's content, and the private
notes the read gateway must never serve.

**A positive control:** the same scan over a file holding a planted token shape reports it ✓ —
the scan is able to fail, so its silence means something.

**What this scan does not cover:** the platform's own Worker logs (Cloudflare), the metrics and
traces, and the workers' error records. Those are the operator's to export, and the scan runs
over them unchanged when they arrive.

## 5. What is still the operator's

| # | Item | Why it is the operator's |
|---|---|---|
| 1 | the deployed Workers' **secret names** (`S5-WORKER-SECRETS`, `S4-WORKER-SECRETS`) | the check reads the deployed Worker's secrets through the Cloudflare API, and the Cloudflare credential is not in the agent's environment (ADR 0013 item 4). The agent does not ask for it and does not need it. |
| 2 | the **platform's** Worker logs, metrics, traces and error records | Cloudflare's export. The scan above is ready for them. |
| 3 | the **signed leg against production** | the production signing keys are the operator's. |
| 4 | the 58-case conformance suite against the **published production** read gateway | the same keys. |

## 6. The standing checks, as they stand

| Stage | Gate | Result |
|---|---|---|
| S4 | `release/rollout-gate.sh S4` | **6 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** — `S4-WORKER-SECRETS` |
| S5 | `release/rollout-gate.sh S5` | **5 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** — `S5-WORKER-SECRETS` |

Both stages' BLOCKED-EXTERNAL condition is the same one, and it is item 1 above.
