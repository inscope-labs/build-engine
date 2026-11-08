# Stage S1 — baseline re-verification, no regression (Gate 1)

**Stage:** S1 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-1, BE-2).
**Entry gate:** S0 PASS — **met**: the operator merged the S0 pull request #50, and
`docs/release/PHASE-S0-REPORT.md` records that gate as PASS (28 PASS, 0 FAIL, exit 0).
**Baseline:** `main` at `0fe2f7a` — *"Merge pull request #50 from inscope-labs/docs/s0-documents-and-gate-runner"*,
merged by the operator on 2026-11-08. `VERSION` = `0.5.0`; tag `v0.5.0` → commit `c95ae51`; protocol
identifier `build-engine/0.6`.
**Branch:** `docs/s1-baseline-reverification`, based on that merge commit.
**Result:** **PASS** — every `[R]` item of the S1 exit gate is met, with the evidence below.
**Gate command:** `release/rollout-gate.sh S1`, exit 0.
**Work:** re-prove the already-merged Phase 4 and Phase 5 stacks on current `main`. **No re-implementation.**

> **One defect was found in the gate runner itself while running it**, and it is fixed in this pull
> request. The runner counted its verdicts in shell variables, and the C-READ and C-WRITE checks run
> inside a subshell — so a FAIL in either would have been printed and then counted as nothing, and
> the runner would have exited 0. It failed **open**. The verdicts are now counted through a file
> that every subshell shares, and the behaviour was proved against a planted failure: `FAIL 1`,
> `RESULT: FAIL`, exit 1. The exit codes were checked the same way — 0, 1 on a failure, 2 on a
> blocked condition, 4 on a usage error. This is the runner's own check; no gateway behaviour is
> affected.

## 1. The merge order of the Phase 4 and Phase 5 stacks

The plan asks for the merge order of PRs #7, #8, #11 and #13–#16, #22 to be confirmed from the PR
history. It was confirmed from the API, not from the branch names:

| PR | Merged at (UTC) | Merge commit | Title |
|---|---|---|---|
| #7 | 2026-10-31T23:09:43Z | `7b8fe487` | feat(conformance): Stage 4.1 conformance foundation |
| #8 | 2026-10-31T23:10:15Z | `03cfe578` | feat(gateway): Stage 4.2 production read gateway |
| #11 | 2026-10-31T23:11:02Z | `ba441c7e` | Stage 4.3: deployment and operational verification for the read gateway |
| #13 | 2026-10-31T23:33:18Z | `b4c6d4ec` | Stage 5.1: write-gateway protocol and security contract |
| #14 | 2026-10-31T23:33:33Z | `dbf96a3a` | Stage 5.2: write-gateway core request and session lifecycle |
| #15 | 2026-10-31T23:34:08Z | `57530221` | Stage 5.3: write gateway — GitHub commit and delivery |
| #16 | 2026-10-31T23:34:39Z | `da714fe1` | Stage 5.4: write gateway — audit, privacy and operations |
| #22 | 2026-11-01T00:03:10Z | `7b459c03` | Stage 5.5: the write gateway's real test suite and the CI gates |

**The order is exactly the plan's: #7 → #8 → #11 → #13 → #14 → #15 → #16 → #22.** Every one of them
was merged into `main`, in that order, with the Phase 4 stack (conformance → gateway → deployment) ahead
of the Phase 5 stack (contract → core → commit → operations → test suite), and the write gateway's test
suite landing last, after the gateway it tests.

## 2. `git diff v0.5.0..HEAD`, reviewed path by path

The plan's `C-DIFF` scope is `template/`, the release allowlist, the forbidden rules, and `tests/`. The
whole diff is 4 files in that scope, and **nothing was removed**.

### `template/` — 4 files

