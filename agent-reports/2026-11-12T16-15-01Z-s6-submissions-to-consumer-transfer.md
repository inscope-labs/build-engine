# S6 work package — the submissions-to-consumer transfer

- **Stage:** S6 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-6, R0-011 for Standard)
- **Branches:** `s6/adr-0015-decided` (**pull request #69**) and `s6/transfer-implementation`
  (**pull request #70**, stacked on #69)
- **Baseline:** `main` at `61fc9e2` — *"Merge pull request #68 from inscope-labs/s6/worker-secret-names"*
- **Run:** 2026-11-12T12:20Z → 2026-11-12T16:20Z
- **Scope:** `template/operator/cbridge`, `gateway/write/src/operator/task-state.ts`,
  `gateway/write/docs/protocol.md`, `conformance/cases/task-state-transition.json`,
  `gateway/write/tests/`, `tests/test_transfer.sh`, `release/`, `docs/release/`.
  **No merge, no tag, no publication, no production deploy, and no approval was given by the
  agent** — the `worker secrets` run is waiting at the `production` environment's prompt, and
  the agent's credential reports `current_user_can_approve: false`.

## 1. Intent

The operator approved ADR 0015 with the four open points answered. S6's implementation could
therefore begin, and the stage was carried out to the end of what the repository can do.

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 6.1 | Record the operator's decision | **done** | ADR 0015, status **decided** (2026-11-12): the four answers as the operator gave them, and the approver record. PR #69. |
| 6.2 | The gateway's own record of what it sealed (ADR 0015 open point 1) | **done** | `GET /admin/task-state` gains `commit.hashes`: the per-file SHA-256 map keyed by the path relative to the task folder, present only when the commit belongs to the task and the work order asked about. The protocol's §10.4.1 and the 18 shared conformance vectors moved with it. **405 gateway tests pass**; the shared conformance suite passes (40). |
| 6.3 | The transfer | **done** | `cbridge transfer <plan> <order> <task> --expect-head SHA --dest-root PATH`: six checks before any write (the seal attestation, the sealed folder read at the sealed commit, the per-file hashes against the gateway's own record, the destination head, the operator's existing guards, then one commit and one pull request — with the branch removed if the pull request cannot be opened). The default branch is never written to. An audit record names the work order, the task, the sealed commit, the destination, the file set with its hashes, the outcome and the step that failed — no credential, no signature, no content. |
| 6.4 | The negative tests | **done** | `tests/test_transfer.sh`: **19 checks** — the happy path and the four the exit gate names: a tampered hash, a moved destination head, an unsealed folder, and a partial-failure injection. Each negative case leaves the consumer repository **exactly as it was**. |
| 6.5 | The credential-boundary test | **done** | The operator's own scope check (run 42949381010: the consumer repository listed but **not** writable by the submissions credential) is read from its conclusion, and the transfer's own code uses the operator's credential for the consumer repository and the operator token for the read-only operator channel — never the write gateway's credential. |
| 6.6 | `cbridge upload` remains working; the sequencing constraint recorded | **done** | `tests/test_cbridge.sh`: **36 passed, 0 failed**. ADR 0015 records the constraint: both routes are supported in 0.6.0 and `cbridge upload` is retired only after OC-8. |
| 6.7 | The artifact | **done** | The design says the transfer ships, so the allowlist must cover it: `release/manifest.txt` already lists `managed operator` and the transfer is part of `template/operator/cbridge` — **no allowlist change was needed** — and `release/test-release.sh` now runs both suites. |
| 6.8 | The stage's gate | **done** | `release/rollout-gate.sh S6`: `S6-ADR-0015`, `S6-TRANSFER-TESTS`, `S6-CBRIDGE`, `S6-CREDENTIAL-BOUNDARY`, `S6-RELEASE-COVERAGE`. **29 PASS, 0 FAIL, 0 BLOCKED-EXTERNAL — `RESULT: PASS (stage S6)`.** |
| 6.9 | Deploy the gateway change | **staging done, production is the operator's** | The staging write gateway is redeployed: run **43256388710**, **success**. The **production** write gateway needs a production deploy, and that waits at the environment's approval prompt. |
| 6.10 | Run a real transfer | **not done — the operator's** | The tests use local bare repositories and a stand-in gateway. A real transfer — the pilot's sealed task folder into `inscope-labs/acme-pilot` — needs the operator's token, and the production gateway's new field. |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-GATE-S6` | `release/rollout-gate.sh S6` | 0 | **29 PASS, 0 FAIL, 0 BLOCKED-EXTERNAL — `RESULT: PASS (stage S6)`** |
| `C-TRANSFER` | `bash tests/test_transfer.sh` | 0 | **19 passed, 0 failed** — the happy path and the four negative tests |
| `C-CBRIDGE` | `bash tests/test_cbridge.sh` | 0 | **36 passed, 0 failed** |
| `C-GATEWAY` | `cd gateway/write && npm test` | 0 | **405 passed, 0 failed**; the typecheck clean |
| `C-CONF` | `python3 -m unittest discover -s conformance` | 0 | **40 passed** — the shared vectors, with the hash map |
| `C-RELEASE` | `release/test-release.sh` (the new section) | 0 | the transfer's suite and the cbridge suite pass inside the release machinery |
| `C-STAGING-DEPLOY` | run 43256388710 | 0 | **success** — the staging write gateway carries the new operator channel |
| `C-APPROVAL-GATE` | `GET .../runs/43243657884/pending_deployments` | 0 | the `worker secrets` run is **waiting**; the agent cannot approve it |

## 4. Two defects the stage found, both fixed

- **A check run that has not finished was read as a red build.** The `worker-secrets` workflow
  sits at the environment's approval prompt and reports no conclusion; `C-CI` counted that as
  a failure and would have made the gate red for a build that is not red. It now judges only
  the runs that have **completed**, and reports how many are still running.
- **The approval checks reported *"the production gateway has not been deployed yet"* when the
  truth was that they could not look.** A missing credential is an external input, not a
  finding; those checks now say so, and the Cloudflare refusal names the API's own error code.

## 5. What is the operator's now

1. **Merge PR #69** (the ADR) and then **PR #70** (the implementation).
2. **Approve the `worker secrets` run** (43243657884) — it closes the last BLOCKED-EXTERNAL
   condition on S4 and S5.
3. **Approve the production write gateway's deploy**, so the deployed operator channel carries
   the per-file hashes; then **run a real transfer** with their token.
4. At the end of the assignment, **revoke the GitHub PAT** that was pasted into the chat
   (ADR 0013 item 5).
