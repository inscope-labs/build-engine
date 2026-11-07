# Compatibility matrix — build-engine 0.6.0 Standard

**Status:** DRAFT for the operator's review (BE-0). Nothing here is approved until the operator signs the
decisions listed in section 8.

**Baseline:** `main` at `d6b6bda11e16801445432e671920cd61695c39d9` (2026-11-07).
**Authority:** `docs/release/V0.6.0-BUILD-PLAN.md` (BE-0), `docs/decisions/0006` (the 0.6.0 Standard contract),
`docs/decisions/0008` (hosting, hostnames and repositories), `docs/decisions/0009` (repository protection).

This document is the **cross-system** compatibility record for the 0.6.0 release. It is not the
consumer-facing compatibility table: that one is `COMPATIBILITY.md` at the repository root, and it is
shipped inside the release artifact. This one names five components across two repositories, and it is
never shipped.

---

## 1. The one supported combination

0.6.0 ships **one** supported combination. Everything else is listed in section 2 as unsupported, with
the reason.

| Component | Repository | Identity in 0.6.0 | Where the authority lives |
|---|---|---|---|
| **Engine** (the shipped consumer artifact) | `inscope-labs/build-engine` | version `0.6.0`, protocol identifier `build-engine/0.6` | `VERSION`, `template/engine/release.json` → `protocol`, `COMPATIBILITY.md` |
| **Console APK** (the Android app) | `inscope-labs/operator-console` | version name and version code: **operator to supply at release-candidate time** | operator-console's own release plan (OC-8) |
| **Gateway A** (operator gateway) | `inscope-labs/operator-console` → `gateway/` | deployment URL `https://cbridge.qnuralink.workers.dev` (ADR 0008, DX-2) | operator-console `gateway/docs/` |
| **Gateway B** (Class B read gateway) | `inscope-labs/build-engine` → `gateway/read/production/` | deployment URL `https://ctxgate-read.qnuralink.workers.dev` (ADR 0008, DX-2) | `conformance/SCHEME.md` (`ctxgate-v1`) |
| **Gateway C** (Class B write gateway) | `inscope-labs/build-engine` → `gateway/write/` | deployment URL `https://ctxgate-write.qnuralink.workers.dev` (ADR 0008, DX-2) | `gateway/write/docs/protocol.md` (`ctxwrite-v1`) |

**The protocol identifier of the release is `build-engine/0.6`** (ADR 0006, decision 3). The rule the
identifier follows is in `COMPATIBILITY.md`: `build-engine/<major.minor>` must equal the release's
major.minor, and `release/verify.sh --release` fails the build when it does not. Section 4 inventories every
place that carries the identifier, and records the change that moved it (see section 4.2).

**The operator's release-note claim** (ADR 0006, decision 4) may be published only when *all* of these hold:
operator-console OC-1 to OC-8 pass; build-engine BE-4 to BE-7 pass; staging is deployed and the pilot has
run against deployed Workers; A03 Core device acceptance passes; production deployment has happened and
been verified. **As of this document, none of them is recorded as met.** Until then no release note, README
or metadata may make the claim.

---

## 2. Unsupported combinations

| Combination | Classification | Reason |
|---|---|---|
| 0.5.0 engine + 0.6.0 gateways | **Unsupported** | The engine's shipped metadata declares `build-engine/0.5` and its consumer tooling implements the 0.5 contract. The 0.6.0 gateways speak `ctxop-v1` / `ctxwrite-v1` and are reached through the operator console's link lifecycle, which the 0.5.0 engine does not implement. Class B features are therefore unavailable on this combination. |
| 0.6.0 engine + 0.5.0 console APK | **Unsupported** | The 0.6.0 engine's `cbridge` and plan tooling are unchanged in contract from 0.5.0, but the APK and the engine are released as one set. A 0.6.0 engine with a 0.5.0 console has no gateway-A counterpart, because Gateway A ships with the console. |
| 0.5.0 engine + 0.5.0 console APK | **Supported** — the published 0.5.0 Basic release | `v0.5.0` is published and immutable (release assets are not reissued). This row records what exists today; it is not a 0.6.0 support statement. |
| 0.6.0 engine + any gateway on a non-`qnuralink.workers.dev` host | **Unsupported** | ADR 0008 fixes the hosts, and ADR 0002 makes the host part of the work-order contract. A link minted for one host is not a link for another. |
| Staging gateway + production console | **Unsupported** | The staging and production deployments have disjoint key ids, different Worker names and different destinations by construction (`gateway/read/production/ops/environments.json`, `gateway/write/scripts/check-staging-separation.py`). A production console is refused by a staging gateway at the key-id check. |

