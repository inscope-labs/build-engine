# BE-0 work package 2 — the register, STATUS and the four README corrections

- **Stage:** BE-0 (contract reconciliation and decisions) — build-engine 0.6.0 Standard
- **Branch:** `docs/be-0-register-status-readme`
- **Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07), clean checkout
- **Run:** 2026-11-07T09:xxZ
- **Scope:** three documents. No code, no configuration, no shipped content. (`README.md`,
  `docs/STATUS.md` and `docs/release/DEFECT-REGISTER.md` are all outside `template/`, so nothing here
  reaches the release artifact.)

## 1. Intent

Two things the operator's brief asks for, in one small pull request:

1. **Update the register and `docs/STATUS.md`** for ADR 0007 and for the Phase 6 results (R0-013 closed,
   R0-014 accepted).
2. **Correct the four README lines that say 0.5.0 is unreleased**, after verifying each one against the
   current README.

## 2. What changed, file by file

### 2.1 `docs/release/DEFECT-REGISTER.md`

Four entries changed status. **No entry was deleted, reworded to look better, or downgraded in severity.**

| Entry | Before | After | Authority |
|---|---|---|---|
| **R0-005** — GET-based mutation | `DESIGN DECISION` | **ACCEPTED** for staging and production, with the three conditions of ADR 0007 restated as mandatory and tested | `docs/decisions/0007-class-b-residual-risk-acceptance.md` |
| **R0-007** — ephemeral staging and ambiguous commit outcomes | `DESIGN RISK` | **ACCEPTED** for staging and production. The entry also records that the recovery model it asked for **is** implemented and tested, and names the executed evidence | ADR 0007; `gateway/write/docs/protocol.md` §13; the Stage 6.3 pilot (120 checks) and the deployed signed pilot of 2026-11-05 |
| **R0-013** — the deployed pilot leg needs the operator's staging signing keys | `OPEN; operator action` | **CLOSED (2026-11-05)** | The `staging-pilot` workflow, runs `41964198047` and `41964576712` |
| **R0-014** — the failure pilot runs against the local runtime | `OPEN; operator decision` | **ACCEPTED (2026-11-07)**; the deployed gateways do **not** get a fault-injection switch, and the gap is documented rather than closed | The operator's decision of 2026-11-07 |

Also: the header's status line and the addendum list name **Addendum A12**; the stage-ownership index
(section F) has rows for R0-005…R0-007, R0-013 and R0-014; and **Addendum A12** is appended at the end of
the register, stating what changed, what was deliberately *not* changed, and what the addendum does not
establish.

**R0-013's closure evidence, quoted from the run log (2026-11-05, run `41964576712`, `staging-pilot`,
`signed` mode, `main` @ `3028b7d`):** `THE PILOT PASSED (44 checks)`. The 44 checks cover the read leg
(authorised file served; a file outside the allowed prefixes, a forged signature, an expired link, a bad
signature and a link for an unissued order all refused), the write leg (capability minted and bound to the
task and order; the task folder derived from the capability; scaffold, stage and read back byte for byte;
a denied file type, a path outside the task folder and an oversized file refused; **the commit landed and
the retry was a replay and not a second commit**; the task sealed; a write after the seal refused),
revocation (the read gateway revoked the order and the capability stopped working; the write gateway
revoked the task and the capability answered `410 task-revoked`), and audit hygiene (no signing secret, no
operator token, no deliverable content, no provider credential and no signature in the audit records; the
audit channel refuses an unauthenticated caller). The workflow's own final step confirms that no secret
value appears in the published output.

**R0-014's entry now says what the acceptance does *not* cover, in plain words:** the failure scenarios
have never been run against a deployed Worker, so a deployed gateway's behaviour under an interrupted
request, a killed isolate or a provider outage is **not evidenced**, and the acceptance is not a defence if
a production incident is traced to one of those states.

### 2.2 `docs/STATUS.md`

