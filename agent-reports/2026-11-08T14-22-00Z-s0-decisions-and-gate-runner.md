# S0 work package — the operator's decisions land, and the gate runner

- **Stage:** S0 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (closes BE-0)
- **Branch:** `docs/s0-documents-and-gate-runner`
- **Baseline:** `main` at `64ce044` — PR #49, *"docs: record S0 decisions (ADR 0010-0013) and amend the
  v0.6.0 rollout plan"*, merged 2026-11-08T13:48:47Z
- **Run:** 2026-11-08T14:00Z → 2026-11-08T14:22Z
- **Commits:** `f193677`, `f5a34f4`, plus the stage report
- **Scope:** `docs/release/` (three documents, one report) and `release/rollout-gate.sh`. **No code, no
  shipped content, no configuration, no workflow file.**

## 1. Intent

The operator's brief for this stage was *"I have completed S0. Execute S1 now."*

Checking that claim against the repository showed it was **half true**, and the half that was missing
blocked S1:

| What S0 asks for | State on `main` when this stage started |
|---|---|
| ADR 0010 to ADR 0013, decided | **done** — merged as PR #49 on 2026-11-08T13:48:47Z |
| The rollout plan | **done** — same PR |
| The three BE-0 documents no longer say draft | **not done** — all three still carried `**Status:** DRAFT for the operator's review (BE-0).` |
| §6.1 reconciled to the shipped schema | **not done** — it still proposed `pending`/`ordered`/`blocked`/`cancelled` |
| `release/rollout-gate.sh` | **did not exist** |

