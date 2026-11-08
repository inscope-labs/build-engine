# Stage S0 — decisions and baseline (Gate 0)

**Stage:** S0 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (closes BE-0).
**Baseline:** `main` at `64ce044` — the merge of PR #49, *"docs: record S0 decisions (ADR 0010-0013) and
amend the v0.6.0 rollout plan"*, merged 2026-11-08T13:48:47Z.
**Branch:** `docs/s0-documents-and-gate-runner`. **Commits:** `f193677`, `f5a34f4`, plus this report.
**Result:** **PASS** — every `[R]` and `[O]` item of the S0 exit gate is met, with the evidence below.
**Run:** 2026-11-08T14:04Z → 2026-11-08T14:22Z. **Gate command:** `release/rollout-gate.sh S0`, exit 0
(**28 PASS, 0 FAIL, 0 BLOCKED-EXTERNAL**).

## 1. What this stage was

The operator merged the S0 half of the work — ADR 0010 to ADR 0013 and the amended rollout plan — as
PR #49. The agent half of S0 was still outstanding on `main` when this stage started:

- the three BE-0 documents still carried the status line **"DRAFT for the operator's review"**, even
  though the operator had now decided the questions they raised;
- `CAPABILITY-CONFORMANCE.md` §6.1 still proposed a task-state set of its own, while
  ADR 0011 item 2 makes the **shipped schema** the authority;
- `release/rollout-gate.sh`, the gate runner the plan asks for in S0, **did not exist**.

S1's entry gate is "S0 PASS". The agent therefore completed the outstanding S0 work first, because it
is work the plan assigns to the agent (`docs/release/S0-AGENT-HANDOFF.md`), and because S1's entry gate
is not met until S0 is. This is stated plainly rather than done quietly: **S1 does not begin until the
operator merges this stage's pull request.**

## 2. What was done

| # | Task | Done | Evidence |
|---|---|---|---|
| S0-a | The three BE-0 documents stop saying draft, and each cites the ADR that decided its questions | **done** | `COMPATIBILITY-MATRIX.md` (ADR 0012), `CAPABILITY-CONFORMANCE.md` (ADR 0010, ADR 0011), `CBRIDGE-COVERAGE-MATRIX.md` (ADR 0011). Each document's §8 is now "Decisions this document raised, and where each was answered". |
| S0-a | GAP R-1 and GAP R-2 recorded as **accepted gaps with a citation** | **done** | `CAPABILITY-CONFORMANCE.md` §5: both carry the operator's decision (ADR 0010), what is still to be built, and the stage that builds it. |
| S0-a | Option R-2.c listed as a **later cross-system stage**, not part of 0.6.0 | **done** | `CAPABILITY-CONFORMANCE.md` §5 (GAP R-2) and §8 (Q-D). |
| S0-b | §6.1 reconciled to `template/engine/schemas/task.schema.json`; every difference reported; **the schema unchanged** | **done** | `CAPABILITY-CONFORMANCE.md` §6.1 with its difference table. The schema file is untouched — `git diff` shows no change under `template/engine/schemas/`. |
| S0-c | `release/rollout-gate.sh <stage>` created: runs the `[R]` checks, queries the `[E]` presence checks, prints PASS / FAIL / BLOCKED-EXTERNAL per check | **done** | `release/rollout-gate.sh`. |
| S0-c | The runner is **absent from `release/manifest.txt` and from the artifact** | **done** | The runner's own `S0-NOTSHIPPED` check, the `C-SECRETS` check, and `C-ISO`: the built artifact's 41 members carry no `gateway/`, `conformance/`, `ops/`, `variants/` or `.github/` path, no `wrangler.toml` and no `rollout-gate.sh`. |
| S0-d | The gate run at the baseline SHA, and the stage report | **done** | `release/rollout-gate.sh S0`, exit 0. This report. |

## 3. The gate

`release/rollout-gate.sh S0` — one run, the whole gate, exit **0**. The runner is fail-closed: a check
that cannot run, errors or returns ambiguous output is a FAIL, and a stage whose own checks are not
implemented reports BLOCKED-EXTERNAL rather than PASS.

