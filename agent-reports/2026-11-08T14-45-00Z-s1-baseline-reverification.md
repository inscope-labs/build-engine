# S1 work package — the Phase 4 and Phase 5 stacks, re-proved

- **Stage:** S1 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-1, BE-2)
- **Branch:** `docs/s1-baseline-reverification`
- **Baseline:** `main` at `0fe2f7a` — *"Merge pull request #50 from inscope-labs/docs/s0-documents-and-gate-runner"*,
  merged by the operator on 2026-11-08. `VERSION` = `0.5.0`; tag `v0.5.0` → commit `c95ae51`.
- **Run:** 2026-11-08T14:25Z → 2026-11-08T14:4xZ
- **Scope:** `docs/release/PHASE-S1-REPORT.md`, `agent-reports/…`, and one new test under `tests/`.
  **No gateway code, no shipped content, no configuration, no workflow file.**

## 1. Intent

The operator's brief was *"I have completed S0. Execute S1 now."*

S0's entry gate was not met when the brief arrived — the three BE-0 documents still said draft, §6.1
still proposed its own state set, and the gate runner did not exist. The agent completed that work
first, as **PR #50**, and the operator merged it (`0fe2f7a`). S1's entry gate — "S0 PASS" — is now met
against `main`, and this work package executes S1.

S1 is a **verification stage, not a build stage**: *"Re-prove the already-merged Phase 4 and Phase 5
stacks on current `main`. No re-implementation."* The only code this stage adds is the isolation test
the exit gate asks for, and it is a test that ships nothing.

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 1.1 | Confirm the merge order of #7, #8, #11, #13–#16, #22 from the PR history | **done** | The API, not the branch names: #7 (2026-10-31T23:09:43Z, `7b8fe487`), #8 (23:10:15Z, `03cfe578`), #11 (23:11:02Z, `ba441c7e`), #13 (23:33:18Z, `b4c6d4ec`), #14 (23:33:33Z, `dbf96a3a`), #15 (23:34:08Z, `57530221`), #16 (23:34:39Z, `da714fe1`), #22 (2026-11-01T00:03:10Z, `7b459c03`). **The order is exactly the plan's.** |
| 1.2 | Diff against `v0.5.0` | **done** | `git diff v0.5.0..HEAD` over the plan's scope: 5 files changed, **nothing removed**. The four files are `template/docs/CONTEXT-EXPORT.md`, `template/engine/release.json`, `template/engine/tools/ctxlink.py`, `template/engine/tools/test_ctxlink.py`; the fifth is this stage's own test. Each is listed and justified in the stage report. |
| 1.3 | Re-run the standing checks | **done** | `release/rollout-gate.sh S1`: **PASS 26, FAIL 0, BLOCKED-EXTERNAL 0**, exit 0. Every count matches the plan's baseline — 113 / 94 / (150 + 22) / 94 / 14 / 20 / 372 — and **no count was adjusted to make a check pass**. |
| 1.4 | Run the Worker conformance cases and state the actual count | **done** | `python3 gateway/read/production/test/run-conformance.py` → **58 passed, 0 failed**. The plan expects 58; the actual count is **58**. |
| 1.5 | Map the write gateway's lifecycle to its test files | **done** | The stage report §6 maps every item — root capability, task/work-order binding, single writer, sequence, staging and file ops, UTF-8 and file-type, quota, read-back and integrity, commit and delivery, seal/close/revoke — to its test file and to the test that carries the proof. |
| 1.6 | Prove the release isolation with a test | **done** | `tests/test_release_isolation.py`: 8 tests, all passing, and **three planted regressions** make it fail in a scratch copy (§4). |
| 1.7 | Re-implement anything | **not done** | Nothing was re-implemented. The Phase 4 and Phase 5 stacks are re-proved exactly as they stand. |
| 1.8 | Change the shipped payload | **not done** | The only file this stage touches outside `docs/` is a test under `tests/`, which is not on the allowlist. |
| 1.9 | Merge, tag, publish or deploy | **not done** | The operator merges. |
| 1.10 | Execute a test in operator-console | **not done** | That repository is read-only for this stage. Its files are cited by path and commit; **no claim is made about its behaviour.** |