| File | Change | Justification | Regression risk |
|---|---|---|---|
| `template/docs/CONTEXT-EXPORT.md` | The "production path" table gains a **State** column; steps 1–5 are marked done with the file that proves each; the "not proven" paragraph is corrected — the GitHub-backed source adapter and the gateway's own work bounding now exist, and the statement that a gateway is not deployed is kept. | A shipped document that says the gateway does not exist when it does is a false statement in the consumer's hands. The document now distinguishes *built* from *deployed*, and says so explicitly: "Nothing in the steps above says that a gateway is deployed: it is not." | **None.** Documentation only. |
| `template/engine/release.json` | `"protocol": "build-engine/0.5"` → `"build-engine/0.6"`. | PR #46. **The protocol identifier moved; the version did not.** ADR 0006 forbids the metadata change (`engine/VERSION`, `set-version.sh`, tags, release notes) before the release conditions hold, and `release/set-version.sh` belongs to S8. `engine_version` is still `0.5.0`. | The consequence is recorded rather than hidden: `release/verify.sh --release` is red on `main` between PR #46 and S8. CI runs the default verification, which is green. |
| `template/engine/tools/ctxlink.py` | `safe_path` is reformatted: the control-character test moves onto its own line, and a docstring states the normative rule ("a path is either accepted as written or refused"). | Readability, and the docstring points at `conformance/SCHEME.md`, which is the normative source. | **None — semantically identical to `v0.5.0`.** The same three rejections (empty, absolute, backslash, control character) and the same component check (no empty, `.` or `..` component) are applied, in the same order. |
| `template/engine/tools/test_ctxlink.py` | 21 new lines, **3 new tests**: control characters (including NUL) in a path are refused; legal names that merely look dangerous (`notes/na~me.v1..2.md`, `.hidden.md`, `a+b.md`, `dir with space/é.md`) are accepted; the URL form percent-encodes each segment. | The shipped link minter must agree with the gateway on the exact bytes. These tests pin the rule the docstring states. | **None.** Tests only; they pass in both `VERSION` states. |

### `release/manifest.txt`, `release/forbidden.txt`, `tests/`

**Unchanged** against `v0.5.0`. The allowlist did not move, the forbidden rules did not move, and the
consumer test suite did not move.

### Also changed, outside the plan's `C-DIFF` scope, reviewed anyway

| File | Change | Justification |
|---|---|---|
| `release/verify.sh` | The release gate's protocol checks were made **version-derived** rather than hard-coded to `0.5.0`. | A hard-coded protocol in a fixture silently stops testing anything the moment the version moves. With the version-derived form the self-test passes 94/94 at `VERSION 0.5.0` **and** at `VERSION 0.6.0`; with the old hard-coded form it passes 93/1 at `0.5.0` and 90/4 at `0.6.0`. |
| `release/test-release.sh` | The same, in the self-test's fixtures: `proto_for_version`, `disagreeing_protocol`, `malformed_protocol`, `set_matching_protocol` and the COMPATIBILITY.md row helpers. | The same reason. The self-test now exercises the *matching* protocol, a *disagreeing* one (two minors away, so it can coincide with neither) and a *malformed* one, at whatever version the tree carries. |

**One file was added by this stage:** `tests/test_release_isolation.py`, the isolation proof the S1 exit
gate asks for (§5 below). It is a new test, not a change to an existing one, and it ships nothing —
`tests/` is not on the allowlist. With it, the plan's `C-DIFF` scope holds **5 changed files and nothing
removed**.

## 3. The gate

`release/rollout-gate.sh S1` — the same runner, the same fail-closed rules. The standing checks of the
plan's §4 that this stage's exit gate names, with the inspected output:

| Check | Command | Exit | The inspected output |
|---|---|---|---|
| `C-BASE` | `python3 -m unittest discover -s template/engine/tools` | 0 | `OK` |
| `C-BASE` | `release/test-release.sh` | 0 | `94 passed, 0 failed` |
| `C-BASE` | `tests/test_update.sh` | 0 | `150 passed, 0 failed` + `22 passed, 0 failed` |
| `C-CONF` | `python3 conformance/harness/run.py all --reference` | 0 | `94 passed, 0 failed` |
| `C-CONF` | `python3 -m unittest discover -s conformance -p 'test_*.py'` | 0 | `OK` |
| `C-READ` | `npm test`, `npm run ops:check`, `npm run check:bundle` in `gateway/read/production`; `npm run check:staging:read` in `gateway/write` | 0 | `# fail 0`; `wrangler.toml matches ops/environments.json`; `the Worker builds for every environment`; `the read staging environment is separate from production` |
| `C-WRITE` | `npm run typecheck`, `npm test`, `npm run check:contract`, `npm run check:staging` in `gateway/write` | 0 | no diagnostics; `# fail 0`; `the contract documents agree`; `the write staging environment is separate from production` |
| `C-ISO` | `release/package.sh dist` → `release/verify.sh … --test-payload` → the member list | 0 | `packaged 41 files`; `verify: OK (42 files, version 0.5.0, payload tests run)`; no `gateway/`, `conformance/`, `ops/`, `variants/`, `.github/`, no `wrangler.toml` |
| `C-DIFF` | `git diff v0.5.0..HEAD` over the plan's paths | 0 | nothing removed; the four files in §2 |
| `C-SECRETS` | the credential shapes in `release/forbidden.txt` + the `Bearer` literal shape, over the working tree and the diff against `origin/main` | 0 | no hit; 7 deliberate sentinels excluded by a file-scoped rule and listed by the check |
| `C-PROT`, `C-CI` | the plan's §4 repository queries | 0 | pull request required, required check `test`, force-push blocked; 7 check runs on `main`, all `success` |

