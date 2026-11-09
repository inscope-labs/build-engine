# Stage S2: contract and capability closure (Gate 2 entry work)

**Stage:** S2 of `docs/release/V0.6.0-ROLLOUT-PLAN.md`.
**Entry gate:** S1 PASS, met (PR #51 merged; `PHASE-S1-REPORT.md`). ADRs 0010 to 0013 are `decided` on `main`.
**Baseline:** `main` at `662fc8d`. `VERSION` = `0.5.0`.
**Branch:** `s2/contract-and-capability-closure`.
**Result:** **PASS**: `release/rollout-gate.sh S2` exits 0 (39 PASS, 0 FAIL, 0 BLOCKED-EXTERNAL).
**Scope kept to the ADRs:** no signing-scheme change, no regenerated vector, no change to `protocol.md` sections 3, 4
or 5.2, no agent-facing route, nothing under `template/`, no workflow file, nothing for operator-console.

## 1. What changed, by exit-gate item

### 1.1 Task state (D-4, ADR 0011): the seal fact and the transition contract
- **Write gateway, new read-only operator route** `GET /admin/task-state?task=&order=` (`gateway/write/src/operator/task-state.ts`,
  `src/session/task-session.ts`, `src/router.ts`). It answers a **fact, not a decision**: `seal_attested` is true only
  when the session is `sealed`, a seal and a commit are recorded, the seal is over that commit, and the commit belongs
  to **both** the task and the work order asked about. It creates nothing, and carries no capability, signature, path,
  hash, writer or content. Documented in `protocol.md` section 10.4.1 and the operator runbook.
- **`docs/release/TASK-STATE-TRANSITION-CONTRACT.md`**: who calls whom, the order of the checks, the legal transitions,
  three new error codes for Gateway A's catalogue (`TRANSITION_NOT_ALLOWED`, `SEAL_NOT_ATTESTED`,
  `SEAL_FACT_UNAVAILABLE`), what the console must do with each refusal.
- **Executable decision reference:** `conformance/harness/transition_reference.py` with 28 vectors in
  `conformance/cases/task-state-transition.json`. The three refusals the exit gate names are covered: **unsealed task**
  (T03, T04), **wrong state** (T17 to T20, T22, T23, T27), **replayed transition** (T13, T28), plus fail-closed when the
  seal fact is unreadable (T11, T12) and no bypass through `SET` (T24).
- **Tests:** `gateway/write/tests/unit/operator/task-state.test.ts` (12) and `tests/integration/task-state.test.ts` (13)
  on the real request path; `conformance/test_task_state_transition.py` (10) ties the reference to the shipped schema's
  status enum, the field table in `protocol.md`, the contract document and a planted failure.

### 1.2 Link-lifecycle contract
`docs/release/LINK-LIFECYCLE-COVERAGE.md` maps each of the plan's operations to where it is specified, implemented and
tested. **One was missing: status.** Added `GET /admin/status?order=` (counts and flags only) with unit tests and an
end-to-end check. Re-mint was present but undocumented and is now documented (a revoked order stays revoked, so re-mint
under a new order id). The consolidated operator-channel contract is in section 3 of that document.

### 1.3 GAP R-1 (observable replay, R-1.d) and GAP R-2
- **R-1.d implemented** in the read gateway: each served presentation of a link is counted (per order, commit and path),
  `GET /admin/replay` lists links above `REPLAY_ALERT_THRESHOLD`, `/admin/metrics` carries `links_tracked` and
  `links_repeated`, and one platform-log line is written when a link first crosses the threshold. The audit record's schema
  is unchanged (a test asserts the stored record equals the written one), refusals are never counted, a record with no
  order, commit or path cannot raise a count, and counting cannot fail a request. Config flows through
  `ops/environments.json` and `render-environments.py` (`ops:check` passes). Tests: `test/unit/replay.test.ts` (17) and the
  end-to-end checks in `test/run-abuse-controls.py`.
- **R-2.a accepted** (ADR 0010 item 3); nothing built, R-2.c is a later stage.

### 1.4 Q-A: the shared-property suite, and the property-by-format matrix
`conformance/harness/run_shared.py` runs the named tests of all fifteen cells and reports `PASS`, `PASS (accepted gap)`,
`EXTERNAL` or `FAIL`. Current result: **8 PASS, 2 PASS (accepted gap), 5 EXTERNAL, 0 FAIL.** The matrix is in
`CAPABILITY-CONFORMANCE.md` section 4.4 (generated, and kept equal to the cases by
`conformance/test_shared_properties.py`, which also checks that the runner fails a nonexistent test, an accepted gap with
no decision, an external cell that claims to have run, and that `--strict` fails any EXTERNAL cell). GAP C-1 is closed for the
shared properties.

## 2. Exit gate

