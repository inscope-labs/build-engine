# BE-0 work package 3 — the protocol identifier moves to `build-engine/0.6`

- **Stage:** BE-0 (contract reconciliation and decisions) — build-engine 0.6.0 Standard
- **Branch:** `feature/be-0-protocol-identifier`
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07), clean checkout
- **Run:** 2026-11-07T09:2xZ
- **Scope:** the protocol identifier, the tooling that names it, the tests that assert it, and the
  compatibility matrix's record of the change. **The release version does not change.**

## 1. Intent

ADR 0006 decision 3 fixes the protocol identifier of the 0.6.0 release as `build-engine/0.6`, and says the
identifier change happens in code, templates and tests — not in the decision record. The operator's stage
brief requires it as a **separate, independently reviewable pull request** that lands before the final pilot
re-run.

## 2. The decision this pull request had to make, and how it was made

The identifier change and the version change are separable, and separating them has a consequence: the
release gate (`release/verify.sh --release`) compares the identifier against the release version, so with
`protocol: build-engine/0.6` and `VERSION: 0.5.0` that gate is **red** until the version moves.

The agent did not choose silently. Two independent sources settle the scope:

| Source | What it says |
|---|---|
| The operator's stage brief | *"the protocol identifier change to `build-engine/0.6` across code, templates and tests"*, in its own pull request; and `release/set-version.sh` is listed under **BE-8** |
| ADR 0006, consequences | *"No metadata change (`engine/VERSION`, `set-version`, tags, release notes) happens before the conditions in item 4 hold."* |

So: **the identifier changes, the version does not.** `VERSION` stays `0.5.0`, `release/set-version.sh` is
not run, no tag is created, no release note is written. `docs/release/COMPATIBILITY-MATRIX.md` §4.2 now
records this resolution next to the question it answers (Q-1).

**The consequence, stated plainly for the reviewer:** `release/verify.sh --release` is red on `main` from
this merge until BE-8 runs `release/set-version.sh 0.6.0`. Nothing else goes red — CI runs the *default*
verification, which does not compare the identifier with the version, and the published 0.5.0 asset is not
touched. The gate refusing to describe a release whose identifier and version disagree is the gate working.

## 3. What changed, file by file

### 3.1 `template/engine/release.json` (shipped)

```json
{
  "engine_version": "0.5.0",
  "protocol": "build-engine/0.6"
}
```

This is the only shipped file that changes. It is the file `COMPATIBILITY.md` describes as the record of
"the protocol version this release implements", and the file `release/verify.sh --release` reads to check
that the identifier equals the release's major.minor.

**`engine_version` is untouched**, because the version moves at BE-8. The transient state — a `0.5.0`
engine carrying the `0.6` identifier — is the state ADR 0006 and the brief produce together, and it is
resolved by one command at release-candidate time.

### 3.2 `release/verify.sh` — the two example messages

Both messages tell an operator what to put in `protocol` when something is wrong. They named
`build-engine/0.5`, which is now the wrong example. Both now name `build-engine/0.6`.

- line 160: `"engine/release.json still carries the retired key implements_abstract: use protocol (e.g. build-engine/0.6)"`
- line 184: `"engine/release.json protocol is missing or UNSET: record the compatibility protocol version this release implements (e.g. build-engine/0.6)"`

### 3.3 `release/test-release.sh` — the release-gate fixtures

**This is the part that was not obvious, and it is the reason the change is reviewable on its own.**

The release gate checks, in this order: the protocol is present → the protocol has the right shape → **the
protocol matches the repository's `VERSION`** → `COMPATIBILITY.md` has a row for that version and that
protocol → `CHANGELOG.md` has a dated entry for it.

Eight fixtures drove that gate, and every one of them hard-coded the version `0.5.0` (as
`build-engine/0.5`, as `| 0.5.0 |`, as `## 0.5.0 - `). That is a fixture that tests a **number** where it
should test a **rule**, and it breaks the moment the version moves.

**The change:** six small helpers were added, and every fixture now derives what it needs from the
repository's `VERSION`:

| Helper | What it does |
|---|---|
| `proto_for_version` | the protocol that matches the repository's current `VERSION` |
| `disagreeing_protocol` | a protocol that disagrees with `VERSION` **and** is never the value the tree holds (two minors away, so it cannot coincide with either) |
| `malformed_protocol` | the right identifier with the separator missing — the wrong *shape* |
| `set_protocol` / `set_matching_protocol` | set the shipped protocol to a given value, or to the matching one |
| `drop_compat_row` | remove the `COMPATIBILITY.md` row for the current `VERSION` |
| `set_compat_row_protocol` | rewrite the protocol cell of that row |

The eight fixtures were rewritten to use them. The two `implements_abstract` fixtures now carry the
derived protocol too, so no version number is left behind in the file.

**The measurements, run on scratch copies of the tree (never in the working repository):**

