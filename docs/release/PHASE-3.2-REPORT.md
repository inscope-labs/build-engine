# Phase 3, Stage 3.2: harden independent verification

- Branch: `phase-3/3.2-harden-verification`, stacked on `phase-3/3.1-allowlist-packaging` @ `da974fd`
- Date: 2026-10-27
- Closes: register F0-010 (the verifier executes the artifact it verifies), F0-016 (the `..` substring rule),
  F0-013's verification half
- Raises and closes: F0-040 to F0-044 (found while hardening the verifier; see the register, addendum A4)
- Scope note: this stage changes `release/verify.sh`, the policy files it reads, the path check in the packer and in
  the shipped updater, and the two workflows that call the verifier. It does not change the artifact's contents.

## Tasks

| Task | Result |
|---|---|
| 3.2.1 Test malicious archive names, absolute paths, traversal components, duplicate entries, symlink/hardlink/device entries, truncated archives, checksum mismatch, and missing sidecar checksum | Done. 16 new checks in the self-test, each on a purpose-built hostile artifact (`release/test-fixtures.py` crafts the archive and refreshes the sidecar, so every test fails for the reason it is about). Two real holes were found and closed: the sidecar did not have to describe the artifact it accompanied (F0-040) and a member listed twice with identical content was not detected (F0-041). |
| 3.2.2 Validate archive member names as path components, not substring matches | Done in all three scripts that check a path - `release/package.sh`, `release/verify.sh` and the shipped `engine/bin/update.sh`. A name that merely contains two dots is accepted by all three; a `..` component is refused by all three (F0-016). |
| 3.2.3 Validate the release manifest for duplicate entries, missing entries, unlisted files, malformed hashes, bad modes, and unexpected metadata | Done. The manifest's header, field count, hash format, mode, path shape and uniqueness (exactly and under case folding) are all checked, and the file set is compared with the artifact's file set (F0-043). The allowlist - the verifier's own policy input - is validated too: it may not declare a path twice or two paths equal under case folding (F0-044). |
| 3.2.4 Review forbidden.txt patterns for bypasses and false positives; add tests for both | Done. Two bypasses were found and closed (F0-042): the gateway patterns were anchored to the start of a line, so an indented copy of the gateway code matched nothing; and the content rules were matched with `grep -rI`, which skips any file containing a NUL byte, so a credential in such a file was invisible. The rules are no longer anchored, and the content rules are matched against binary files as well. Two categories were missing and were added: the conformance vectors (by content) and local state (`.build-engine.lock`, `.DS_Store`, editor backups). The false-positive direction is covered: the shipped payload passes every rule, and a file whose name contains two dots is not rejected. |
| 3.2.5 Confirm gateway, conformance, variants, test code, secrets, `.env`, Worker configs, node_modules, local state, and unapproved files are excluded and that renamed gateway-like code is detected | Done, and written down as a table below. The shipped engine's own test files (`engine/tools/test_*.py`) are deliberately shipped - the installed engine runs its own tests - so the rule is about the *gateway's* test code, which is excluded. |
| 3.2.6 Confirm artifact version, VERSION, ENGINE.json, release manifest header, tag, changelog heading, and release notes all agree | Done. The artifact is checked against itself (the file name, `engine/VERSION`, `engine/release.json`, the release manifest header). With `--release` the repository's own `VERSION`, `template/engine/VERSION` and `template/engine/release.json` must agree with the artifact, and the changelog heading must be dated and carry the same version. The tag is checked by the release workflow (`release.yml`), not by the verifier, and the release notes are the changelog entry - both are recorded in the table below. |
| 3.2.7 Verify the unpacked payload independently, without relying on repository-only files other than the verifier's explicit policy inputs | Done. The verifier's only inputs beyond the artifact are its two policy files (`release/manifest.txt` and `release/forbidden.txt`); the repository's own files are read only under `--release`, and only to check the repository against the artifact. The payload is not executed: the payload's test suite is an explicit, separate step (`--test-payload`) that the build side opts into and a consumer never does (F0-010). |

## What the verifier checks now, and what it does not