**No count differs from the plan's baseline.** The plan's counts are 113 / 94 / (150 + 22) / 94 / 14 /
20 / 372, and every one of them is what the run produced.

## 4. The Worker conformance cases

The plan expects 58 cases. **The actual count is 58.**

```
$ python3 gateway/read/production/test/run-conformance.py
[conformance] fixture repository built, pinned commit ef98bc7ffd8963629f50b43206b17f4b9d3e3fac
[conformance] worker is up: {"status":"ok","version":"0.5.0","scheme":"ctxgate-v1", ...}
...
58 passed, 0 failed
[conformance] revoke acknowledged: {"revoked": "10008-S001"}
[conformance] a link for the revoked order returned HTTP 403
[conformance] the admin channel refuses an unauthenticated caller
[conformance] PASSED: the production gateway passes the conformance suite
```

The runner drives the **real Worker** through `wrangler dev --local` against a scratch repository and a
local stand-in for the GitHub contents API, so nothing touches GitHub and no credential is needed. The
58 cases are the behaviour cases B1–B10 plus the policy and operator-channel checks.

## 5. The release isolation test

The exit gate asks for a **test** that proves `gateway/**` and the conformance assets are outside the
artifact. `tests/test_release_isolation.py` is that test. It builds the artifact the way a release
builds it — `release/package.sh`, from the tracked file list and the allowlist, with no other input — and
then asserts three separate things:

1. **The artifact holds exactly the allowlist.** Every member is covered by a path the manifest names,
   and every file the manifest names is a member. The one exception is `engine/RELEASE-MANIFEST`, the
   listing `release/package.sh` generates at build time and `release/verify.sh` documents.
2. **The infrastructure stayed out.** No member is under `gateway/`, `conformance/`, `ops/`, `variants/`
   or `.github/`; no member is `wrangler.toml`, `.dev.vars`, `.wrangler/` or `node_modules/`; and the
   release machinery — including `release/rollout-gate.sh` — is not inside the payload.
3. **No credential is inside.** Every member's bytes are matched against the credential shapes in
   `release/forbidden.txt`, with the same `grep -aE` the verifier uses, so a binary member is matched
   too and a NUL byte cannot hide a token.

The rules are read from `release/manifest.txt` and `release/forbidden.txt` at run time, so the test
cannot drift away from the policy it is testing.

```
$ python3 tests/test_release_isolation.py
test_every_allowed_file_is_in_the_artifact ... ok
test_every_forbidden_path_rule_is_satisfied ... ok
test_every_member_is_covered_by_the_allowlist ... ok
test_no_credential_shape_inside_the_artifact ... ok
test_no_deployment_configuration_in_the_artifact ... ok
test_no_infrastructure_directory_in_the_artifact ... ok
test_the_gate_runner_is_not_shipped ... ok
test_the_release_machinery_is_not_inside_the_artifact ... ok
Ran 8 tests in 3.001s
OK
```

### The test is not decorative

It was checked against three planted regressions, each in a **scratch copy** of the repository
(`git archive` into a temporary directory, its own git history). **No regression touched this working
tree**, and none touched the pushed branch.