**Forward-fix only.** A published release is never edited. Anything that changes shipped content lands in a
later version (`docs/PENDING-REGISTER.md`, rule 5).

---

## 3. The compatibility record the release must ship

The release ships **one** machine-readable compatibility record. It is the artefact that makes the
combination in section 1 checkable rather than asserted: it names each component, each component's own
version and checksum, the commit each gateway was built from, and the evidence that the combination was
tested.

### 3.1 Proposed schema (for the operator's approval — implemented in BE-8)

The schema is proposed here and **not yet implemented**. The validator lands in `release/` in BE-8, together
with the record itself.

Proposed file: `release/compatibility-record.schema.json` (JSON Schema).
Proposed record: `release/compatibility-record.json` (one file per release, committed and archived with the
release evidence).

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://inscope-labs/build-engine/release/compatibility-record.schema.json",
  "title": "build-engine release compatibility record",
  "type": "object",
  "additionalProperties": false,
  "required": ["release", "engine", "console_apk", "gateways", "evidence", "verified_at"],
  "properties": {
    "release": {
      "type": "object",
      "additionalProperties": false,
      "required": ["version", "protocol"],
      "properties": {
        "version":  { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
        "protocol": { "type": "string", "pattern": "^build-engine/[0-9]+\\.[0-9]+$" }
      }
    },
    "engine": {
      "type": "object",
      "additionalProperties": false,
      "required": ["file_name", "version", "sha256"],
      "properties": {
        "file_name": { "type": "string" },
        "version":    { "type": "string" },
        "sha256":     { "type": "string", "pattern": "^[0-9a-f]{64}$" }
      }
    },
    "console_apk": {
      "type": "object",
      "additionalProperties": false,
      "required": ["version_name", "version_code", "sha256", "signing_certificate_fingerprint", "distribution_channels"],
      "properties": {
        "version_name": { "type": "string" },
        "version_code": { "type": "integer" },
        "sha256":       { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "signing_certificate_fingerprint": { "type": "string", "pattern": "^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2})+$" },
        "distribution_channels": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      }
    },
    "gateways": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["role", "name", "version", "deployment_url", "source_commit_sha", "bundle_sha256", "worker_version_id", "environment"],
        "properties": {
          "role":              { "enum": ["A", "B", "C"] },
          "name":              { "type": "string" },
          "version":           { "type": "string" },
          "deployment_url":    { "type": "string", "format": "uri" },
          "source_commit_sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
          "bundle_sha256":     { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "worker_version_id": { "type": "string" },
          "environment":       { "enum": ["test", "staging", "production"] }
        }
      }
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": ["conformance", "pilot"],
      "properties": {
        "conformance": { "type": "array", "items": { "type": "string" } },
        "pilot":       { "type": "array", "items": { "type": "string" } }
      }
    },
    "verified_at": { "type": "string", "format": "date-time" }
  }
}
```

Rules the validator enforces (BE-8):

1. `release.protocol` equals `build-engine/<major.minor of release.version>` — the same rule
   `release/verify.sh --release` enforces against `template/engine/release.json`.
2. Every component carries **its own** version and checksum. There is no shared version field.
3. `gateways` holds exactly three entries, one per role, each with its own `worker_version_id` recorded
   **after** the deploy, and its own `source_commit_sha`.
4. `console_apk.distribution_channels` lists every channel the APK is distributed through. The operator
   stated two: Google Play and a GitHub Release asset. **Play holds the signing key for the Play artefact;
   the GitHub Release artefact may be signed with a different key. The record carries the fingerprint of
   each artefact separately and the validator must flag a mismatch between channels.** The agent does not
   assume which key signs which artefact.
5. **No secret and no capability URL appears anywhere in the record.** The validator refuses a record that
   contains a value matching the credential shapes the release tooling already refuses
   (`release/forbidden.txt`), and it refuses a URL whose path matches a capability path shape
   (`/v1/…`, `/w1/…`).
6. `verified_at` is the UTC timestamp of the verification run that produced the record.

### 3.2 Where the record is checked

| Check | Where | When |
|---|---|---|
| The record validates against the schema | `release/` validator (BE-8) | release-candidate time |
| The engine's own protocol matches the record | `release/verify.sh --release` | every release build |
| The gateway commits match the record | BE-8 checklist | release-candidate time |
| The APK fingerprint matches the published artefact | BE-8 checklist | release-candidate time |

---

## 4. The protocol identifier change (`build-engine/0.5` → `build-engine/0.6`)

ADR 0006 decision 3 requires this document to inventory every place that carries `build-engine/0.5`. The
change itself is **not** part of this pull request: it is a separate, independently reviewable pull request,
because it changes shipped content and it must land before the final pilot re-run.

### 4.1 Inventory

| # | Place | Kind | Change? |
|---|---|---|---|
| 1 | `template/engine/release.json` → `"protocol"` | **shipped** (inside the artifact) | **Yes** — becomes `build-engine/0.6` |
| 2 | `release/verify.sh` (two error messages) | tooling, example text | **Yes** — the example must name the current protocol, or the message teaches the wrong value |
| 3 | `release/test-release.sh` (four places) | test fixture | **Yes** — the fixtures must exercise the current protocol; the *history* row in `COMPATIBILITY.md` is not touched |
| 4 | `COMPATIBILITY.md` (row `0.5.0`) | history | **No** — a published version's row is a record of what it shipped |
| 5 | `README.md` (row `0.5.0`) | history | **No** — same |
| 6 | `docs/release/PHASE-1.2-COMPATIBILITY.md`, `docs/release/PHASE-2.1-REPORT.md`, `docs/release/DEFECT-REGISTER.md` | historical evidence | **No** — they describe past decisions |
| 7 | `docs/release/V0.6.0-BUILD-PLAN.md`, `docs/decisions/0006` | the decision itself | **No** — they name the old identifier *because* they describe the change |

**The rule that decides each row:** a row that records what a published version shipped is history and stays;
a row that tells a tool or a reader what the *current* protocol is, changes.

### 4.2 The change, and what it drags with it

`release/set-version.sh X.Y.Z` is the supported way to move the release version and the protocol together;
it keeps `release.json` and the `COMPATIBILITY.md` row in step. The pull request that carries the identifier
change therefore also needs:

- a new row in `COMPATIBILITY.md` for `0.6.0` / `build-engine/0.6` (the file is a table of released
  versions, so the row is added by the release-candidate step, BE-8 — **not** by the identifier change
  itself, because the row asserts a release that has not happened);
- `release/verify.sh --release` passing for the new version, which is the check that proves the identifier
  equals the release's major.minor.

**Not in scope for that pull request:** the version number itself. `VERSION` stays `0.5.0` until BE-8 runs
`release/set-version.sh 0.6.0`, because changing `VERSION` would make the repository describe a release that
does not exist yet. **This is a deliberate two-step, and the intermediate state is expected to fail
`verify.sh --release`** — because `release.json` would say `build-engine/0.6` while `VERSION` says `0.5.0`.
The identifier change must therefore land **immediately before** BE-8's version step, not months before it.

> **Open question for the operator (Q-1).** The identifier change, taken alone, leaves the repository in a
> state where `verify.sh --release` fails: `protocol` is `build-engine/0.6` and the release version is
> `0.5.0`. The alternatives are (a) one pull request that changes the identifier **and** the version to
> `0.6.0` and adds the `COMPATIBILITY.md` row, accepting that the repository then names an unpublished
> release; (b) two pull requests in sequence, identifier then version, with a short window in which the
> release gate is red; (c) one pull request that changes the identifier and the version together, and a
> separate BE-8 pull request that re-dates the changelog and finalises the record. **This document's
> recommendation is (c)**, because (a) makes a release claim that has not been verified and (b) leaves a
> red gate on `main` for as long as the operator takes to merge. The agent has not chosen: the identifier
> change is held until the operator answers.

**Resolution (2026-11-07, PR `feature/be-0-protocol-identifier`).** The operator's stage brief settles the
scope: *"the protocol identifier change to `build-engine/0.6` across code, templates and tests"*, in its own
pull request, with `release/set-version.sh` belonging to **BE-8**. ADR 0006's consequences settle the rest:
*"No metadata change (`engine/VERSION`, `set-version`, tags, release notes) happens before the conditions in
item 4 hold."* Two independent sources agree, so the agent did not choose silently:

- **the identifier changes** — `template/engine/release.json` → `build-engine/0.6`, and the tooling that
  names it;
- **the version does not change** — `VERSION` stays `0.5.0` and `release/set-version.sh` is **not** run.
  BE-8 runs it, and it will set the version, the `COMPATIBILITY.md` row and the changelog heading together.

**The consequence, stated plainly: `release/verify.sh --release` is red on `main` between this change and
BE-8's version step.** That is the release gate doing its job — it refuses to describe a release whose
identifier and version disagree — and it is the *only* gate that goes red. CI does not run
`verify.sh --release` (it runs the default verification), so the pull request is green, and the published
0.5.0 asset is untouched.

**What BE-8 must do to close it:** run `release/set-version.sh 0.6.0`, which sets `VERSION`,
`template/engine/VERSION`, `release.json`'s `engine_version` **and** `protocol`, the `COMPATIBILITY.md` row
and the `CHANGELOG.md` heading — and then date the changelog entry at release-candidate time.

**A trap this change exposed, and removed.** The release-gate fixtures in `release/test-release.sh`
hard-coded the version `0.5.0` in eight places. With the identifier moved but the version not, one fixture
failed outright; with the version moved to `0.6.0` (BE-8), four would have failed. The fixtures now derive
the protocol from the repository's `VERSION`, so they test the rule instead of the number. The measurements
are in the agent report for that pull request.

### 4.3 What the identifier does *not* cover

The protocol identifier is **not** the scheme version. `ctxgate-v1`, `ctxwrite-v1` and `ctxop-v1` are
domain separators with their own versioning rules, and none of them changes with the release number:
`ctxgate-v1` and `ctxwrite-v1` are the wire formats of the read and write gateways, and `ctxop-v1` is the
operator capability format. Changing the release identifier must not touch them; a signature produced for
one scheme must never be accepted under another, and that property comes from the domain separator, not
from the release number (`conformance/SCHEME.md` §3.1, `gateway/write/docs/protocol.md` §3.11,
operator-console `docs/capability-format.md` §2).

---

## 5. The contract documents that accompany this matrix

| Document | What it answers | Stage |
|---|---|---|
| `docs/release/CAPABILITY-CONFORMANCE.md` | signing, scope, expiry, revocation and replay for each of the three capability formats; the task-state transition contract (D-4) | BE-0 |
| `docs/release/CBRIDGE-COVERAGE-MATRIX.md` | every `cbridge` command → a native Android feature or a documented alternative | BE-0 |
| `docs/release/DEFECT-REGISTER.md` | every finding, with evidence and an owning stage | maintained |
| `docs/release/REQUIREMENT-TRACEABILITY.md` | assessment item → stage | maintained |

---

## 6. Hostnames, repositories and the credential model

Recorded from ADR 0008 and the operator's binding decisions for this stage.

| Item | Value | Source |
|---|---|---|
| Read gateway (production) | `ctxgate-read.qnuralink.workers.dev` | operator decision (DX-2) |
| Write gateway (production) | `ctxgate-write.qnuralink.workers.dev` | operator decision (DX-2) |
| Gateway A (production) | `cbridge.qnuralink.workers.dev` | operator decision (DX-2) |
| Cloudflare plan | **Paid** | operator decision (DX-2) |
| Staging read gateway | `ctxgate-read-staging.qnuralink.workers.dev` | `.github/workflows/staging-pilot.yml` (default input) |
| Staging write gateway | `ctxgate-write-staging.qnuralink.workers.dev` | `.github/workflows/staging-pilot.yml` (default input) |
| Production read repository (`GITHUB_REPO`) | `acme-pilot-dev` (private) | operator decision |
| Disposable pilot repositories | `acme-pilot` (public), `acme-pilot-dev` (private) | operator decision |
| Credential model | the gateway configuration holds an **operator-declared allowlist** of plan repositories; the operator widens the GitHub token's repository selection **by hand** at onboarding. **No GitHub App.** | operator decision (DX-1) |

**Shared-zone mitigations (ADR 0008, item 4) — in force, and not weakened by anything in this matrix:**

1. distinct Worker names per gateway and per environment;
2. distinct signing keys **and** distinct GitHub credentials per environment;
3. no wildcard routes;
4. distinct destinations per environment;
5. links minted per environment host, so a link minted in one environment is not accepted by another;
6. explicit operator approval for every production deploy.

---

## 7. What this document does **not** establish

- It does **not** say that any gateway is deployed. The staging gateways were deployed and exercised
  (2026-11-05, `ops/staging-pilot.py` against the deployed Workers — see the register entry R0-013); the
  production gateways are **not** deployed, and the read gateway's production configuration still carries
  the operator's placeholder repository.
- It does **not** say that the Android console implements the workflows the matrix names. See
  `docs/release/CBRIDGE-COVERAGE-MATRIX.md` for the per-command evidence, which currently marks most rows
  unverified.
- It does **not** claim the 0.6.0 release-note wording. The conditions in ADR 0006 decision 4 are unmet.
- It does **not** close the gaps listed in `docs/release/CAPABILITY-CONFORMANCE.md` §5. The read-link replay
  gap and the write-capability replay gap are open and need the operator's decision.

---

## 8. Decisions this matrix needs from the operator

| # | Question | Why it is open |
|---|---|---|
| Q-1 | The protocol identifier change: identifier alone, or identifier and version together? (section 4.2) | The two steps cannot both be deferred to BE-8 without leaving the release gate red on `main` in between. |
| Q-2 | The console APK's version name and version code for 0.6.0, and the signing certificate fingerprint of each artefact. | operator-console's release is a separate plan (OC-8); the record in section 3.1 needs the values. |
| Q-3 | The `worker_version_id` of each deployed gateway (the Cloudflare version identifier recorded after the deploy). | It does not exist until BE-4/BE-5 deploy, and it cannot be guessed from a commit. |
| Q-4 | Whether the compatibility record is committed to the repository, published as a release asset, or both. | The plan says "one record"; it does not say where it lives. This document's recommendation is **both**: committed under `release/` so it is reviewable, and published as a release asset so a consumer can fetch it without the repository. |
| Q-5 | The gateway hostnames' final form. | ADR 0008 records `qnuralink.workers.dev` as the account zone and says the exact per-Worker hostnames are fixed at first deployment. The values in section 6 are the operator's stated production names (DX-2); the staging names come from the pilot workflow's defaults. They are recorded here as the operator gave them and have not been verified against a live deployment in this stage. |