The default invocation is `release/verify.sh ARTIFACT.tar.gz`. It reads the artifact and its two policy files, and it
does not execute anything the artifact contains.

| Check | What it refuses |
|-------|----------------|
| Checksum | a missing sidecar, a sidecar that describes another file, a sidecar with more than one line, a checksum that does not match |
| Archive | an archive that is not a readable gzip tar (a truncated one), an entry that is not a regular file (a directory, symlink, hardlink, device, socket or fifo), a file mode other than 0644 or 0755 |
| Member names | an absolute path, a `..` or `.` component, an empty component, a backslash (the escaping ambiguity), the same name twice, two names equal under case folding, a name that disagrees with the extracted tree |
| Allowlist | a file that `release/manifest.txt` does not cover, an allowlist that declares a path twice, an allowlist with two paths equal under case folding, an allowlist with an unsafe path |
| Forbidden | the gateway by location, by name and by code (also indented, also renamed), the conformance vectors by content, the write gateway's config and code, `node_modules`, `.git`, `.env`, key material, local state, and credential shapes in text *and* in binary files |
| Release manifest | a missing header, an unexpected field, a malformed hash, a bad mode, an unsafe path, a listed file that is not in the artifact, a path listed twice, two paths equal under case folding, and any disagreement between the manifest and the artifact's file set |
| Versions | the artifact's own version sources disagreeing with each other or with the file name; under `--release`, the repository's `VERSION`, `template/engine/VERSION` and `template/engine/release.json` disagreeing with the artifact, a missing or `UNSET` protocol, and a changelog entry that is not dated for that version |
| Payload | a shipped shell script that does not parse, and python that does not compile. **The payload's own tests run only with `--test-payload`.** |

## The exclusion inventory (3.2.5)

| Category | Refused by | Checked by |
|----------|------------|------------|
| The read gateway | `forbidden.txt` path and code rules | "gateway copied into an allowlisted directory is caught", "an indented copy of the gateway code is caught", "a copy of the gateway entry point is caught" |
| The write gateway | `forbidden.txt` path and code rules | "Worker config copied into the payload is caught", "Worker code under another name is caught by its content", "a Worker secrets file is caught" |
| The conformance tree and vectors | `forbidden.txt` path rule and content rule | "a conformance tree is caught", "a renamed copy of the conformance vectors is caught" |
| `variants/` | `forbidden.txt` path rule | "a variants/ tree in the payload is caught" |
| The gateway's test code | `forbidden.txt` path and code rules | same checks as the gateway itself; a renamed copy is caught by the code rules |
| Secrets | `forbidden.txt` content rules | "a credential-shaped string is caught", "a credential in a binary file is caught" |
| `.env`, key material | `forbidden.txt` path rules | "an .env file is caught", "a key file is caught" |
| `node_modules` | `forbidden.txt` path rule, and the packer refuses it too | "node_modules in a tampered artifact is caught" |
| Local state | `forbidden.txt` path rules, and the packer refuses it too | "a local state file is caught" |
| Unapproved files | the allowlist | "a file outside the allowlist is caught" |
| The shipped engine's own tests | *not* excluded - they are part of the payload and the installed engine runs them | "the installed engine passes its own tests" (in `tests/test_update.sh`) |

The forbidden rules are a second, independent layer: "a variants tree is caught even when the allowlist allows it"
widens the allowlist and shows the rule still refuses.

## Evidence

Baseline: `3149df0` (Stage 3.1). Every baseline claim is an executed command.

