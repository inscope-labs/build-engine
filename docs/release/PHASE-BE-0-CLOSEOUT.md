# Phase BE-0 closeout — contract reconciliation and decisions

- **Stage:** BE-0 of `docs/release/V0.6.0-BUILD-PLAN.md` — contract reconciliation and decisions (docs only,
  with two code changes the operator's brief put in separate pull requests).
- **Release:** 0.6.0 Standard (ADR 0006).
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07), clean checkout.
- **Closed:** 2026-11-07.
- **Agent reports:** `agent-reports/2026-11-07T09-04-00Z-be-0-contract-documents.md`,
  `…09-20-00Z-be-0-register-status-readme.md`, `…09-30-00Z-be-0-protocol-identifier.md`,
  `…09-45-00Z-be-0-production-workers-dev.md`, `…10-00-00Z-be-0-pending-register-p001-cancelled.md`,
  `…10-20-00Z-be-0-closeout.md`.

## 1. Intent

BE-0 is the stage that "blocks everything else". It asks for one authoritative contract for Gateways A, B
and C, the Android app, the engine and the three capability types (assessment item 39), and it closes the
decisions D-1 to D-7 that the plan gates on.

The operator's brief added four things to the stage's scope, each in its own pull request: the three
documents, the register and status update, the protocol-identifier change, the production `workers.dev` gate
change, and the cancellation of P-001.

**What this stage did not do:** it did not deploy anything, did not handle a credential, did not merge, did
not tag and did not publish. It found no new defect. It opened **six** decisions for the operator, two of
them gaps in the capability model that the release cannot claim to be conformant until they are answered.

**A note on what is where.** This closeout is a pull request of its own, based on `main`, and it adds two
files that no other pull request in this stage touches. The files it names — the three contract documents and
the four earlier agent reports — are **on the open pull requests below**, not yet on `main`. Each is named
with the pull request that carries it, and every one was checked at its branch.

## 2. Per-task, done / not done

### 2.1 The plan's BE-0 scope

| # | Task | Done | Evidence |
|---|---|---|---|
| 0.1 | `docs/release/COMPATIBILITY-MATRIX.md` — supported combinations of engine, console APK, operator gateway, read gateway, write gateway | **done** | PR #44; the file |
| 0.2 | `docs/release/CAPABILITY-CONFORMANCE.md` — signing, scope, expiry, revocation, replay per capability | **done**, with **two gaps recorded and not papered over** | PR #44; the file, §5 |
| 0.3 | `docs/release/CBRIDGE-COVERAGE-MATRIX.md` — every `cbridge` command → native feature or documented alternative | **done** | PR #44; the file, §2 — thirteen rows, none empty |
| 0.4 | Task-state reconciliation (D-4) | **done as a proposal** | PR #44; `CAPABILITY-CONFORMANCE.md` §6 — the transition operation is defined; the ownership question (Q-B) is open |
| 0.5 | Close D-1 … D-7 | **already closed** by ADR 0006–0009 before this stage | `docs/decisions/0006`…`0009`; `PHASE-BE-0-REPORT.md` |
| 0.6 | Decisions recorded in `docs/decisions/` | **done** | ADR 0006 (D-1…D-4), 0007 (D-5), 0008 (D-6), 0009 (D-7) |
| 0.7 | Matrix reviewed by the operator | **NOT DONE — the operator's review** | The matrix is a draft; the review is the operator's |
| 0.8 | Version metadata plan agreed | **done as a proposal** | PR #44; `COMPATIBILITY-MATRIX.md` §3 — the JSON Schema and the six validator rules; the validator is BE-8 |

### 2.2 The operator's brief, task by task

