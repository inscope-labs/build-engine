# BE-0 work package 1 — the three contract documents

- **Stage:** BE-0 (contract reconciliation and decisions) — build-engine 0.6.0 Standard
- **Branch:** `docs/be-0-contract-documents`
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07), clean checkout
- **Run:** 2026-11-07T09:04Z → 2026-11-07T09:xxZ
- **Scope:** three new documents under `docs/release/`. No code, no configuration, no shipped content.

## 1. Intent

BE-0 asks for three documents that do not exist yet: a cross-system compatibility matrix, a capability
conformance definition for the three capability formats, and a `cbridge` coverage matrix. This work package
is the first of the five BE-0 pull requests and carries the first document only, because the operator's
brief puts the protocol-identifier change and the `workers.dev` gate change in **separate** pull requests
and this one must stay reviewable on its own.

The three documents written here are:

| File | What it is |
|---|---|
| `docs/release/COMPATIBILITY-MATRIX.md` | The one supported combination for 0.6.0, the unsupported ones, the proposed machine-readable compatibility record and its schema, and the inventory of every place that carries `build-engine/0.5`. |
| `docs/release/CAPABILITY-CONFORMANCE.md` | Signing, scope, expiry, revocation and replay for `ctxop-v1`, the read link and the write root capability; the two replay gaps with options; the task-state transition contract (D-4). |
| `docs/release/CBRIDGE-COVERAGE-MATRIX.md` | Every `cbridge` command → a native Android feature or a documented alternative, with the evidence for each. |

## 2. Per-task, done / not done

| # | Task | Done | Evidence |
|---|---|---|---|
| 1.1 | Find the `ctxop-v1` specification; cite it by path and commit | **done** | `inscope-labs/operator-console` @ `992defff591d39539bcc8b4ca3cbc14eb9bab783`: `docs/capability-format.md` (the format), `docs/adr/0001-capability-signing-direction.md` (Model B — the console mints, the gateway verifies), `docs/adr/0005-signature-encoding.md` (the algorithm is a property of `kid`; raw IEEE P1363; task-scoped vs engine-scoped). It is **not** invented here. |
| 1.2 | Determine, from code and tests, what each gateway does about replay today | **done** | Read link: `conformance/SCHEME.md` §2, §4.4, §7; `gateway/read/production/src/rules.ts`; `conformance/cases/behaviours.json` (no replay case). Write root: `gateway/write/docs/protocol.md` §2.2, §2.5, §6.2, §6.3. `ctxop-v1`: operator-console `gateway/src/capability/gate.ts`, `gateway/src/durable-objects/nonce-store.ts`, `gateway/tests/unit/capability/nonce.test.ts`. |
| 1.3 | Record the required rule as NOT MET where it is not met, with options, and stop for the decision | **done** | GAP R-1 (read link reusable until expiry) and GAP R-2 (write root is a bearer credential) in `CAPABILITY-CONFORMANCE.md` §5, each with the evidence, four (resp. three) options, and a recommendation. **Nothing is described as satisfied that is not.** |
| 1.4 | Include the version-record schema design as a proposed section for the operator's approval | **done** | `COMPATIBILITY-MATRIX.md` §3 — the JSON Schema, the six validator rules, and the proposed file paths. The validator is **not** implemented; that is BE-8. |
| 1.5 | Map every `cbridge` command to a native Android feature or a documented alternative | **done** | `CBRIDGE-COVERAGE-MATRIX.md` §2 — thirteen rows (eleven commands plus local Git and shell), none empty. |
| 1.6 | Cover `init`, `bootstrap`, `verify`, local Git and shell with a documented alternative | **done** | The same file, §2.1. `verify` is the script's `verify-main` (`cmd_verify_main`, `template/operator/cbridge:110`); the naming difference is noted in §1 of that document. |
| 1.7 | Mark a row "covered by native feature" only with a passing test or an operator-console closeout reference | **done** | Every evidence cell names a file at a named commit. **One row is native** (`status`); seven are unverified; five are documented alternatives. The agent reports that **no operator-console test was executed** — that repository is read-only for this stage. |
| 1.8 | Reconcile the task-state model (D-4) | **done, as a proposal** | `CAPABILITY-CONFORMANCE.md` §6 defines the transition operation and the states, and §6.3 records the open question (which gateway owns the state) with a recommendation. The state set is proposed, not imposed on the shipped schema. |
| 1.9 | Inventory every place carrying `build-engine/0.5` | **done** | `COMPATIBILITY-MATRIX.md` §4.1 — seven places, each with the reason it changes or does not change. |
| 1.10 | Change the protocol identifier | **NOT DONE — deliberately** | The operator's brief requires it in a **separate** pull request. §4.2 of the matrix records the sequencing problem this creates and asks the operator to choose (Q-1). |
| 1.11 | Execute the write gateway's transfer path (BE-6) | **NOT DONE** | Out of BE-0. |
| 1.12 | Deploy anything | **NOT DONE** | Nothing was deployed; no Cloudflare resource was created, changed or read with a credential. |