| Check | Command / query | Exit | The inspected output |
|---|---|---|---|
| `C-PROT` | `GET /repos/inscope-labs/build-engine/branches/main/protection` | 0 | pull request required, required check `test`, force-push blocked |
| `C-CI` | `GET /repos/inscope-labs/build-engine/commits/main/check-runs` | 0 | 7 check runs on `main`, all conclusions `success` |
| `C-BASE` | `python3 -m unittest discover -s template/engine/tools` | 0 | `OK` (113 tests) |
| `C-BASE` | `release/test-release.sh` | 0 | `94 passed, 0 failed` |
| `C-BASE` | `tests/test_update.sh` | 0 | `150 passed, 0 failed` and `22 passed, 0 failed` (the hardening suite) |
| `C-CONF` | `python3 conformance/harness/run.py all --reference` | 0 | `94 passed, 0 failed` |
| `C-CONF` | `python3 -m unittest discover -s conformance -p 'test_*.py'` | 0 | `OK` (14 tests) |
| `C-CONF` | `python3 -m unittest discover -s ops -p 'test_*.py'` | 0 | `OK` (11 tests — the fault injector the Stage 6.3 pilot depends on) |
| `C-READ` | `npm test` in `gateway/read/production` | 0 | `# fail 0` (20 tests) |
| `C-READ` | `npm run ops:check` | 0 | `wrangler.toml matches ops/environments.json, and the configuration is valid.` |
| `C-READ` | `npm run check:bundle` | 0 | `the Worker builds for every environment, and every configuration is understood.` |
| `C-READ` | `npm run check:staging:read` in `gateway/write` | 0 | `OK: the read staging environment is separate from production` |
| `C-READ` | `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | 0 | `OK` (15 tests) |
| `C-WRITE` | `npm run typecheck` in `gateway/write` | 0 | three `tsc --noEmit` passes, no diagnostics |
| `C-WRITE` | `npm test` in `gateway/write` | 0 | `# fail 0` (372 tests) |
| `C-WRITE` | `npm run check:contract` | 0 | `OK: the contract documents agree` |
| `C-WRITE` | `npm run check:staging` | 0 | `OK: the write staging environment is separate from production` |
| `C-ISO` | `release/package.sh dist` | 0 | `packaged 41 files, 0.5.0 dist/build-engine-v0.5.0.tar.gz` |
| `C-ISO` | `release/verify.sh dist/build-engine-v0.5.0.tar.gz --test-payload` | 0 | `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0, payload tests run)` |
| `C-ISO` | the artifact's member list | 0 | no `gateway/`, `conformance/`, `ops/`, `variants/` or `.github/` path; no `wrangler.toml`, no `.dev.vars`, no `rollout-gate.sh` |
| `C-SECRETS` | the credential shapes in `release/forbidden.txt` + the `Bearer` literal shape, over the working tree and the diff against `origin/main` | 0 | no hit in 355 files and no hit in the diff. Seven deliberate sentinels were found, excluded by a file-scoped rule and listed by the check. |
| `C-DIFF` | `git diff v0.5.0..HEAD` over `template/`, `release/manifest.txt`, `release/forbidden.txt`, `tests/` | 0 | nothing removed; 4 files changed (see §5) |

The stage's own `[O]` checks:

| Check | What it asserts | Result |
|---|---|---|
| `S0-ADR-0010` … `S0-ADR-0013` | each ADR is on `main` with status `decided` | PASS ×4 |
| `S0-ADRCONTENT` | 0010 answers Q-A, Q-C, Q-D, Q-E; 0011 answers Q-B, Q-B2, Q-CB-1…3; 0012 answers Q-4, Q-5, DX-1, DX-2 | PASS |
| `S0-DOC-*` | none of the three documents says DRAFT | PASS ×3 |
| `S0-STATE` | every state in the shipped schema appears in `CAPABILITY-CONFORMANCE.md` §6.1 | PASS — `planned in_progress pr_open done dropped superseded` |
| `S0-ADR0008` | ADR 0008's status line records DX-1 and DX-2 as closed by 0012 | PASS |
| `S0-INDEX` | `docs/decisions/README.md` lists 0010 to 0013 | PASS |
| `S0-NOTSHIPPED` | `release/manifest.txt` does not list the gate runner | PASS |

## 4. The exit gate, item by item