| # | Task | Done | Evidence |
|---|---|---|---|
| B.1 | Find the `ctxop-v1` specification in operator-console, cite it by path and commit | **done** — it exists | `inscope-labs/operator-console` @ `992defff591d39539bcc8b4ca3cbc14eb9bab783`: `docs/capability-format.md`, `docs/adr/0001`, `docs/adr/0005` |
| B.2 | Determine from code and tests what each gateway does about replay today | **done** | `CAPABILITY-CONFORMANCE.md` §4.1–§4.3, each with a file:line |
| B.3 | Record the unmet rules as GAPs with evidence and options; stop for the decision | **done** | GAP R-1 and GAP R-2, with four and three options each and a recommendation |
| B.4 | Include the version-record schema design as a proposed section for approval | **done** | `COMPATIBILITY-MATRIX.md` §3.1 |
| B.5 | Update `DEFECT-REGISTER.md` and `docs/STATUS.md` for ADR 0007 and the Phase 6 results | **done** | PR #45; R0-005, R0-007, R0-013, R0-014 |
| B.6 | Correct the four README "unreleased" lines, each verified against the current README | **done** | PR #45; the four lines are listed individually in the agent report |
| B.7 | Open a separate pull request for the protocol identifier change | **done** | PR #46 |
| B.8 | Open a separate pull request for the production `workers.dev` gate change | **done** | PR #47 |
| B.9 | Keep ADR 0008 item 4's shared-zone mitigations in force | **done** | PR #47; its agent report §3 maps each mitigation to the check that enforces it |
| B.10 | Merge PR #30 with P-001 CANCELLED as entered in error; check the file for other items; rebase onto current main | **done** — the branch is updated and rebased; **the merge is the operator's** | PR #30; `docs/PENDING-REGISTER.md` |

### 2.3 Not done, and why