| Tree | Fixtures | Result |
|---|---|---|
| `VERSION 0.5.0`, `protocol build-engine/0.6` | **old** (hard-coded) | `93 passed, 1 failed` — *"release gate refuses an undated changelog entry"* fails, because the protocol check fires before the changelog check |
| `VERSION 0.5.0`, `protocol build-engine/0.6` | **new** (derived) | **`94 passed, 0 failed`** |
| `VERSION 0.6.0` (after `set-version.sh 0.6.0`), `protocol build-engine/0.6` | **old** (hard-coded) | `90 passed, 4 failed` — the "release gate passes" fixture, the "protocol that disagrees" fixture, and both `COMPATIBILITY.md` fixtures all break |
| `VERSION 0.6.0` (after `set-version.sh 0.6.0`), `protocol build-engine/0.6` | **new** (derived) | **`94 passed, 0 failed`** |

So the derivation is not cosmetic: it fixes one test that breaks today, and it removes four that would
break at BE-8, which is the moment the operator's release-candidate step runs `set-version.sh`.

### 3.4 `docs/release/COMPATIBILITY-MATRIX.md` — the record

§4.2 gains the resolution of Q-1 and states what BE-8 must do to close the gate. §1 no longer says the tree
still carries `build-engine/0.5`.

### 3.5 What was deliberately **not** changed

| Place | Why not |
|---|---|
| `COMPATIBILITY.md`'s `0.5.0` row | A published version's row is a record of what it shipped. It is history. A `0.6.0` row asserts a release that has not happened; `release/set-version.sh` adds it at BE-8. |
| `README.md`'s `0.5.0` row | The same. |
| `docs/release/PHASE-1.2-COMPATIBILITY.md`, `PHASE-2.1-REPORT.md`, `DEFECT-REGISTER.md` | Historical evidence of past decisions. Rewriting a record of what was decided then is how a register stops being evidence. |
| `docs/decisions/0006`, `V0.6.0-BUILD-PLAN.md` | They name `build-engine/0.5` **because** they describe the change. |
| `VERSION`, `template/engine/VERSION`, `release.json`'s `engine_version` | ADR 0006 forbids the metadata change before the conditions hold; the brief puts `set-version.sh` in BE-8. |
| The gateways' own `VERSION` constants (`gateway/read/production/src/index.ts`, `gateway/write/src/router.ts`) and their `package.json` versions | These are **component** versions, not the protocol identifier. The compatibility record carries each component's own version separately (`COMPATIBILITY-MATRIX.md` §3.1). **They must be bumped to the release version at BE-8, and this is recorded as a BE-8 item** — otherwise a deployed gateway reports `0.5.0` inside a 0.6.0 release. |
| `ctxgate-v1`, `ctxwrite-v1`, `ctxop-v1` | Domain separators, not release identifiers. §4.3 of the matrix says why they must not move. |

## 4. Checks run in this session

| Command | Result |
|---|---|
| `release/test-release.sh` | `94 passed, 0 failed` |
| `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |
| `python3 conformance/harness/run.py all --reference` | `94 passed, 0 failed` |
| `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| `release/package.sh dist` | `packaged 41 files, 0.5.0` (after the commit; the first attempt **refused to package a dirty tree**, which is the F0-011 gate working) |
| `release/verify.sh "dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz" --test-payload` | `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0, payload tests run)` |
| `bash -n release/test-release.sh` | no output, exit 0 |

**Not re-run for this pull request:** the two gateways' suites. None of the four files it touches is read by
a gateway test. They were run in full for work package 1 on the same baseline (`372` write-gateway tests,
`20` read-gateway tests), and the CI run on this pull request covers them.

## 5. Risks and unresolved questions

**Risks.**

- **The release gate is red on `main` until BE-8.** This is deliberate and is the gate working, but it is a
  state an operator has to know about, and it is why this pull request should be merged close to BE-8 rather
  than left for months.
- **The shipped artifact is transiently inconsistent**: `engine_version 0.5.0` with `protocol
  build-engine/0.6`. It is not published, and `set-version.sh 0.6.0` resolves it. If a 0.5.0 artifact were
  ever rebuilt and published from this tree, it would carry the 0.6 identifier — which is why the release
  gate refuses it.

**Unresolved questions:** none new. Q-1 in `COMPATIBILITY-MATRIX.md` §8 is answered by this pull request's
resolution note.

**BE-8 items this pull request creates:**

1. Run `release/set-version.sh 0.6.0`, then date the changelog entry at release-candidate time.
2. Bump the **components' own** versions — the read gateway's `VERSION` constant, the write gateway's
   `version` field, and both gateways' `package.json` versions — and record them, with their checksums, in
   the compatibility record.
3. Verify that `release/verify.sh --release` passes for 0.6.0 before the tag.

## 6. What the agent needs before the next stage

- **Nothing.** The operator merges; the agent does not merge, tag or release.