| Exit-gate item | Met | Where the evidence is |
|---|---|---|
| `[O]` ADRs 0010 to 0013 on `main`, status `decided`, each stating the chosen option | **yes** | §3, `S0-ADR-*` and `S0-ADRCONTENT` |
| `[O]` the three BE-0 documents no longer say draft/proposed | **yes** | §3, `S0-DOC-*` |
| `[O]` §6.1 reconciled to `template/engine/schemas/task.schema.json` | **yes** | §3, `S0-STATE`; the difference table is in the document itself, and the schema file is unchanged |
| `[O]` ADR 0008's status line says DX-1 and DX-2 are closed by 0012 | **yes** | §3, `S0-ADR0008` |
| `[O]` `docs/decisions/README.md` lists 0010 to 0013 | **yes** | §3, `S0-INDEX` |
| `[R]` `rollout-gate.sh S0` runs and exits 0 | **yes** | the gate run above, exit 0 |
| `[R]` `C-BASE`, `C-CONF`, `C-READ`, `C-WRITE`, `C-ISO` pass at the baseline SHA | **yes** | §3 |

## 5. The state list: what changed, and what did not

The shipped schema is the authority (ADR 0011 item 2) and **the schema was not changed**. §6.1 was
reconciled to it, and every difference is recorded in the document itself:

| The earlier draft proposed | The schema says | What changed |
|---|---|---|
| `pending` | `planned` | renamed to the schema's word |
| `ordered` | — | dropped: the schema has no "ordered" status |
| `in_progress` | `in_progress` | unchanged |
| — | `pr_open` | added: the schema has a pull-request-open state |
| `done` | `done` | unchanged |
| `blocked` | — | dropped as a status: the schema carries `blocked_by` as a *field* |
| `cancelled` | `dropped` | renamed to the schema's word |
| — | `superseded` | added: the schema has a superseded state |

## 6. Open conditions carried forward (not blocking S0)

Each of these is checked at the stage named, not here.

| Condition | Where it is checked | State at S0 |
|---|---|---|
| The exact GitHub login(s) for authorization and approval (ADR 0013) | S4, S5, S9 | not supplied |
| The separate agent identity (ADR 0013) | S3 | not supplied |
| The submissions repository and branch (ADR 0012) | S5 | the repository is named (`acme-pilot-dev`); **the branch is not** |
| The `production` GitHub environment requires a reviewer | S3 entry gate | **the environment exists but has no protection rule** — `GET /repos/inscope-labs/build-engine/environments` returns `production` and `staging`, both with `protection_rules: []`. The runner reports this as BLOCKED-EXTERNAL for S3. |
| The compatibility record's schema and validator (ADR 0012 item 2) | S8 | approved, not implemented |
| The console APK's version name, code and fingerprint (Q-2) | S8 | not supplied |
| Each deployed gateway's `worker_version_id` (Q-3) | S8 | not yet obtainable |

## 7. Not done, and why

- **Nothing was merged, tagged, published or deployed.** The agent opens the pull request; the operator
  merges (G-12). No `main` was pushed to.
- **No credential value was read, printed or stored.** The runner reads secret *names* through APIs
  that list names only. The session's GitHub credential was used as an HTTP header and was deleted at
  the end of the run.
- **The shipped payload was not touched.** The two commits change `docs/release/` and add
  `release/rollout-gate.sh`. The one file under `template/` that differs from `v0.5.0` is
  `template/engine/release.json` (the protocol identifier), and it came from PR #46, not from this
  stage.
- **`release/verify.sh --release` is still red on `main`**, and it was red before this stage: ADR 0006
  forbids the version metadata from moving before the release conditions hold, and
  `release/set-version.sh` belongs to S8. The default verification (what CI runs) is green. This stage
  did not change that and does not paper over it.

## 8. The gate runner

`release/rollout-gate.sh <stage>` — `S0` … `S9`.

- It runs the nine standing checks of the plan's §4, and the stage's own checks.
- It queries the `[E]` conditions through the GitHub and Cloudflare APIs and reports
  **BLOCKED-EXTERNAL** when the external input is not there.
- It prints **PASS / FAIL / BLOCKED-EXTERNAL** per check, with the command it ran and an excerpt of the
  output that was inspected, and exits 0 only when nothing failed and nothing is blocked.
- It is **not shipped**: it lives in `release/`, which is outside `template/`, and it is not on the
  allowlist. The gate proves both.
- `ROLLOUT_GATE_ONLY=id,…` runs a single check. It exists so one check can be re-run without repeating
  the whole gate; the whole gate is the one that counts.

## 9. The next stage

S1 — baseline re-verification, no regression — begins when the operator merges this pull request. Its
entry gate is "S0 PASS", and the S0 work above is what makes that true.