| Task | Why |
|---|---|
| Merge any pull request | The operator merges. G-12 and the brief. |
| Create the `v0.6.0` tag, publish anything, write release notes | G-12 and the brief: the tag comes only after the operator's written go-ahead naming the version and the commit SHA. |
| Deploy a gateway, create a Cloudflare resource, handle a credential | The brief forbids it for this assignment; the operator creates every production secret and approves every production deploy. |
| Implement the compatibility-record validator | BE-8. The schema is proposed here for the operator's approval. |
| Build the submissions-to-consumer transfer (R0-011) | BE-6, and it needs the operator's design approval first. |
| Close GAP R-1, GAP R-2, GAP C-1 | They need the operator's decision (Q-C, Q-D, Q-A). |
| Write the compatibility record, the APK fingerprint, the `worker_version_id`s | BE-8, and they need values that do not exist yet (Q-2, Q-3). |
| Bump the gateways' own version constants | BE-8's version step. Recorded in PR #46's agent report. |
| Review the compatibility-date bump (R0-008's open half) | BE-4 and BE-5. |

## 3. Evidence

### 3.1 The pull requests

| PR | Title | Base | CI |
|---|---|---|---|
| [#44](https://github.com/inscope-labs/build-engine/pull/44) | docs(release): BE-0 — the compatibility matrix, the capability conformance and the cbridge coverage matrix | `main` | **7/7 green** |
| [#45](https://github.com/inscope-labs/build-engine/pull/45) | docs(release): BE-0 — the register, STATUS and the four README corrections | `main` | **7/7 green** |
| [#46](https://github.com/inscope-labs/build-engine/pull/46) | feat(release): the protocol identifier moves to build-engine/0.6 | `main` | **7/7 green** |
| [#47](https://github.com/inscope-labs/build-engine/pull/47) | feat(gateways): production moves to workers.dev (ADR 0008 decision 2) | `main` | **7/7 green** |
| [#30](https://github.com/inscope-labs/build-engine/pull/30) | docs: the Pending Register, with P-001 cancelled as entered in error | `main` | see the agent report |
| [#48](https://github.com/inscope-labs/build-engine/pull/48) | docs(release): BE-0 closeout | `main` | this pull request |

### 3.2 Checks run in this session, at the baseline

Every command was run from a clean checkout of `main` at `d6b6bda`, and the output was inspected.

| Check | Command | Result |
|---|---|---|
| Shipped engine tests | `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| Gateway read reference | `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| Conformance suite | `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |
| Conformance harness | `python3 conformance/harness/run.py all --reference` | `94 passed, 0 failed` |
| Fault injector's own tests | `python3 -m unittest discover -s ops -p 'test_*.py'` | `Ran 11 tests` — **OK** |
| Release machinery self-test | `release/test-release.sh` | `94 passed, 0 failed` |
| Consumer install and update flow | `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| Package (dry run) | `release/package.sh dist` | `packaged 41 files, 0.5.0` |
| Verify (dry run) | `release/verify.sh "dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz" --test-payload` | `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0, payload tests run)` |
| Read gateway unit tests | `npm test` (read gateway) | `# tests 20` — `# pass 20`, `# fail 0` |
| Read gateway configuration | `npm run ops:check` | `wrangler.toml matches ops/environments.json, and the configuration is valid.` |
| Read gateway bundle | `npm run check:bundle` | `test ok`, `staging ok`, `production ok` |
| Write gateway typecheck | `npm run typecheck` | exit 0 — three programs |
| Write gateway unit tests | `npm run test:unit` | `# tests 255` — `# pass 255`, `# fail 0` |
| Write gateway integration | `npm run test:integration` | `# tests 85` — `# pass 85`, `# fail 0` |
| Write gateway load | `npm run test:load` | `# tests 12` — `# pass 12`, `# fail 0` |
| Write gateway chaos | `npm run test:chaos` | `# tests 20` — `# pass 20`, `# fail 0` |
| Write gateway, everything | `npm test` | **`# tests 372` — `# pass 372`, `# fail 0`** |
| Write gateway contract consistency | `npm run check:contract` | `OK: the contract documents agree` |
| Write gateway staging separation | `npm run check:staging` | `OK: the write staging environment is separate from production` |
| Read gateway staging separation | `npm run check:staging:read` | `OK: the read staging environment is separate from production` |
| Shell syntax | `bash -n` over `release/*.sh`, `tests/*.sh`, `gateway/read/production/ops/*.sh`, `ops/*.sh`, and the shipped scripts | no output |
| Python syntax | `python3 -m py_compile` over the operator tooling and every gateway check script | no output |

### 3.3 Evidence gathered outside the repository

| What | How | When |
|---|---|---|
| The **deployed signed pilot passed 44 checks** against the deployed staging gateways — read leg, write leg, "the retry was a replay and not a second commit", revocation, and the audit-hygiene scan | GitHub Actions run `41964576712` of the `staging-pilot` workflow, `signed` mode, `main` @ `3028b7d`; the run log was read through the API | run 2026-11-05, read 2026-11-07 |
| A `probes-only` pilot run passed 12 checks | run `41964198047` | run 2026-11-05 |
| The `ctxop-v1` specification, its implementation and its tests | `inscope-labs/operator-console` was cloned **read-only** at `992deff` and read. **Nothing there was executed and nothing there was modified.** | 2026-11-07 |
| `main`'s branch protection: a pull request and the `test` check are required; no required reviews; administrators not enforced; force-push blocked; deletions allowed; no tag rule | `GET /repos/…/branches/main/protection` and `GET /repos/…/rulesets` | 2026-11-07 |
| The published release and its assets | `GET /repos/…/releases` — `v0.5.0`, published 2026-10-29, with the tarball and its `.sha256` | 2026-11-07 |

### 3.4 The gates were proved to fail

A gate nobody has seen fail is not known to be a gate. Four regressions were planted in scratch copies of the
tree — **never in the working repository** — and the gates were run:

| Regression planted | Result |
|---|---|
| the write gateway's production `workers_dev` reverted to `false` | `FAIL production is exposed on workers.dev (ADR 0008, decision 2), and the setting says so` → exit 1 |
| the read gateway's production given a wildcard route | `configuration is invalid: production declares a wildcard route: '*.qnuralink.workers.dev'` → `refusing to render` |
| the read gateway's production `exposure` removed | `configuration is invalid: production does not declare how it is exposed` → `refusing to render` |
| an environment exposed on `workers.dev` **and** a route | `configuration is invalid: … an environment has exactly one host, and the host is part of the work-order contract` → `refusing to render` |

And the release-gate fixtures were measured the same way, in scratch copies:

| Tree | Fixtures | Result |
|---|---|---|
| `VERSION 0.5.0`, `protocol build-engine/0.6` | the old, hard-coded ones | `93 passed, 1 failed` |
| `VERSION 0.5.0`, `protocol build-engine/0.6` | the new, derived ones | **`94 passed, 0 failed`** |
| `VERSION 0.6.0` (as BE-8's `set-version.sh` will make it) | the old ones | `90 passed, 4 failed` |
| `VERSION 0.6.0` | the new ones | **`94 passed, 0 failed`** |

## 4. What changed in the repository, in one table

| File | Change | PR |
|---|---|---|
| `docs/release/COMPATIBILITY-MATRIX.md` | **new** — the supported combination, the unsupported ones, the compatibility-record schema, and the inventory of every place carrying the protocol identifier | #44 |
| `docs/release/CAPABILITY-CONFORMANCE.md` | **new** — the five properties for each of the three capability formats, the two replay gaps, the task-state contract | #44 |
| `docs/release/CBRIDGE-COVERAGE-MATRIX.md` | **new** — every `cbridge` command, with the evidence for each row | #44 |
| `docs/release/DEFECT-REGISTER.md` | R0-005 and R0-007 **accepted**; R0-013 **closed**; R0-014 **accepted**; addendum A12 | #45 |
| `docs/STATUS.md` | both releases, the staging deployment, the accepted risks, and what stands in the way of 0.6.0 | #45 |
| `README.md` | the four "unreleased" lines, and three statements the same evidence falsified | #45 |
| `template/engine/release.json` | the protocol identifier → `build-engine/0.6` | #46 |
| `release/verify.sh` | the two example messages name the current identifier | #46 |
| `release/test-release.sh` | the release-gate fixtures derive from `VERSION` instead of hard-coding `0.5.0` | #46 |
| `gateway/read/production/ops/environments.json` | production's exposure is `workers.dev`; the placeholder route is gone | #47 |
| `gateway/read/production/ops/render-environments.py` | the production rule is replaced by the shared-zone rules | #47 |
| `gateway/read/production/ops/environments.md` | the table, the rules, the placeholders and the stale "no environment has been published" | #47 |
| `gateway/read/production/wrangler.toml` | **regenerated** | #47 |
| `gateway/write/wrangler.toml` | the production `workers_dev` setting → `true` | #47 |
| `gateway/write/scripts/check-staging-separation.py`, `check-production.py` | the gates follow the decision | #47 |
| `gateway/write/docs/protocol.md` §12.5, `security-checklist.md`, `operator-runbook.md`, `ci/staging-separation.yml` | the contract and the operator's documents follow the configuration | #47 |
| `docs/release/PRODUCTION-WORKFLOWS.md`, `DEFECT-REGISTER.md` (R0-008) | they stated the old gate | #47 |
| `docs/PENDING-REGISTER.md` | P-001 **cancelled**, the branch rebased onto current `main` | #30 |

## 5. Risks

| Risk | Where it is handled |
|---|---|
| **The release gate is red on `main` between PR #46 and BE-8's version step.** `protocol` is `build-engine/0.6` and `VERSION` is `0.5.0`. | It is the gate doing its job. CI runs the default verification and stays green; the published 0.5.0 asset is untouched. BE-8 runs `release/set-version.sh 0.6.0`, which closes it. Recorded in `COMPATIBILITY-MATRIX.md` §4.2 and in PR #46's agent report. |
| **The two replay gaps are open.** The read link is reusable until it expires, and the write root capability is a bearer credential. | Recorded as GAP R-1 and GAP R-2 with evidence, options and a recommendation. **The release cannot claim the capability set is conformant until the operator answers Q-C and Q-D.** |
| **Production is on a public `workers.dev` hostname** rather than one named host. | The operator's decision (ADR 0008). What replaces the old guarantee is the shared-zone separation, and each mitigation is checked by a gate (PR #47's agent report §3). |
| **The production deploy is one placeholder away.** The `workers_dev` change removed the gate that used to stop it; the repository placeholder is now the only thing that does. | The deploy gate still refuses a placeholder, the production deploy workflow is manual, and the operator approves every production deploy at run time. |
| **`cbridge` is still the only working Class A delivery route.** The Android console's `UploadSubmissionUseCase` is a `TODO(...)`. | Recorded in `CBRIDGE-COVERAGE-MATRIX.md` §4 as a sequencing constraint on BE-8: removing `cbridge` from the artifact before the console's upload is real would remove the product's only delivery path. |
| **The write gateway's `workers_dev` change is a contract change**, and the contract is normative. | `protocol.md` §12.5 was changed with it, in the same pull request, and `npm run check:contract` passes. |
| **The compatibility record's schema is a proposal**, not an approved shape. | It is presented for the operator's approval in `COMPATIBILITY-MATRIX.md` §3.1, and the validator is BE-8. |

## 6. Unresolved questions — the operator's decisions

All six are collected in `docs/release/COMPATIBILITY-MATRIX.md` §8 and `docs/release/CAPABILITY-CONFORMANCE.md`
§8, and `docs/release/CBRIDGE-COVERAGE-MATRIX.md` §5. In one place:

| # | Question | The agent's recommendation | Needed by |
|---|---|---|---|
| **Q-C** | **GAP R-1**: the read link is reusable until it expires. Accept, or change the scheme to single-use (R-1.b), bounded reuse (R-1.c), or observable replay (R-1.d)? | R-1.a plus R-1.d | **BE-8** (the release cannot claim conformance) |
| **Q-D** | **GAP R-2**: the write root capability is a bearer credential. Accept (R-2.a), redeem once (R-2.b), or bind it to the agent's identity (R-2.c)? | R-2.a now, R-2.c later | **BE-8** |
| **Q-A** | What does "cross-system conformance" mean — one shared suite, three per-format suites plus the document, or a shared suite for the shared properties only? | (c) | BE-7 |
| **Q-B** | Which gateway owns the task state, and how do Gateway A's state and Gateway C's seal stay consistent? | Gateway A owns the state, Gateway C owns the seal, and `SET_DONE` is accepted only against a sealed task | BE-7 / OC-6 |
| **Q-E** | Is `ctxop-v1`'s per-capability revocation (a 501 stub in Gateway A today) required for 0.6.0, or is key retirement enough? | Per-capability revocation is required | OC-1 / OC-4 |
| **Q-CB-1** | Does OC-7's acceptance require the gateway route to be non-stub, as well as a named test? | Yes | OC-7 |
| **Q-CB-2** | `cbridge upload` vs Gateway C: which is the supported route in 0.6.0? | both, until the console's upload lands | BE-6 / BE-8 |
| **Q-CB-3** | Does the console need a divergence report, or is "the head moved" enough? | the head check is enough | OC-7 |
| **Q-1** | The protocol-identifier change: identifier alone, or identifier and version together? | **answered**: the identifier changed (PR #46); the version moves at BE-8, because ADR 0006 forbids the metadata change before the conditions hold | — |
| **Q-2** | The console APK's version name, version code and signing fingerprint | the operator supplies them | BE-8 |
| **Q-3** | Each gateway's `worker_version_id` | recorded after the deploy | BE-8 |
| **Q-4** | Where the compatibility record lives: committed, published as an asset, or both | both | BE-8 |
| **Q-5** | The final form of the gateway hostnames | fixed at the first production deploy, recorded then | BE-4 / BE-5 |

## 7. What the agent needs before BE-1

**Nothing blocks BE-1 and BE-2.** Those two stages are re-verification of stacks that are already merged, and
they need no decision from the operator.

**BE-3, BE-4 and BE-5 need the operator's production inputs**, which cannot come from this repository:

- the production read repository (`GITHUB_REPO`) — the operator's placeholder is still in place;
- the write gateway's submissions repository and branch;
- the production signing keys, the operator tokens and the GitHub credentials (read-only for the read
  gateway; limited to the submissions repository for the write gateway);
- the account subdomain that makes the per-Worker hostnames what they are;
- **an explicit operator approval at run time for every production deploy** — no unattended deploys.

**And the operator's merges.** The operator merges these six pull requests in whatever order they choose;
the agent has not merged, tagged, published or deployed anything.