## 3. Checks run in this session

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-PROT` | `GET /repos/inscope-labs/build-engine/branches/main/protection` | 0 | pull request required, required check `test`, force-push blocked |
| `C-CI` | `GET /repos/inscope-labs/build-engine/commits/main/check-runs` | 0 | 7 check runs on `main`, all `success` |
| `C-BASE` | `python3 -m unittest discover -s template/engine/tools` | 0 | `OK` (113) |
| `C-BASE` | `release/test-release.sh` | 0 | `94 passed, 0 failed` |
| `C-BASE` | `tests/test_update.sh` | 0 | `150 passed, 0 failed` + `22 passed, 0 failed` |
| `C-CONF` | `python3 conformance/harness/run.py all --reference` | 0 | `94 passed, 0 failed` |
| `C-CONF` | `python3 -m unittest discover -s conformance -p 'test_*.py'` | 0 | `OK` (14) |
| `C-CONF` | `python3 -m unittest discover -s ops -p 'test_*.py'` | 0 | `OK` (11) |
| `C-READ` | `npm test` (20), `npm run ops:check`, `npm run check:bundle` in `gateway/read/production`; `npm run check:staging:read` in `gateway/write`; `python3 -m unittest discover -s gateway/read/reference` (15) | 0 | `# fail 0`; `wrangler.toml matches ops/environments.json`; `the Worker builds for every environment, and every configuration is understood.`; `the read staging environment is separate from production`; `OK` |
| `C-WRITE` | `npm run typecheck`, `npm test` (372), `npm run check:contract`, `npm run check:staging` in `gateway/write` | 0 | no diagnostics; `# fail 0`; `the contract documents agree`; `the write staging environment is separate from production` |
| `C-ISO` | `release/package.sh dist` → `release/verify.sh … --test-payload` → the member list | 0 | `packaged 41 files`; `verify: OK (42 files, version 0.5.0, payload tests run)`; no `gateway/`, `conformance/`, `ops/`, `variants/`, `.github/`; no `wrangler.toml`, no `rollout-gate.sh` |
| `C-DIFF` | `git diff v0.5.0..HEAD` over `template/`, the allowlist, the forbidden rules and `tests/` | 0 | nothing removed; 5 files changed |
| `C-SECRETS` | the credential shapes in `release/forbidden.txt` + the `Bearer` literal shape, over the working tree and the diff against `origin/main` | 0 | no hit; 7 deliberate sentinels excluded by a file-scoped rule and listed by the check |
| the conformance cases | `python3 gateway/read/production/test/run-conformance.py` | 0 | `58 passed, 0 failed`; the revoked order answered 403; the admin channel refused an unauthenticated caller |
| the isolation test | `python3 tests/test_release_isolation.py` | 0 | `Ran 8 tests … OK` |
| the whole gate | `release/rollout-gate.sh S1` | **0** | `PASS 26  FAIL 0  BLOCKED-EXTERNAL 0` (26 checks: C-PROT 1, C-CI 1, C-BASE 3, C-CONF 3, C-READ 5, C-WRITE 4, C-ISO 4, C-SECRETS 2, C-DIFF 1, S1-CASES 1, S1-LIFECYCLE 1) |

## 4. The isolation test, and the regressions it catches

`tests/test_release_isolation.py` builds the artifact the way a release builds it —
`release/package.sh`, from the tracked file list and the allowlist, with no other input — and asserts
three separate things: the artifact holds exactly the allowlist; the infrastructure stayed out; no
credential is inside.

It was checked against three planted regressions, each in a **scratch copy** of the repository built
with `git archive` into a temporary directory with its own git history. **No regression touched this
working tree or the pushed branch.**