| Planted regression | What caught it |
|---|---|
| `gateway/leak.py` added to `template/` and `managed gateway` added to the allowlist | **three** assertions failed: `test_no_infrastructure_directory_in_the_artifact` (`['gateway/leak.py']`), `test_every_forbidden_path_rule_is_satisfied` (`(^|/)gateway(/|$)`) and `test_no_credential_shape_inside_the_artifact` (the rule `class[[:space:]]+Gateway[(:]`) |
| `conformance/signing-vectors.json` added to `template/` and `managed conformance` added to the allowlist | **three** assertions failed: the infrastructure-directory rule, the path rule `(^|/)(conformance\|variants)(/\|$)`, and the content rule `"vectors_version"` |
| a token-shaped string planted inside the payload (`template/engine/leaked-token.py`) | `test_no_credential_shape_inside_the_artifact` failed with the rule `ghp_[A-Za-z0-9]{36}` |

A fourth, unplanned defence showed itself along the way: when the planted manifest edit was left
uncommitted, **`release/package.sh` refused to package a dirty tree** before the test ever ran. The
layers are independent, and each one stops the leak on its own.

## 6. The write gateway's lifecycle, mapped to its tests

Every item of the lifecycle the exit gate names, with the test file that proves it and the test that
carries the proof.

| Lifecycle item | Test file | The test that carries the proof |
|---|---|---|
| Root capability | `gateway/write/tests/unit/auth/root-url.test.ts` | *"a well-formed capability path parses"* — the eight fields are parsed and validated |
| Root capability (the signature over it) | `gateway/write/tests/unit/auth/signature.test.ts` | *"the canonical message is the eight fields, LF separated"*; *"a tampered field never verifies"*; *"the domain separator keeps a read-side signature from verifying here"* |
| Task / work-order binding | `gateway/write/tests/unit/auth/policy-authz.test.ts` | the session-level decision: *"the three closures are three different codes"*; *"a sealed task still answers the index, so the agent can learn why it stopped"* |
| Task / work-order binding (integration) | `gateway/write/tests/integration/adversarial-inputs.test.ts` | *"a task's files are not another task's files, even with the same writer and the same order"* |
| Single writer | `gateway/write/tests/unit/session/writer-claim.test.ts` | *"the first writer takes the lease"*; *"a different writer is refused while the lease is active"*; *"an expired lease may be taken by another writer, so that a crash does not block the task"* |
| Single writer (integration) | `gateway/write/tests/integration/single-writer.test.ts` | *"a second writer for the same task is refused with 409"*; *"a writer conflict does not change the session"* |
| Sequence | `gateway/write/tests/unit/session/sequence.test.ts` | *"a repeated chunk with the same hash is a replay"*; *"a different hash at an old sequence number is a conflict"*; *"the replay window is bounded"*; *"a sequence number that skips one is a gap"* |
| Staging: scaffold | `gateway/write/tests/unit/staging/scaffold.test.ts` | the scaffold operation |
| Staging: append, and the read-back hash | `gateway/write/tests/unit/staging/append.test.ts` | *"a chunk is appended to an empty file"*; *"a hash that does not match the data is refused"*; *"a repeated chunk is a replay and changes nothing"* |
| Staging: delete | `gateway/write/tests/unit/staging/delete.test.ts` | the delete operation |
| Staging: status | `gateway/write/tests/unit/staging/status.test.ts` | the status operation |
| UTF-8 and file-type checks | `gateway/write/tests/unit/policy/type-policy.test.ts` | *"content that is not UTF-8 is refused"*; *"binary content is refused even with an allowed extension"*; *"an extension that is not in the allow-list is refused"* |
| UTF-8 decoding | `gateway/write/tests/unit/util/encodings.test.ts` | *"text that is not UTF-8 is refused by the text decoder"* |
| Path safety | `gateway/write/tests/unit/policy/path-safety.test.ts` | *"an absolute path is refused"*; *"a control character is refused"*; *"a backslash is refused"* |
| Quota | `gateway/write/tests/unit/policy/quota-accounting.test.ts` | *"the limits are the ones the contract publishes"*; *"content that is lost frees the live bytes and is counted as lost"* |
| Quota (exhaustion) | `gateway/write/tests/integration/quota-exhaustion.test.ts` | the quota is enforced end to end |
| Read-back and integrity | `gateway/write/tests/integration/happy-path.test.ts` | *"a file is scaffolded, written, read back and listed"*; *"the fields a capability binds are the ones the contract says"* |
| Commit idempotency | `gateway/write/tests/unit/commit/commit-idempotency.test.ts` | *"without a key the digest becomes the key, so a plain retry is idempotent"*; *"a different selection gives a different digest"* |
| Commit and delivery | `gateway/write/tests/integration/commit-idempotency.test.ts` | *"a retry with the same key returns the same success, and does not commit twice"*; *"the same key with different content is a conflict, and nothing is committed"* |
| Seal | `gateway/write/tests/unit/seal/seal.test.ts` | *"a seal without a commit is refused"*; *"a seal with a commit freezes the folder and reports what it froze"* |
| Seal, close and revoke | `gateway/write/tests/integration/seal.test.ts` | *"a revoked task refuses every write, with its own code"*; *"a closed work order refuses every write, with its own code"*; *"a sealed task refuses every write, and says that it is sealed"* |
| Close (the tombstone) | `gateway/write/tests/unit/session/tombstones.test.ts` | *"a tombstone drops the content and releases the bytes"*; *"a live file is one that is not tombstoned"* |