- The title no longer says "Status of build-engine 0.5.0" as if 0.5.0 were the thing being worked on: it
  names the latest published release and the release being prepared.
- A new paragraph records the **staging deployment** (both gateways published, the signed workflow run on
  2026-11-05, 44 checks passed) and states that the **production** deployments are not published.
- A new paragraph states that **the 0.6.0 release claim is not made** and why (ADR 0006 decision 4).
- The "not Basic blockers" line no longer lists R0-005 and R0-007 as open. It is replaced by an
  **accepted residual risks** section (the three acceptances, with the conditions) and a **closed since
  0.5.0** line for R0-013.
- The categorised overview's gateway bullets no longer say "not deployed" without qualification; they say
  what is live (staging) and what is not (production), and the write gateway's entry now carries the
  **372 tests** figure.
- The old "Gaps that currently prevent a Basic release" list is retitled as a record of what stood between
  the repository and `v0.5.0` (all closed), and a **"What stands in the way of 0.6.0 Standard"** list
  replaces it: the production deployments, the cross-system pilot, the transfer path, the protocol
  identifier, the two capability-conformance gaps, and the compatibility record.

### 2.3 `README.md` — the four corrections, and three more

The brief asks for the four lines that say 0.5.0 is unreleased. All four were located and verified against
the current README before editing:

| # | Line | Before | After |
|---|---|---|---|
| 1 | 7 | `Current version: **0.5.0** (unreleased) — …` | `Current version: **0.5.0** (released 2026-10-29) — … The next release is **0.6.0 Standard** (ADR 0006).` |
| 2 | 204 | `| 0.5.0 (unreleased) | build-engine/0.5 | …` | `| 0.5.0 (released 2026-10-29) | build-engine/0.5 | …` |
| 3 | 212 | `Version 0.5.0 is unreleased and nothing has been published. …` | `Version 0.5.0 is published — <…/releases/tag/v0.5.0> — and it is **Basic, Class A-only** … Its "production ready, deployed, and supported" wording is gated on … none of them has passed yet, so this document does not make that claim.` |
| 4 | 216 | `3. \`CHANGELOG.md\` still reads \`0.5.0 - unreleased\`; the dated entry is written at release-candidate time only.` | `3. \`CHANGELOG.md\` records \`0.5.0\` with its dated entry (2026-10-29); the 0.6.0 entry is written at release-candidate time only.` |

`README.md:183` — "replace the unreleased section with a dated entry" — was **not** changed: it is a step of
the *next* release's procedure, not a statement that 0.5.0 is unreleased. `grep -i unreleased README.md`
now returns that one line only.

**Three further corrections in the same list, made because the same evidence falsifies them.** The brief's
scope was the four "unreleased" lines, and these three are **not** "unreleased" claims; leaving them would
have put a false statement next to a corrected one, which is worse than a stale line on its own. They are
called out here so that the operator can see exactly what was touched and why:

| # | Line | Before | After | Why |
|---|---|---|---|---|
| 5 | 213 | "The production read gateway … **it has not been deployed**: no environment has been published. … The write gateway … is likewise **not deployed**." | The staging deployment is live and was exercised on 2026-11-05 (44 checks); the **production** deployments are not published. | The Phase 6 results this pull request records falsify "no environment has been published". |
| 6 | 214 | "No end-to-end pilot has run (Phase 6)." | The Class B workflow has run against the **deployed staging** gateways; the **cross-system** pilot with the Android console has not (BE-7, OC-8); the transfer path is not built (BE-6). | Same. |
| 7 | 217 | "GitHub branch protection on `main` and tag protection for `v*` are not configured; they are needed before any tag (Stage 3.3.7)." | `main` **is** protected — a pull request and the `test` check are required and force-push is blocked; no required reviews, administrators not enforced, no `v*` tag restriction; the residual exposure is accepted by ADR 0009. | Verified live through the GitHub API on 2026-11-07 (see §3), and it is ADR 0009's subject. |