| # | Baseline behaviour (executed against `3149df0`) | After Stage 3.2 |
|---|-------------------------------|------------------|
| F0-010 | A planted `engine/tools/test_*.py` wrote a marker file outside the extraction directory during `verify.sh` | The marker does not appear: `the marker is absent: verification did not execute the payload`. With `--test-payload` it does: `the payload tests are run when they are asked for` |
| F0-016 | `docs/notes..v2.md` was packaged successfully and then rejected: `verify: FAIL: unsafe path in tar: docs/notes..v2.md` | `verify: OK`; the packer, the verifier and the shipped updater all accept the name, and all three refuse a `..` component |
| F0-040 | A sidecar naming another file that existed and matched left the artifact unverified: `verify: OK (41 files, version 0.5.0)` | `verify: FAIL: the checksum sidecar describes 'some-other-file.tar.gz', not build-engine-v0.5.0.tar.gz` |
| F0-041 | A duplicated member was caught only as a side effect, with the wrong message ("artifact files and release manifest disagree"), and a duplicated `engine/RELEASE-MANIFEST` passed: `verify: OK (42 files, version 0.5.0)` for a 41-file artifact | `duplicate archive member: engine/VERSION`, and `duplicate archive member: engine/RELEASE-MANIFEST` |
| F0-042 | An indented `class Gateway:` matched no rule (`verify: OK`), and a file with a NUL byte holding a `ghp_` token was not detected (`verify: OK`) | `forbidden content rule hit: class[[:space:]]+Gateway[(:]` and `forbidden content rule hit: ghp_[A-Za-z0-9]{36}` |
| F0-043 | A duplicated manifest entry was caught only as a set mismatch ("artifact files and release manifest disagree"), a malformed hash as "hash mismatch", an extra field as "manifest lists a file that is not in the artifact: ... surprise" - and a manifest with **no header at all** passed: `verify: OK` | Each is refused with its own message, e.g. `the release manifest lists plans/README.md twice`, `the release manifest has a malformed hash for ...`, `the release manifest has an unexpected field for ...`, `the release manifest has no header` |
| F0-044 | An allowlist declaring a path twice was used as a policy without complaint: `verify: OK` | `the allowlist declares engine/VERSION twice` |

Test suites, all run and inspected:

- `release/test-release.sh`: **85 passed, 0 failed** (was 42). 43 new checks: 16 on hostile archives, 7 on the
  release manifest, 3 on the allowlist, 2 on the payload execution, 1 positive path case, 14 on what the forbidden
  rules must catch.
- `tests/test_update.sh`: **26 passed, 0 failed** (was 22): the consumer installs a release whose file name contains
  two dots, and refuses an artifact with a traversal member without writing anything outside the repository.
- `python3 -m unittest discover -s template/engine/tools`: 79 tests, OK.
- `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'`: 15 tests, OK.
- `release/package.sh dist` then `release/verify.sh dist/build-engine-v0.5.0.tar.gz`: `verify: OK (41 files, version
  0.5.0)`; with `--test-payload`: `verify: OK (41 files, version 0.5.0, payload tests run)`.

## Decisions the operator should confirm

- **The build side opts into the payload tests explicitly.** `ci.yml` and `release.yml` now pass `--test-payload`,
  because they build the artifact in the same job and therefore trust it. A consumer who downloads an artifact gets
  the default verification, which never executes the artifact's code. If you would rather the release gate never
  executed the payload at all, the two workflow lines are the only place to change - the release would then be
  published on the strength of the static checks and of the tests the repository itself runs.
- **`update.sh` was changed**, although it is the shipped consumer tool. It is one of the three scripts the F0-016
  finding names, and the three have to agree or the pipeline produces artifacts its own tools refuse. The change is
  the path check only; no behaviour of the updater changes otherwise.

## Not done here, and why

- **F0-017 (the checksum proves integrity, not authenticity) is untouched.** The sidecar is bound to the artifact now,
  but nothing signs it. The provenance record is Stage 3.3.8.
- **F0-023 (the release workflow does not enforce all the gates it relies on) is untouched.** Stage 3.3.
- **The release notes and the tag are not checked by the verifier.** `release.yml` checks that the tag matches
  `VERSION` and points at a commit on `main`, and builds the release notes from the changelog entry; the verifier
  checks that the changelog entry exists and is dated for the artifact's version. Provenance (which commit, which
  workflow run) is Stage 3.3.8.
- **Stage 3.4.1 is not complete.** This stage added the negative tests for the checks it changed; the release
  workflow's own gates still have the coverage they had.
- **R0-002's remaining case** - the archive and manifest adversarial cases - is now covered by the 3.2.1 and 3.2.3
  tests above, except the ones that need a real device node, which the test suite cannot create without privileges
  and which the verifier refuses by entry type anyway.