## 3. Checks run in this session

Every command below was run from the repository root at `d6b6bda` with the three new documents present but
not committed, and the output was inspected.

| Command | Result |
|---|---|
| `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |
| `python3 conformance/harness/run.py all --reference` | `94 passed, 0 failed` |
| `python3 -m unittest discover -s ops -p 'test_*.py'` | `Ran 11 tests` — **OK** |
| `release/test-release.sh` | `94 passed, 0 failed` |
| `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| `release/package.sh dist` | `packaged 41 files, 0.5.0` |
| `release/verify.sh "dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz" --test-payload` | `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0, payload tests run)` |
| `npm test` (read gateway, `gateway/read/production`) | see §3.1 |
| `npm run test:unit` and `npm run test:integration` (write gateway, `gateway/write`) | see §3.1 |

### 3.1 The gateway suites

Run in this session, from the same checkout, after `npm ci` in each gateway directory.

| Command | Result |
|---|---|
| `npm test` (read gateway) | `# tests 20` — `# pass 20`, `# fail 0` |
| `npm run ops:check` (read gateway) | `wrangler.toml matches ops/environments.json, and the configuration is valid.` |
| `npm run check:bundle` (read gateway) | `test ok`, `staging ok`, `production ok` — "the Worker builds for every environment, and every configuration is understood." |
| `npm run typecheck` (write gateway) | no output, exit 0 — the three programs (`tsc --noEmit`, `tsconfig.test.json`, `tsconfig.scripts.json`) |
| `npm run test:unit` (write gateway) | `# tests 255` — `# pass 255`, `# fail 0` |
| `npm run test:integration` (write gateway) | `# tests 85` — `# pass 85`, `# fail 0` |
| `npm run test:load` (write gateway) | `# tests 12` — `# pass 12`, `# fail 0` |
| `npm run test:chaos` (write gateway) | `# tests 20` — `# pass 20`, `# fail 0` |
| `npm test` (write gateway, everything) | **`# tests 372` — `# pass 372`, `# fail 0`** |
| `npm run check:contract` (write gateway) | `OK: the contract documents agree` |
| `npm run check:staging` (write gateway) | `OK: the write staging environment is separate from production` |
| `npm run check:staging:read` (write gateway) | `OK: the read staging environment is separate from production` |

**Note for the reader of `CAPABILITY-CONFORMANCE.md` §3:** the write gateway's suite is **372 tests, all
passing** at this baseline. That number is now evidenced rather than inherited from the Stage 6.3 closeout.

**Not run in this session:** the read gateway's conformance-against-the-local-runtime job
(`npm run test:conformance`), the abuse controls (`npm run test:abuse`), the operational checks
(`npm run test:staging`) and the isolation proof (`npm run test:isolation`). Those four start the local
Cloudflare Workers runtime and are not affected by a documentation-only change; **they are left to the CI
run on this pull request**, and their result is reported in the final stage closeout rather than claimed
here.

The agent did not run any check in `inscope-labs/operator-console`: that repository is read-only for this
stage, and nothing is claimed about its tests.

## 4. Findings that are not defects but change the plan

1. **The `ctxop-v1` specification exists and is implemented** — the brief's premise that "no specification
   exists in this repository" is correct, but the specification is not missing from the world: it is in
   operator-console, and its replay protection (a single-use nonce, stored before the operation) is
   implemented. **GAP R-1 and GAP R-2 are the two that remain open**, and both are in this repository.
2. **The replay requirement is met by exactly one of the three formats.** `ctxop-v1` meets it. The read link
   does not, and does not claim to. The write root does not, at the capability level, though its
   *operations* are idempotent and precondition-guarded — which the deployed pilot exercised on 2026-11-05.