**Verification of the branch-protection claim** — `GET /repos/inscope-labs/build-engine/branches/main/protection`
on 2026-11-07 returned: `required_pull_request_reviews` present with
`required_approving_review_count: 0`; `required_status_checks.contexts: ["test"]`;
`enforce_admins.enabled: false`; `allow_force_pushes.enabled: false`; `allow_deletions.enabled: true`;
`required_linear_history: false`; `lock_branch: false`. `GET /repos/…/rulesets` returned an empty list, so
there is no tag rule. This matches ADR 0009 exactly.

## 3. Checks run in this session

| Check | Command | Result |
|---|---|---|
| Branch protection (evidence for README item 7) | `GET /repos/inscope-labs/build-engine/branches/main/protection` | 200 — the values in §2.3 |
| Tag rules | `GET /repos/inscope-labs/build-engine/rulesets` | `[]` — no tag rule |
| The release exists and is dated | `GET /repos/inscope-labs/build-engine/releases` | `v0.5.0`, published `2026-10-29T13:15:15Z`, assets `build-engine-v0.5.0.tar.gz` and its `.sha256` |
| The changelog is dated | `head -3 CHANGELOG.md` | `## 0.5.0 - 2026-10-29` |
| The README no longer says 0.5.0 is unreleased | `grep -n -i "unreleased" README.md` | one line — the *procedure* step at line 183 |
| Shipped engine tests | `python3 -m unittest discover -s template/engine/tools` | `Ran 113 tests` — **OK** |
| Gateway read reference tests | `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'` | `Ran 15 tests` — **OK** |
| Conformance suite | `python3 -m unittest discover -s conformance -p 'test_*.py'` | `Ran 14 tests` — **OK** |
| Conformance harness | `python3 conformance/harness/run.py all --reference` | `94 passed, 0 failed` |
| Release machinery self-test | `release/test-release.sh` | `94 passed, 0 failed` |
| Consumer install and update flow | `tests/test_update.sh` | `150 passed, 0 failed` and `22 passed, 0 failed` |
| Package and verify (dry run) | `release/package.sh dist` + `release/verify.sh "dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz" --test-payload` | `packaged 41 files, 0.5.0`; `verify: OK (build-engine-v0.5.0.tar.gz: 42 files, version 0.5.0, payload tests run)` |

**No gateway suite was re-run for this pull request.** None of the three files it touches is read by a
gateway test, and the gateway suites were run in full for work package 1 on the same baseline; the CI run on
this pull request covers them.

## 4. Deviations, and what was deliberately not done

- **The three extra README corrections (items 5–7)** are beyond the brief's literal four. They are listed
  explicitly in §2.3 so the operator can see them and revert them if they disagree. They are corrections of
  statements falsified by the same evidence this pull request records.
- **Nothing was closed that the operator did not close.** R0-005, R0-007 and R0-014 are recorded as
  *accepted*, which is a different word from *closed*, and the register says so.
- **No severity was changed**, and no entry's evidence was reworded.

## 5. Risks and unresolved questions

**Risks.**

- The register is the document a reviewer trusts to be a record. Three of its entries now carry an
  operator's acceptance, and an acceptance is a weaker statement than a fix. That is the operator's
  decision, and the entry text says what the acceptance does and does not cover.
- `docs/STATUS.md` is now longer and names two releases. The structure (the scope-classification table, the
  categorised overview) is unchanged, so a reader who knows the old shape still finds everything.

**Unresolved questions:** none specific to this pull request. The open decisions are collected in
`docs/release/COMPATIBILITY-MATRIX.md` §8 and `docs/release/CAPABILITY-CONFORMANCE.md` §8 and are
restated in the stage closeout.

## 6. What the agent needs before the next stage

- **Nothing.** The operator merges; the agent does not merge, tag or release.