S1's entry gate is "S0 PASS". The plan assigns the outstanding items to the agent
(`docs/release/S0-AGENT-HANDOFF.md`), and the work is small and mechanical. So the agent completed the
outstanding S0 work first, ran the gate, and only then went on to S1. **This is stated, not done
quietly**, and it is the reason this stage exists as a pull request of its own.

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 1 | The three documents leave the draft status and cite the deciding ADR | **done** | `COMPATIBILITY-MATRIX.md` → ADR 0012; `CAPABILITY-CONFORMANCE.md` → ADR 0010 and ADR 0011; `CBRIDGE-COVERAGE-MATRIX.md` → ADR 0011. Each §8 is now "Decisions this document raised, and where each was answered", and each answer says what it *requires* — an answer that requires work is not the same as an answer that closes something. |
| 2 | GAP R-1 and GAP R-2 recorded as accepted gaps with a citation | **done** | `CAPABILITY-CONFORMANCE.md` §5. Both carry the operator's decision, the residual risk that was accepted, what is still to be built, and the stage that builds it. **Neither is described as satisfied.** |
| 3 | Option R-2.c named as a later cross-system stage, not part of 0.6.0 | **done** | §5 (GAP R-2) and §8 (Q-D): *"Option R-2.c — bind the root capability to an agent identity — is recorded as a later cross-system stage … and is not part of 0.6.0."* |
| 4 | §6.1 reconciled to `template/engine/schemas/task.schema.json` | **done** | The state list is now the schema's: `planned`, `in_progress`, `pr_open`, `done`, `dropped`, `superseded`. |
| 5 | Every difference reported | **done** | A difference table in §6.1: `pending`→`planned`; `ordered` dropped; `pr_open` added; `blocked` dropped **as a status** (the schema carries `blocked_by` as a *field*); `cancelled`→`dropped`; `superseded` added. |
| 6 | The shipped schema unchanged | **done** | `git diff v0.5.0..HEAD -- template/engine/schemas/` is empty. ADR 0011 item 2 says the schema does not change, so it did not. |
| 7 | `release/rollout-gate.sh <stage>` created | **done** | It runs the nine standing checks of the plan's §4, queries the `[E]` conditions, prints PASS / FAIL / BLOCKED-EXTERNAL per check with the command it ran and an excerpt of the output inspected, and exits 0 only when nothing failed and nothing is blocked. |
| 8 | The runner is not shipped | **done** | `release/manifest.txt` does not list it; the built artifact's 41 members carry no `rollout-gate.sh`. Three separate checks prove it: `S0-NOTSHIPPED`, the `C-SECRETS` check and `C-ISO`. |
| 9 | The gate run at the baseline SHA | **done** | `release/rollout-gate.sh S0` → exit 0, **28 PASS, 0 FAIL, 0 BLOCKED-EXTERNAL**. |
| 10 | The stage report | **done** | `docs/release/PHASE-S0-REPORT.md`. |
| 11 | Decide anything the operator has not decided | **not done** | Where a decision was missing it was prepared as a draft ADR for the operator to adopt (the plan's S0 instruction). The operator then adopted them as ADR 0010-0013 and the drafts were replaced by the real records. |
| 12 | Merge, tag, publish or deploy | **not done** | The operator merges (G-12). No `main` push, no tag, no release, no deployment. |
| 13 | Change the version metadata | **not done** | ADR 0006 forbids it before the release conditions hold; `release/set-version.sh` belongs to S8. `VERSION` is still `0.5.0`. |

## 3. Checks run in this session

Every command was run from the repository root and its output inspected. The full gate log is in
`docs/release/PHASE-S0-REPORT.md` §3.

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-PROT` | `GET /repos/inscope-labs/build-engine/branches/main/protection` | 0 | pull request required, required check `test`, force-push blocked |
| `C-CI` | `GET /repos/inscope-labs/build-engine/commits/main/check-runs` | 0 | 7 check runs, all `success` |
| `C-BASE` | `python3 -m unittest discover -s template/engine/tools` | 0 | `OK` |
| `C-BASE` | `release/test-release.sh` | 0 | `94 passed, 0 failed` |
| `C-BASE` | `tests/test_update.sh` | 0 | `150 passed, 0 failed` + `22 passed, 0 failed` |
| `C-CONF` | `python3 conformance/harness/run.py all --reference` | 0 | `94 passed, 0 failed` |
| `C-CONF` | `python3 -m unittest discover -s conformance -p 'test_*.py'` | 0 | `OK` |
| `C-CONF` | `python3 -m unittest discover -s ops -p 'test_*.py'` | 0 | `OK` |
| `C-READ` | `npm test`, `ops:check`, `check:bundle` in `gateway/read/production`; `check:staging:read` in `gateway/write`; `python3 -m unittest discover -s gateway/read/reference` | 0 | `# fail 0`; `wrangler.toml matches ops/environments.json`; `the Worker builds for every environment`; `the read staging environment is separate from production`; `OK` |
| `C-WRITE` | `npm run typecheck`, `npm test`, `check:contract`, `check:staging` in `gateway/write` | 0 | no diagnostics; `# fail 0`; `the contract documents agree`; `the write staging environment is separate from production` |
| `C-ISO` | `release/package.sh dist` → `release/verify.sh … --test-payload` → the member list | 0 | `packaged 41 files`; `verify: OK (42 files, version 0.5.0, payload tests run)`; no `gateway/`, `conformance/`, `ops/`, `variants/`, `.github/`, no `wrangler.toml`, no `rollout-gate.sh` |
| `C-SECRETS` | the credential shapes in `release/forbidden.txt` + the `Bearer` literal shape, over the working tree and the diff against `origin/main` | 0 | no hit; 7 deliberate sentinels excluded by a file-scoped rule and listed by the check |
| `C-DIFF` | `git diff v0.5.0..HEAD` over `template/`, the allowlist, the forbidden rules and `tests/` | 0 | nothing removed; 4 files changed |
| `S0-*` | the stage's own checks | 0 | 11 PASS (4 ADRs, the ADR content, 3 documents, the state list, ADR 0008, the decisions index, the not-shipped check) |
| the whole gate | `release/rollout-gate.sh S0` | **0** | `PASS 28  FAIL 0  BLOCKED-EXTERNAL 0` |

## 4. Three defects the runner found in itself

The runner is checked against the repository the same way everything else is, and the first full run
failed. All three were real, and all three are fixed.

1. **The S1 lifecycle table was read with `read -r item file`**, so an item name with spaces was split
   and the mapping was nonsense — `no test file for: root root task single single sequence …`. It is
   pipe-delimited now, and the check passes with all 21 entries resolved.
2. **`run-conformance.py` is not executable**, so the S1 case count was `Permission denied`. It runs
   through the interpreter now, and the count is **58 passed** — exactly what the plan expects.
3. **The secret scan failed on the repository's own deliberate sentinels** (the hygiene token in
   `gateway/write/tests/helpers/hygiene.ts` and the redaction fixture in
   `gateway/write/tests/unit/audit/redaction.test.ts`), and it could not scan the private-key shape at
   all, because the pattern began with a dash and `grep` read it as an option. The exclusions are now
   file-scoped and written as *shapes* rather than as values, so the runner itself contains no complete
   credential shape and never has to excuse itself. Every exclusion is printed when it is used.

## 5. One finding for the stage that owns it

The runner's `[E]` query for S3 reports that the GitHub `production` environment **exists but has no
protection rule**:

```
GET /repos/inscope-labs/build-engine/environments
  production  protection_rules=0  reviewers=
  staging     protection_rules=0  reviewers=
```

S3's entry gate requires a required reviewer, so S3 will be BLOCKED-EXTERNAL until the operator adds
one. This is recorded in the S0 report's carried-forward conditions, because it is an operator action
and not agent work.

## 6. What was not done

- Nothing was merged, tagged, published or deployed. The pull request is the deliverable; the operator
  merges it.
- No credential value was read, printed, stored or written to a file. The runner queries APIs that list
  secret *names*. The session's GitHub credential was used only as an HTTP header and was deleted at the
  end of the run.
- No workflow file was touched (plan rule 7).
- The shipped payload was not touched by this stage.
- `release/verify.sh --release` remains red on `main`. It was red before this stage: the protocol
  identifier moved in PR #46 and ADR 0006 forbids the version metadata from moving until the release
  conditions hold. CI runs the default verification, which is green. This stage did not change it and
  does not paper over it.

## 7. The next stage

S1 — baseline re-verification, no regression — begins when the operator merges this pull request. S1's
entry gate is "S0 PASS", and the work in this pull request is what makes it true.