| Exit-gate item | Result | Evidence |
|---|---|---|
| each property x format has a named test or an accepted-gap ADR citation | **met** | `CAPABILITY-CONFORMANCE.md` section 4.4; `run_shared.py` (S2-MATRIX) |
| no open GAP without an ADR | **met** | section 5 of the same document; ADR 0010 (S2-GAPS) |
| new behaviour has unit and integration tests | **met** | section 1 above |
| refusal tests: unsealed task, wrong state, replayed transition | **met** | vectors T03/T04, T17 to T28; integration tests (S2-REFUSAL) |
| `C-WRITE`, `C-READ`, `C-CONF`, `C-DIFF`, `C-SECRETS`, `C-ISO` | **met** | gate output below |
| contract documents and code agree (`check:contract`) | **met** | S2-CONTRACT; C-WRITE |
| signing scheme unchanged | **met** | S2-SCHEME: `signing-vectors.json` and `SCHEME.md` identical to `origin/main` |

Standing checks, this branch: `C-PROT` pass; `C-CI` pass (7 runs on `main`); `C-BASE` pass (94; 150 and 22); `C-CONF` pass
(harness 94); `C-READ` pass (unit 37, ops, bundle, staging separation); `C-WRITE` pass (typecheck, **398 tests**, contract,
staging separation); `C-ISO` pass; `C-SECRETS` pass (370 files, the diff, 8 sentinels excluded and listed, including the
new operator-token sentinel in `task-state.test.ts`, the same fixture the other operator tests use); `C-DIFF` pass.

| Count | Baseline (S1) | Now | Change |
|---|---|---|---|
| write gateway tests | 372 | 398 | +26 |
| read gateway unit tests | 20 | 37 | +17 |
| conformance unit tests | 14 | 40 | +26 (10 transition, 16 shared) |
| harness checks | 94 | 94 | none |
| Worker conformance cases | 58 | 58 | none |
| shipped engine, release, update | 113, 94, 150 and 22 | unchanged | none |

## 3. Deviations and decisions the operator should see

1. **ADR 0011 item 1 and the plan say Gateway C "gains a guarded status-transition operation".** The documents do not
   support that reading: the transition is Gateway A's route (`POST /plans/{id}/status`), and `protocol.md` gives the write
   gateway no state-transition route. What Gateway C gains is the **seal fact**. The contract states this. **The wording of
   ADR 0011 item 1 should be corrected by the operator.**
2. **The legal-transition table is new** (nothing leaves `done`, `dropped` or `superseded`; `done` only through `SET_DONE`;
   a request for the current status is refused). No ADR fixed it. The operator should confirm it (contract section 9).
3. **Credential custody for the seal fact.** Gateway A must call Gateway C's operator channel; the only credential that exists
   is the full `OPERATOR_TOKEN`. A separate read-only credential is the least-privilege alternative and was **not** built,
   because no ADR chose it (contract section 9).
4. **R-1.d counts per link, not per order.** The decision's wording was "the count of presentations for one order"; a per-order
   total would alarm on any task that reads many files. The operator can ask for an order total.
5. **The threshold default (10) is a proposal**, flagged in `limits.md`; the operator should set it from a real task.
6. **`GatewayState`'s constructor is now a plain assignment** instead of a parameter property, so its unit tests can load
   under Node's type-stripping mode. Behaviour is identical.
7. **`GET /admin/status` was added** because the plan's lifecycle list names "status" and none existed.
8. **The gate runner gained S2 stage checks** (`release/rollout-gate.sh`), so S2 is now a real PASS or FAIL, not "not implemented".

## 4. Not done, and not verified

- **`ctxop-v1` evidence is cited, not run.** Five cells are `EXTERNAL`. One carries a requirement: per-capability revocation
  is required for 0.6.0 (ADR 0010 item 4) and the documents read describe it as a `501` stub, so S7 needs the console's
  evidence. `run_shared.py --strict` fails while any cell is `EXTERNAL`.
- **Gateway A's transition is operator-console's work (OC-6).** Nothing in that repository was run or verified.
- **The console's minter for read links** is not described in the operator-console documents read; unverified.
- **Nothing was deployed.** No deployed-gateway evidence is claimed; that is S4 and S5.
- **The required `test` check failed once on this pull request**, at the conformance unit-test step: one of the new
  shared-property tests launched Node, which the CI job does not have installed. The tests now use static stand-ins for the
  three functions that launch a runtime, so they need nothing installed. This was reproduced locally by running the suite with
  Node off the `PATH` (it failed), and the fix was verified the same way (it passes), and with Node present. The real
  run, `python3 conformance/harness/run_shared.py`, is unchanged and is part of the S2 gate.
- **The gate's first run in the authoring environment failed `C-PROT` because `jq` was absent from that environment**, not
  because protection changed; the check passed with `jq` installed and the protection was also read directly from the API.