### The nonce, stated precisely

The exit gate names **"sequence/nonce"**. The two halves live in different places, and the report says
so rather than pretending the repository covers both:

- **Sequence** is the write gateway's own replay protection, and it is covered:
  `gateway/write/docs/protocol.md` §6.2 defines it as the content sequence number plus the content hash
  plus a bounded replay window of sixteen `(seq, hash)` pairs, and
  `gateway/write/tests/unit/session/sequence.test.ts` proves the replay, the conflict, the gap and the
  bounded window. **The word "nonce" does not occur anywhere under `gateway/write/`** — that is the
  finding, not an omission.
- **Nonce** belongs to **`ctxop-v1`**, which is Gateway A's mechanism, and Gateway A lives in
  `inscope-labs/operator-console` at commit `992defff591d39539bcc8b4ca3cbc14eb9bab783`
  (`docs/capability-format.md`, `gateway/src/durable-objects/nonce-store.ts` — *"Capability nonce store —
  replay protection"* — and `gateway/tests/unit/capability/nonce.test.ts`). That repository is
  **read-only for this stage**: its files are cited by path and commit, and **no test in it was
  executed**. This report therefore claims nothing about the console's behaviour.

The write gateway's capability is a **bearer credential** — that is GAP R-2, which the operator accepted
for 0.6.0 (ADR 0010), and it is the reason the sequence number and the writer lease matter as much as
they do.

## 7. The exit gate, item by item

| Exit-gate item | Met | Where the evidence is |
|---|---|---|
| `[R]` `C-BASE`, `C-CONF`, `C-READ`, `C-WRITE`, `C-ISO`, `C-DIFF`, `C-SECRETS` all pass, with the output recorded | **yes** | §3 |
| `[R]` the Worker conformance cases run; the plan expects 58 and the report states the actual count | **yes** | §4 — **58 passed, 0 failed** |
| `[R]` the write gateway's lifecycle is covered by tests, each mapped to its test file | **yes** | §6 |
| `[R]` the release isolation test proves `gateway/**` and the conformance assets are outside the artifact | **yes** | §5 |
| the merge order of #7, #8, #11, #13–#16, #22 confirmed from the PR history | **yes** | §1 |
| `git diff v0.5.0` reviewed | **yes** | §2 |

## 8. One file outside the plan's `C-DIFF` scope, changed by this stage

| File | Change | Justification |
|---|---|---|
| `release/rollout-gate.sh` | The verdicts are counted through a file instead of through shell variables, because the C-READ and C-WRITE checks run inside a subshell and a subshell cannot change its parent's variables. The exit codes were proved against a planted failure. | The runner failed **open**: a FAIL in C-READ or C-WRITE would have been printed and then counted as nothing, and the runner would have exited 0. Plan rule 3 requires it to fail closed. The plan's rule 6 requires every stage that touches `release/` to re-run the isolation checks — `C-ISO` runs in this stage's gate, and the gate runner is still absent from the artifact. |

## 9. What was not done

- **Nothing was re-implemented.** No gateway behaviour was changed. This stage re-proves what is
  already merged.
- **Nothing was merged, tagged, published or deployed.** The operator merges.
- **No workflow file was touched.**
- **The shipped payload was not touched** by this stage either: the only file this stage adds is a test
  under `tests/`, which is not on the allowlist and is not shipped.
- **`release/verify.sh --release` is still red on `main`**, for the reason recorded in §2. It was red
  before this stage.
- **No test in `inscope-labs/operator-console` was executed.** Its files are cited by path and commit
  only.
