# Build Engine — Phase 0 Requirement-to-Test Traceability

- Repository: `https://github.com/inscope-labs/build-engine`
- Baseline commit inspected: `b45e8008adcaa179165abf24880e8eda0eb7c515`
- Version: `0.5.0`
- Status: **Submitted for operator review via PR; not yet approved**
- Local baseline run at `ee654cd` (adds only `RELEASE-PLAN.md` over the inspected commit): see `PHASE-0-BASELINE.md`.

This is a baseline traceability map, not a declaration that all tests passed. A test is marked “CI pass” only where the inspected GitHub Actions run included a corresponding step and that step passed. Local commands not run in this session remain unverified.

| Capability / requirement | Evidence path(s) | Existing test or evidence | Baseline result | Classification / follow-up |
|---|---|---|---|---|
| Plan tooling and state/schema operations | `template/engine/tools/`, `template/engine/schemas/` | CI shipped-engine tests | CI pass for configured tests; full local baseline command not run | Candidate first-release requirement; confirm coverage against documented promises |
| Signed context-link generation | `template/engine/tools/ctxlink.py`, `template/engine/tools/test_ctxlink.py` | CI shipped-engine tests; conformance vectors | CI tests passed; shared cross-implementation vectors/harness incomplete | First-release claim limited to shipped signer; cross-implementation conformance remains future gate |
| Operator bridge workflow | `template/operator/`, `template/docs/` | Consumer install/update flow and shipped-engine tests in CI | Configured CI steps passed; complete real-task pilot absent | Candidate first-release requirement; end-to-end claims must be qualified until pilot |
| Consumer install/update and preservation of seed/local files | `template/engine/bin/update.sh`, `tests/test_update.sh` | CI consumer install/update flow | CI pass | First-release requirement; local rerun not performed |
| Release manifest and artifact isolation | `release/manifest.txt`, `release/forbidden.txt`, `release/package.sh`, `release/verify.sh` | Manifest path comparison; package/verify dry run; release self-test | CI dry-run/self-test passed; all 12 manifest paths exist remotely; adversarial edge cases not independently run | First-release requirement; retain R0-001/R0-002 until adequate negative-test evidence |
| Release metadata/version agreement | `VERSION`, `template/engine/VERSION`, `template/engine/release.json` (was `ENGINE.json`), `COMPATIBILITY.md` | `release/verify.sh --release` contract | `implements_abstract` is `UNSET`; release gate is blocked | Release blocker F0-001; resolve compatibility decision in Phase 1, then update/test in later release phases |
| Dated release notes | `CHANGELOG.md` | Release workflow expects approved release state | `0.5.0 - unreleased` remains | F0-002; do not mark released before approved release contents/date and gates |
| Reference read gateway | `gateway/read/reference/` | Reference gateway tests | CI configured test job passed | Proof of concept only; not equivalent to production deployment |
| Production Class B read gateway | `gateway/read/production/`, `docs/decisions/0001-0004.md` | No deployed production acceptance evidence found | Not started / open decisions | F0-003; Phase 4; required for complete Class B E2E claim, otherwise explicitly excluded |
| Write gateway | `gateway/write/src/index.ts`, `gateway/write/README.md` | Typecheck and bundle dry run | CI typecheck/bundle passed, but handler returns HTTP 501 | F0-004; Phase 5; not operational despite build checks passing |
| Shared signing/behaviour conformance | `conformance/signing-vectors.json`, `conformance/harness/README.md` | Shared vectors/harness | Vectors empty/stub; harness not implemented | F0-005; complete in planned conformance/integration phases before cross-implementation claims |
| Real end-to-end pilot | `docs/END-TO-END.md`, `docs/pilot/README.md` | Pilot record | Not started | F0-006; Phase 6; required for complete E2E readiness claim |
| Branch/tag protection and required CI gates | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, repository settings | Workflow YAML inspected; settings endpoint returned 403 | Not verified | R0-004; repository admin/integration permission needed for settings evidence |
| Release publication | `.github/workflows/release.yml`, GitHub releases | Release inventory | No published releases listed at inspection time; no release action performed | Later release phase; do not publish during Phase 0 |

## Baseline commands and execution record

The implementation plan's Phase 0 lists these commands. They were run locally on 2026-10-26 and **all exited 0**; command, environment, counts and output are in `PHASE-0-BASELINE.md`:

1. `python3 -m unittest discover -s template/engine/tools -v`
2. `python3 -m unittest discover -s gateway/read/reference -p 'test_*.py' -v`
3. `release/test-release.sh`
4. `tests/test_update.sh`
5. `release/package.sh dist`
6. `release/verify.sh dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz`
7. `(cd gateway/write && npm ci && npm run typecheck && npm run check:bundle)`

Related configured CI steps also passed in Actions run `https://github.com/inscope-labs/build-engine/actions/runs/40317887672`, The CI-step-to-command mapping has not been independently checked against `ci.yml`. The release-specific `--release` verification was run and fails on F0-001 (UNSET), as expected.

## Operator approval needed

Please review the classifications above, especially whether production Class B read, agent-side write, conformance, and the real pilot are mandatory for the first published release or explicitly excluded/qualified. This approval is a Phase 0 exit-gate requirement in the implementation plan; it is not permission to bypass later technical gates.