3. **`cbridge`'s Android replacement is an implementation gap, not a mapping gap.** Six of the eleven
   commands map to an Android use case that is a `TODO(...)` placeholder, and five of the gateway routes that
   would serve them answer `501 NOT_IMPLEMENTED` **by design**. One command (`status`) has a working native
   path today. The matrix says so rather than rounding it up.
4. **`cbridge` must keep shipping.** It is the only working Class A delivery route until the console's
   `UploadSubmissionUseCase` is real. Removing it from the artifact before then would remove the product's
   only delivery path — a sequencing constraint on BE-8 that is now written down.
5. **The protocol-identifier change cannot be separated from the version step without leaving the release
   gate red on `main`.** The identifier alone makes `verify.sh --release` fail, because `protocol` would be
   `build-engine/0.6` and the release version `0.5.0`. Three options are put to the operator (Q-1).

## 5. Evidence gathered outside the repository

| Evidence | How it was obtained | Date |
|---|---|---|
| The deployed staging pilot passed **44 checks** against the deployed staging gateways, in `signed` mode, including "the retry was a replay, not a second commit", order and task revocation, and the audit-hygiene checks. | GitHub Actions run `41964576712` of the `staging-pilot` workflow on `main` @ `3028b7d` — the run log was read through the GitHub API. | read 2026-11-07; run 2026-11-05 |
| A `probes-only` pilot run passed 12 checks. | GitHub Actions run `41964198047`. | read 2026-11-07; run 2026-11-05 |
| operator-console's `ctxop-v1` specification, implementation and tests. | The repository was cloned read-only at `992deff` and read. **Nothing was executed there and nothing was modified.** | 2026-11-07 |

## 6. Risks and unresolved questions

**Risks.**

- The three documents are long and they are the whole of BE-0's contract surface. A reviewer who reads only
  the tables will still get the right answer: every table states its status vocabulary.
- The compatibility matrix proposes a schema that has not been reviewed. If the operator wants a different
  shape, the BE-8 validator work changes with it — that is why the schema is a *proposal* here and not an
  implementation.

**Unresolved questions, all of them for the operator** (collected in one place):

| # | Question | Where |
|---|---|---|
| Q-1 | The protocol-identifier change: identifier alone, or identifier and version together? | `COMPATIBILITY-MATRIX.md` §4.2, §8 |
| Q-2 | The console APK's version name, version code and signing fingerprint | `COMPATIBILITY-MATRIX.md` §8 |
| Q-3 | Each gateway's `worker_version_id` (only exists after a deploy) | `COMPATIBILITY-MATRIX.md` §8 |
| Q-4 | Where the compatibility record lives: committed, published as an asset, or both | `COMPATIBILITY-MATRIX.md` §8 |
| Q-5 | The final form of the gateway hostnames | `COMPATIBILITY-MATRIX.md` §8 |
| Q-A | What "cross-system conformance" means | `CAPABILITY-CONFORMANCE.md` §3, §8 |
| Q-B | Which gateway owns the task state | `CAPABILITY-CONFORMANCE.md` §6.3, §8 |
| Q-C | **GAP R-1**: the read link is reusable until it expires | `CAPABILITY-CONFORMANCE.md` §5, §8 |
| Q-D | **GAP R-2**: the write root capability is a bearer credential | `CAPABILITY-CONFORMANCE.md` §5, §8 |
| Q-E | Whether `ctxop-v1`'s per-capability revocation is required for 0.6.0 | `CAPABILITY-CONFORMANCE.md` §8 |
| Q-CB-1 | Whether OC-7's acceptance requires the gateway route to be non-stub | `CBRIDGE-COVERAGE-MATRIX.md` §5 |
| Q-CB-2 | `cbridge upload` vs Gateway C: which is the supported route in 0.6.0 | `CBRIDGE-COVERAGE-MATRIX.md` §5 |
| Q-CB-3 | Whether the console needs a divergence report | `CBRIDGE-COVERAGE-MATRIX.md` §5 |

## 7. What the agent needs before the next stage

- **Nothing.** This work package is complete and self-contained. The decisions listed in §6 are needed
  before **BE-4** (the deploy gates) and before **BE-8** (the record and the tag), and Q-C/Q-D are needed
  before the release can claim that the capability set is conformant.
- The operator merges; the agent does not merge, tag or release.