| Planted regression | What caught it |
|---|---|
| `gateway/leak.py` in `template/`, `managed gateway` on the allowlist | three assertions: the infrastructure-directory rule, the path rule `(^\|/)gateway(/\|$)`, and the content rule `class[[:space:]]+Gateway[(:]` |
| `conformance/signing-vectors.json` in `template/`, `managed conformance` on the allowlist | three assertions: the infrastructure-directory rule, the path rule `(^\|/)(conformance\|variants)(/\|$)`, and the content rule `"vectors_version"` |
| a token-shaped string inside the payload | `test_no_credential_shape_inside_the_artifact`, with the rule `ghp_[A-Za-z0-9]{36}` |

A fourth defence showed itself unplanned: with the planted manifest edit left uncommitted,
`release/package.sh` **refused to package a dirty tree** before the test ran at all.

## 5. The runner failed open, and that is now fixed

The gate runner counted its verdicts in shell variables. The C-READ and C-WRITE checks run inside a
subshell — `( cd gateway/write && npm test )` — and a subshell cannot change its parent's variables. A
FAIL raised there was **printed** and then **counted as nothing**, and the runner would have exited 0.
It failed open, which is the one thing the plan's rule 3 forbids.

The verdicts are now counted through a file that every subshell shares. The behaviour was proved
against planted failures in scratch copies:

| Planted | Result |
|---|---|
| a failing C-READ check (the subshell-hosted one) | `PASS 3   FAIL 2`, `RESULT: FAIL (2 failing check(s))` |
| a C-CI check that finds no check runs | `PASS 0   FAIL 1`, `RESULT: FAIL (1 failing check(s))`, **exit 1** |
| a C-CI check with no credential in the environment | `PASS 0   FAIL 0   BLOCKED-EXTERNAL 1`, `RESULT: BLOCKED-EXTERNAL`, **exit 2** |
| a usage error | **exit 4** |

The fix is in `release/rollout-gate.sh`, and it touches no gateway behaviour. The plan's rule 6
requires a stage that touches `release/` to re-run the isolation checks: `C-ISO` runs in this stage's
gate, and the runner is still absent from the artifact.

## 6. Two findings worth the operator's attention

1. **The nonce is not in this repository.** The exit gate names "sequence/nonce". The write gateway's
   replay protection is the content **sequence** number plus the content hash plus a bounded replay
   window (`gateway/write/docs/protocol.md` §6.2, proved by
   `gateway/write/tests/unit/session/sequence.test.ts`). **The word "nonce" does not occur anywhere
   under `gateway/write/`.** The nonce belongs to `ctxop-v1`, which is Gateway A's mechanism; Gateway A
   lives in `inscope-labs/operator-console` at `992defff591d39539bcc8b4ca3cbc14eb9bab783`
   (`docs/capability-format.md`, `gateway/src/durable-objects/nonce-store.ts`,
   `gateway/tests/unit/capability/nonce.test.ts`). That repository is read-only here: its files are
   cited by path and commit, and **no test in it was executed**.

2. **`release/verify.sh --release` is still red on `main`**, and it was red before this stage. The
   protocol identifier moved to `build-engine/0.6` in PR #46, while ADR 0006 forbids the version
   metadata from moving before the release conditions hold; `release/set-version.sh` belongs to S8. CI
   runs the default verification, which is green. This stage did not change it and does not paper over
   it.

## 7. What was not done

- Nothing was re-implemented, and no gateway behaviour was changed.
- Nothing was merged, tagged, published or deployed. The operator merges.
- No workflow file was touched (plan rule 7).
- The shipped payload was not touched.
- No test in `inscope-labs/operator-console` was executed.
- No credential value was read, printed, stored or written to a file.

## 8. The next stage

S2 — contract and capability closure — begins when the operator merges this pull request. Its entry
gate is "S1 PASS; all S0 ADRs present", and both are met.
