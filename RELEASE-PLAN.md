BUILD-ENGINE
Repository-Wide First Release Implementation Plan
Target repository: https://github.com/inscope-labs/build-engine
Planning baseline: main branch, VERSION 0.5.0 (unreleased)
Objective: deliver the first verified, installable, operationally coherent release artifact and prove its supported end-to-end workflow.

======================================================================
1. RELEASE OBJECTIVE AND SCOPE
======================================================================

The objective is not merely to make the tarball build. The objective is to release a versioned artifact that a consumer can install, configure, use for its supported workflows, update safely, and independently verify.

The repository currently has substantial working code for the shipped template, packaging, verification, and consumer update path. The repository's own status documentation identifies two immediate release-gate blockers:
- template/engine/ENGINE.json has implements_abstract = UNSET.
- CHANGELOG.md has an unreleased 0.5.0 entry rather than the dated entry required by the release gate.

The broader end-to-end system is not yet complete:
- Read gateway production implementation is a directory of design/operations placeholders; decisions 0001-0004 are open.
- Conformance signing vectors and executable harness are incomplete.
- Write gateway is explicitly a scaffold: its Worker returns HTTP 501 and most source/test files are stubs.
- Remote revocation/audit, gateway deployment, and the real-task pilot are not complete.

Therefore, distinguish two acceptance levels:
A. RELEASE ARTIFACT COMPLETE: package, verify, release, install, configure, operate the shipped operator workflow, and update without data loss.
B. END-TO-END SYSTEM COMPLETE: supported Class B read and submission paths work against deployed gateways, including revocation, audit, recovery, and a real pilot.

The first release should not be labelled “100% working” unless every capability advertised as supported for that release passes its acceptance tests. Features not ready must either be completed or explicitly excluded from the supported release scope and documented as unavailable. Do not imply the gateway scaffolds are production-ready.

Proposed release target: 0.5.0, subject to the version/compatibility decision in Phase 1. Do not tag or publish until all required gates pass.

Release boundary:
- Shipped consumer artifact is built only from template/ through release/manifest.txt.
- gateway/, conformance/, variants/, tests/, release tooling, and maintainer docs remain source-only unless a separately approved architecture change says otherwise.
- A deployed gateway is infrastructure required for some end-to-end workflows, not content that should be copied into the consumer artifact.
- No agent receives a GitHub repository credential. Preserve task-scoped authority, auditability, minimal data exposure, and operator-controlled publication/revocation.
- Keep one main production-capable branch, with short-lived feature/fix/release branches. Staging and explicit release approval are mandatory; no direct development-to-released shortcut.
- Avoid broad refactors. Resolve verified defects first, retain working behaviour, and make each task independently reviewable.

======================================================================
2. GLOBAL EXECUTION RULES
======================================================================

G-01. Work from a clean checkout of main and record the starting commit SHA.
G-02. Before changing a subsystem, read its README, applicable ADR/spec, tests, and consumers.
G-03. Every task must record: intent, files/scope, dependencies, acceptance criteria, test evidence, risks, and unresolved questions.
G-04. Do not silently overwrite consumer-owned files, task data, staging data, or prior release assets.
G-05. Use a branch and pull request for each coherent work package. Do not run concurrent writers against the same branch or stateful task.
G-06. Do not claim a test passed unless its command ran and its output/result was inspected.
G-07. Fail closed on invalid signatures, malformed inputs, out-of-scope paths, missing configuration, policy ambiguity, exhausted quotas, stale authorization, or unverifiable artifacts.
G-08. Keep credentials out of source, fixtures, URLs where avoidable, console output, CI logs, and audit records. Use test-only secrets in fixtures.
G-09. Keep gateway code and secrets out of release artifacts. Release isolation must be tested, not assumed.
G-10. A failed gate blocks the phase transition. Record the failure and evidence; do not mark the task complete based on documentation changes alone.
G-11. Keep a single authoritative definition for protocol fields, limits, status/error semantics, version metadata, and release manifest behaviour.
G-12. Preserve user/operator authority: the system may prepare, validate, stage, and report, but consequential publication or release must follow an explicit operator-controlled gate.

======================================================================
PHASE 0 — BASELINE, INVENTORY, AND DEFECT REGISTER
======================================================================

Intent:
Establish the exact starting state, distinguish confirmed defects from suspected risks, and create a traceable work backlog before implementation.

Stage 0.1 — Establish the source baseline
  0.1.1 Record default branch, current HEAD SHA, VERSION, recent commits, tags, and current GitHub Actions status.
  0.1.2 Confirm whether any release/tag already exists; never reuse or mutate a published version.
  0.1.3 Run the existing documented baseline commands:
        - python3 -m unittest discover -s template/engine/tools -v
        - python3 -m unittest discover -s gateway/read/reference -p 'test_*.py' -v
        - release/test-release.sh
        - tests/test_update.sh
        - release/package.sh dist
        - release/verify.sh dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz
        - (cd gateway/write && npm ci && npm run typecheck && npm run check:bundle)
  0.1.4 Capture all failures, warnings, environment prerequisites, and generated files. Do not “fix” baseline failures before recording them.

Stage 0.2 — Audit repository completeness and consistency
  0.2.1 Compare README, docs/STATUS.md, docs/END-TO-END.md, docs/ARCHITECTURE.md, docs/RELEASING.md, gateway READMEs, ADRs, prompts, and actual implementation.
  0.2.2 Compare release/manifest.txt against template/ recursively; identify missing, stale, duplicate, or unintended allowlist entries.
  0.2.3 Compare the list of claimed tests in CI against tests that actually exist and perform meaningful assertions.
  0.2.4 Search for stale Castiel-specific language, example.com URLs, TODO/stub markers, HTTP 501 handlers, placeholder configuration, dead links, inconsistent names, and claims that exceed implementation.
  0.2.5 Audit release tooling for path traversal, symlink, archive-entry, checksum, duplicate manifest, version mismatch, untrusted input, and failure-cleanup edge cases.
  0.2.6 Audit consumer installer/update logic for local edits, untracked collisions, removed managed files, interrupted updates, lock corruption, rollback, and first-install behaviour.
  0.2.7 Audit gateway state and authorization lifecycle for cross-task access, stale/replayed links, restart/eviction, concurrency, quotas, revocation, and audit leakage.

Stage 0.3 — Create the defect register and release traceability
  0.3.1 Create a numbered defect register (e.g. docs/release/DEFECT-REGISTER.md) with severity, evidence, affected paths, consequence, remediation task, and closure proof.
  0.3.2 Create requirement-to-test traceability for every advertised release capability.
  0.3.3 Label findings as CONFIRMED, RISK TO TEST, or DESIGN DECISION. Do not present untested suspicions as proven defects.
  0.3.4 Classify each capability as REQUIRED FOR FIRST RELEASE, EXPLICITLY OUT OF SCOPE, or FUTURE WORK.

Exit gate:
- Reproducible baseline recorded.
- No unknown release-critical test failures.
- Defect register and release scope approved by the operator.
- Every release promise has a corresponding acceptance test or is removed/qualified in the documentation.

======================================================================
PHASE 1 — RELEASE CONTRACT AND ARCHITECTURE DECISIONS
======================================================================

Intent:
Resolve decisions that could otherwise make the implementation internally inconsistent or unsafe.

Stage 1.1 — Define the first-release product contract
  1.1.1 Define the release's supported users, Class A/Class B behaviour, supported consumer repository shape, supported operating environments, and explicit limitations.
  1.1.2 Define the minimum successful workflow from plan creation through work order, context access, submission, operator review, publication/reconciliation, revocation/audit, and consumer update.
  1.1.3 Decide whether first release requires the deployed Class B read and write gateways. Given the stated end-to-end purpose, default to requiring them for a claim of complete end-to-end functionality; otherwise explicitly label them as not included/not operational in the first release.
  1.1.4 Define what “100% working” means as finite acceptance criteria; do not use it as an untestable general claim.

Stage 1.2 — Resolve version and abstract-framework compatibility
  1.2.1 Determine the exact abstract framework/specification and version implemented by engine 0.5.0.
  1.2.2 If compatibility is genuinely with a versioned Castiel abstract framework, record the exact version and retain the Castiel naming consistently.
  1.2.3 If Build Engine is intended to be product-neutral, approve a schema/field migration from implements_abstract to a generic, unambiguous compatibility identifier; update all readers, schemas, docs, tests, and release gates together. Do not merely replace UNSET with an arbitrary value.
  1.2.4 Synchronize VERSION, template/engine/VERSION, template/engine/ENGINE.json, COMPATIBILITY.md, and CHANGELOG.md using release/set-version.sh and an explicit reviewed compatibility entry.
  1.2.5 Remove or clearly mark Castiel-specific prose/examples where it contradicts the generic product contract.

Stage 1.3 — Resolve read gateway decisions
  1.3.1 Close docs/decisions/0001-gateway-hosting.md: hosting/runtime, deployment model, environment separation, and operator ownership.
  1.3.2 Close 0002-proxy-reachability.md: supported network path, proxy constraints, origin reachability, and failure modes.
  1.3.3 Close 0003-link-lifetimes.md: expiry defaults, maximum lifetime, clock skew, re-minting, and revocation semantics.
  1.3.4 Close 0004-served-prefixes.md: exact path allowlist/prefix policy, traversal normalization, encoding, symlink/submodule behaviour, and pinned-ref rules.
  1.3.5 Confirm 0005-Class-A access is intentionally a separate trust path; document its credential and audit assumptions without weakening Class B controls.

Stage 1.4 — Resolve write gateway decisions before coding
  1.4.1 Adopt or reject the proposed GET-only write gateway explicitly. If adopted, describe it as a constrained compatibility transport, not a claim that GET is semantically safe for mutation.
  1.4.2 Resolve ADR 0001 Durable Object coordination and storage; define what is durable, ephemeral, and recoverable across isolate eviction, restart, deployment, and retry.
  1.4.3 Resolve ADR 0002 content handling: payload must not be copied to third-party storage; define in-memory handling, maximum request size, and provider-side logging boundaries.
  1.4.4 Resolve ADR 0003 side-effecting GET risk: disable caching with response headers, use no-store/no-cache controls, avoid redirects, avoid prefetchable links where possible, ensure request logs never retain query payloads/root capability/signatures, and document the residual risk from clients/proxies/platform logs. If the residual risk cannot be accepted, change the protocol or exclude this route from production.
  1.4.5 Resolve ADR 0004 audit hygiene: redact root URL, signatures, base64 payloads, content, sensitive paths where necessary, and all secrets; audit event types and retention must be explicit.
  1.4.6 Decide the GitHub write boundary. A fine-grained PAT is repository-scoped, not folder-scoped; path scope must be enforced by code and does not limit the impact of a leaked token. Prefer a dedicated submissions repository or isolated submissions branch with a narrowly scoped credential, plus server-enforced task-folder allowlisting. Do not claim the credential itself is path-scoped.
  1.4.7 Define commit semantics, retry idempotency, same-key/different-payload conflicts, partial provider failures, compare-and-swap/expected SHA handling, single-writer lease expiry, seal versus revoke, and the behaviour after work-order closure.
  1.4.8 Define quotas with units: 20 files, 240 KiB total, 12 KiB per file, 30 requests per 60 seconds, and one concurrent writer, if those remain the approved limits. Use bytes as the authoritative calculation and publish the exact constants.
  1.4.9 Define allowed text extensions/types, UTF-8 validation, binary rejection, path normalization, reserved/hidden names, content schema validation, and whether empty files are allowed.

Exit gate:
- Architecture decisions are recorded and approved.
- No implementation begins on an unresolved security-critical ambiguity.
- First-release scope, compatibility contract, gateway protocol, and failure/recovery semantics are testable and consistent.

======================================================================
PHASE 2 — REPAIR RELEASE FOUNDATION AND SHIPPED TEMPLATE
======================================================================

Intent:
Make the consumer artifact reliable and internally consistent independent of gateway completion.

Stage 2.1 — Repair metadata and documentation
  2.1.1 Synchronize all version sources and compatibility metadata.
  2.1.2 Replace the unreleased changelog header only at release-candidate time with the correct version/date and actual changes.
  2.1.3 Fix stale links, placeholders, incorrect paths, contradictory status claims, and outdated install/update examples.
  2.1.4 Ensure docs accurately distinguish implemented, reference-only, scaffold, not deployed, and unsupported capabilities.
  2.1.5 Ensure shipped documentation does not instruct operators to use nonexistent endpoints or imply that an undeployed gateway is available.

Stage 2.2 — Harden plan/order tooling
  2.2.1 Audit plan, stage, task, work-order, submission, decision, and coverage schemas against actual parser/writer behaviour.
  2.2.2 Add tests for malformed JSON, missing required fields, unknown fields where relevant, duplicate IDs, path traversal, invalid state transitions, stale pinned commits, and invalid cross-references.
  2.2.3 Ensure work orders bind exact file paths and immutable refs/commits; do not silently resolve moving branches at fetch time.
  2.2.4 Ensure state-changing operations are atomic where practical and leave recoverable state after interruption.
  2.2.5 Verify single-writer plan state ownership, deterministic output, stable exit codes, and actionable operator errors.
  2.2.6 Confirm `plan_tool.py` and `ctxlink.py` use the same canonical signing message, encoding, path normalization, expiry, and key ID rules.

Stage 2.3 — Harden operator bridge and configuration
  2.3.1 Test `cbridge init`, `bootstrap`, `doctor`, `sync`, `upload`, `publish`, `reconcile`, `halt`, and `resume` in isolated temporary repositories.
  2.3.2 Test missing/malformed configuration, missing tools, expired credentials, API errors, non-fast-forward conflicts, duplicate uploads, and interrupted operations.
  2.3.3 Ensure upload/publish/reconcile cannot silently overwrite upstream content; use expected SHAs or explicit conflict reports.
  2.3.4 Keep secrets out of stdout/stderr, shell tracing, temporary files, and audit output.
  2.3.5 Ensure publication is an explicit operator action and the bridge never merges or publishes without the approved workflow.

Stage 2.4 — Harden install/update
  2.4.1 Test first install into an empty consumer repository.
  2.4.2 Test update from a previous supported release with clean, locally modified, untracked, missing, and newly introduced files.
  2.4.3 Verify seed files are created only if absent and are never overwritten by ordinary updates.
  2.4.4 Verify modified managed files trigger a clear conflict and no partial update unless the operator explicitly uses --force.
  2.4.5 Test removed managed files, lock-file corruption, missing lock entries, checksum mismatch, wrong version, malformed manifests, interrupted update, and recovery.
  2.4.6 Ensure update does not commit, push, merge, or alter consumer-owned plan data.
  2.4.7 If the updater cannot provide all-or-nothing behaviour, implement a staging/backup/rollback transaction and test it.

Exit gate:
- Shipped tools pass unit, integration, adversarial, and failure-recovery tests.
- Consumer-owned files and data survive all normal update paths.
- The artifact can be installed and used from a clean checkout without undocumented manual repairs.

======================================================================
PHASE 3 — RELEASE PIPELINE AND ARTIFACT INTEGRITY
======================================================================

Intent:
Prove the finished artifact is safe, deterministic, reproducible enough for the release contract, and independently verifiable.

Stage 3.1 — Validate allowlist packaging
  3.1.1 Audit every line in release/manifest.txt for existence, ownership mode, and intended inclusion.
  3.1.2 Reject duplicate paths, conflicting managed/seed declarations, absolute paths, traversal, symlinks, special files, and unexpected generated files.
  3.1.3 Confirm the generated RELEASE-MANIFEST hashes every packaged file and matches the actual contents exactly.
  3.1.4 Verify repeated builds from the same commit produce byte-identical archives and checksums.
  3.1.5 Ensure package output is not accidentally included in its own input or stale artifacts are not mistaken for current output.

Stage 3.2 — Harden independent verification
  3.2.1 Test malicious archive names, absolute paths, traversal components, duplicate entries, symlink/hardlink/device entries, truncated archives, checksum mismatch, and missing sidecar checksum.
  3.2.2 Validate archive member names as path components, not substring matches; avoid rejecting safe names merely because they contain two dots while still rejecting actual traversal.
  3.2.3 Validate the release manifest for duplicate entries, missing entries, unlisted files, malformed hashes, bad modes, and unexpected metadata.
  3.2.4 Review forbidden.txt patterns for bypasses and false positives; add tests for both.
  3.2.5 Confirm gateway, conformance, variants, test code, secrets, `.env`, Worker configs, node_modules, local state, and unapproved files are excluded and that renamed gateway-like code is detected.
  3.2.6 Confirm artifact version, VERSION, ENGINE.json, release manifest header, tag, changelog heading, and release notes all agree.
  3.2.7 Verify the unpacked payload independently, without relying on repository-only files other than the verifier's explicit policy inputs.

Stage 3.3 — Strengthen CI/release workflow
  3.3.1 Ensure CI runs on pull requests and pushes to main and covers shipped tests, gateway tests, shell syntax, release self-tests, install/update tests, and gateway checks.
  3.3.2 Add explicit security/static checks and dependency audit appropriate to Python, shell, Node, and Cloudflare Worker code.
  3.3.3 Pin third-party GitHub Actions to reviewed immutable commit SHAs where practical; use least-privilege permissions and avoid secrets in untrusted PR jobs.
  3.3.4 Make release publication depend on all required checks and the independent artifact verifier.
  3.3.5 Confirm a tag points to a commit reachable from main and matches VERSION exactly.
  3.3.6 Confirm failed release gates publish no asset and do not create a misleading GitHub Release.
  3.3.7 Configure and test branch/tag protection outside code where necessary; record evidence because repository settings cannot be guaranteed by a README.
  3.3.8 Add artifact provenance: source commit, version, checksum, build workflow/run, and release notes. Do not claim cryptographic attestation unless actually generated and verified.

Stage 3.4 — Release machinery adversarial self-test
  3.4.1 Expand release/test-release.sh so every security and consistency check has at least one negative test.
  3.4.2 Include positive fixtures proving safe paths and legitimate content are not rejected.
  3.4.3 Run the full self-test against a temporary copy and ensure it leaves the working tree and dist output in a known state.

Exit gate:
- Package, verify, update, and release tests pass.
- Negative tests prove the release gates fail closed.
- The final artifact is deterministic, allowlisted, checksum-verified, and contains no source-only gateway components or secrets.

======================================================================
PHASE 4 — READ GATEWAY: PRODUCTION IMPLEMENTATION
======================================================================

Intent:
Provide a deployable Class B context-read route with identical semantics to the client signer and reference implementation.

Stage 4.1 — Conformance foundation
  4.1.1 Complete conformance/signing-vectors.json, including existing ASCII and non-ASCII/space cases.
  4.1.2 Specify canonical UTF-8 message construction, HMAC-SHA256, base64url without padding, path normalization, key IDs, expiry, and order binding.
  4.1.3 Build an executable harness for signer and gateway implementations.
  4.1.4 Turn behaviours B1-B11 into executable cases covering valid reads, invalid signatures, expiry, wrong key/order/ref/path, traversal, missing files, revoked orders, and audit behaviour.
  4.1.5 Ensure the Python client and reference gateway pass the same shared vectors and tests.

Stage 4.2 — Implement production port
  4.2.1 Implement the approved hosting/runtime and source adapter from decisions 0001-0004.
  4.2.2 Bind each request to the approved repository, immutable commit/ref, work order, and allowed path prefix.
  4.2.3 Prevent traversal and encoding bypasses, including percent-encoding, repeated separators, dot segments, Unicode edge cases, and ambiguous normalization.
  4.2.4 Return only the single authorized file; never allow arbitrary repository API proxying, directory browsing, branch switching, or broad file retrieval.
  4.2.5 Enforce expiry, key rotation, order revocation, and operator-controlled re-minting.
  4.2.6 Add bounded timeouts, upstream error mapping, rate limits, abuse controls, and no-store/cache prevention.
  4.2.7 Implement structured audit events with redaction, request correlation IDs, and no token/signature/content leakage.
  4.2.8 Provide health checks and operational metrics without disclosing protected state.

Stage 4.3 — Deployment and operational verification
  4.3.1 Add reproducible environment/configuration instructions and separate test/staging/production settings.
  4.3.2 Add a deploy gate that requires tests and conformance to pass before deployment.
  4.3.3 Verify cold starts, provider failures, unavailable source repository, expiry, revoked order, and key rotation in staging.
  4.3.4 Prove the gateway does not write to the source repository and does not persist copied file contents to third-party storage.
  4.3.5 Complete the operator runbook for deploy, key rotation, revoke, inspect audit, incident response, and rollback.

Exit gate:
- Production implementation passes the same conformance suite as the reference gateway.
- A Class B agent can fetch only the intended pinned file using plain HTTPS GET and cannot fetch adjacent or unauthorized content.
- Revocation takes effect within the documented bound; audit logs contain no capability secrets.

======================================================================
PHASE 5 — WRITE GATEWAY: TASK-SCOPED SUBMISSION
======================================================================

Intent:
Replace the current 501/stub scaffold with a tested submission service, while preserving operator authority and minimizing credential blast radius.

Stage 5.1 — Protocol and security contract
  5.1.1 Convert all approved ADRs into one canonical protocol contract: routes, query parameters, schemas, errors, links, quotas, session state, and lifecycle.
  5.1.2 Replace example.com links in the agent prompt with a versioned canonical contract URL or generated links; do not require agents to construct endpoints from memory.
  5.1.3 Define the root capability format, signature verification, expiry, task/work-order binding, key rotation, revocation, and authorization checks for every operation.
  5.1.4 Ensure each operation is bound to one task folder and one authorized writer; no request may choose an arbitrary repository, branch, or path.
  5.1.5 Specify how a GET-only transport avoids accidental caching/prefetch and how residual URL/query leakage is handled. A secret root URL is a bearer capability; treat it accordingly.
  5.1.6 Define the submission repository/branch and credential boundary. Prefer isolated submissions storage or branch; restrict server code to a fixed destination and exact task folder. Document residual risk of a repository-scoped token.
  5.1.7 Define staged-state recovery honestly. If staging is ephemeral, every response and runbook must state what can be lost; if delivery must survive restart, implement durable coordination/metadata and a recoverable content strategy without third-party content storage.

Stage 5.2 — Implement core request and session lifecycle
  5.2.1 Replace the 501 Worker entry with validated routing and consistent response envelopes.
  5.2.2 Implement root URL parsing, canonical signature verification, authorization policy, and fail-closed environment validation.
  5.2.3 Implement Durable Object single-writer coordination with race-safe claim/release, lease expiration, and explicit 409 behaviour.
  5.2.4 Implement sequence numbers, chunk hashes, idempotent append/replay, conflicting replay rejection, and bounded memory usage.
  5.2.5 Implement create/scaffold, append, replace, read-back, status/list, and soft delete/tombstones.
  5.2.6 Implement quota accounting atomically across requests and concurrent retries; count bytes in a single agreed unit.
  5.2.7 Implement strict path safety, extension/type policy, UTF-8 and text-only checks, size limits, and optional schema validation.
  5.2.8 Implement hypermedia links for every valid next step and corrective-help responses for errors.
  5.2.9 Implement seal as an irreversible freeze of the task folder; distinguish seal, work-order closure, and operator revocation as separate state transitions.
  5.2.10 Ensure revoked/closed tasks cannot continue staging or committing, even if a URL remains otherwise well-formed.

Stage 5.3 — Implement GitHub commit/delivery
  5.3.1 Implement a fixed-destination GitHub client with bounded timeouts and safe error mapping.
  5.3.2 Validate the selected file list against staged, non-deleted, policy-compliant files; reject path escapes and unlisted paths.
  5.3.3 Make commit idempotent for the same selection and content; reject ambiguous retries and same idempotency key with different content.
  5.3.4 Handle provider rate limits, 5xx retries, timeout-after-success, partial failure, expected SHA conflicts, and concurrent commits without duplicate or unexpected writes.
  5.3.5 Commit only into the designated task submission folder on the approved build-engine branch/repository. Do not create branches, merge, or publish upstream from the gateway.
  5.3.6 Record commit SHA, selected paths, hashes, actor/task binding, result, and timestamp in redacted audit metadata.
  5.3.7 Seal only after the contract-defined successful commit/delivery state; repeated commit/seal requests must return consistent idempotent outcomes.

Stage 5.4 — Implement audit, privacy, and operations
  5.4.1 Implement structured, redacted audit logging and counters.
  5.4.2 Verify no root URL, signature, payload, base64 content, GitHub token, or raw sensitive query is emitted to logs, errors, metrics, traces, or analytics.
  5.4.3 Apply no-store and cache-control headers, suppress response bodies that echo sensitive query data, and test redirects/caches.
  5.4.4 Add explicit error catalog and operator runbook for 400/401/403/404/409/410/413/429/5xx.
  5.4.5 Add secret rotation, capability revocation, work-order closure, abuse response, and provider credential rotation procedures.
  5.4.6 Keep deployment credentials out of pull-request jobs; deploy only from protected, reviewed refs.

Stage 5.5 — Replace stub tests with real tests
  5.5.1 Pin a test runner compatible with the supported Node version and Workers/Miniflare APIs; resolve the previous npm 10 test-runner installation issue rather than leaving export {} test stubs.
  5.5.2 Unit-test every auth, path, type, quota, sequence, tombstone, idempotency, seal, and error mapping module.
  5.5.3 Integration-test the Worker and Durable Object using a local harness and mocked GitHub API.
  5.5.4 Test malformed inputs, missing env, bad signatures, expired/revoked links, cross-task reads/writes, traversal, binary files, oversized content, quota boundaries, and concurrent writers.
  5.5.5 Test isolate eviction/restart, duplicate requests, network timeout after upstream commit, GitHub 403/404/409/422/429/5xx, and recovery.
  5.5.6 Test log hygiene by injecting sentinel secrets and payloads, then asserting they never appear in captured logs.
  5.5.7 Add bounded load and chaos tests for the approved concurrency and quota envelope; no test should deploy or write to production.
  5.5.8 Add CI gates for unit, integration, typecheck, bundle, security, log hygiene, and load/chaos suites appropriate to pull request versus scheduled/staging runs.

Exit gate:
- No 501 handler or placeholder source/test stubs remain in any feature claimed as supported.
- End-to-end staging/commit/seal works, retries are safe, one-writer and quota invariants hold, and cross-task access is denied.
- No credentials or payloads leak through logs, query reflection, errors, or release artifacts.
- The operator can revoke/close a task and verify that further writes are denied.

======================================================================
PHASE 6 — CROSS-SYSTEM INTEGRATION AND REAL PILOT
======================================================================

Intent:
Prove that all components interoperate in a realistic, isolated environment rather than only passing unit tests.

Stage 6.1 — Establish a disposable staging environment
  6.1.1 Use a dedicated test repository or isolated test branch/folder and test-only credentials.
  6.1.2 Deploy read and write gateways with separate staging keys and provider configuration.
  6.1.3 Ensure staging data cannot be mistaken for production submissions and is safely disposable.
  6.1.4 Record the exact source commit, deployment IDs, environment settings (excluding secrets), and test fixture refs.

Stage 6.2 — Execute the full Class B workflow
  6.2.1 Create a plan and task with a pinned source commit and an explicit allowed context file.
  6.2.2 Issue a work order and mint a short-lived capability for that order.
  6.2.3 Verify the Class B agent retrieves only the authorized file through plain HTTPS GET.
  6.2.4 Verify wrong task, wrong path, expired link, revoked order, invalid signature, and unlisted path are denied.
  6.2.5 Deliver text files through the write gateway within type and quota policy.
  6.2.6 Read back staged content and verify exact bytes/hashes before commit.
  6.2.7 Commit only the selected files to the task submission folder on the approved build-engine branch.
  6.2.8 Verify duplicate commit retries do not create duplicate or divergent writes.
  6.2.9 Seal the task and verify all subsequent write attempts are rejected.
  6.2.10 Have the operator inspect submission, then explicitly perform any upstream publish/reconcile step.
  6.2.11 Close/revoke the work order and prove read/write capabilities are no longer usable according to the contract.
  6.2.12 Inspect audit events and verify no secret or content leakage.

Stage 6.3 — Failure and recovery pilot
  6.3.1 Interrupt requests during staging, commit, and seal; verify state and recovery follow the contract.
  6.3.2 Simulate gateway restart/eviction, GitHub rate limiting, network timeout, stale content, and conflicting updates.
  6.3.3 Verify operator can distinguish “not committed”, “committed but response lost”, “sealed”, “revoked”, and “unknown; reconcile required”.
  6.3.4 Run a second task concurrently and prove no task/session state or files cross boundaries.
  6.3.5 Document all observed deviations and repeat the pilot after remediation.

Exit gate:
- A clean, independent operator can complete the workflow using the published documentation.
- All required positive and negative scenarios pass with evidence.
- No unresolved Severity 0 or Severity 1 defect remains.
- Pilot report is reviewed and signed off.

======================================================================
PHASE 7 — RELEASE CANDIDATE, INSTALLATION, AND INDEPENDENT VERIFICATION
======================================================================

Intent:
Create a candidate from an exact main commit and prove the artifact works as a consumer would receive it.

Stage 7.1 — Prepare the release candidate
  7.1.1 Merge only reviewed, passing changes to main.
  7.1.2 Select the release version; confirm no existing tag or release uses it.
  7.1.3 Run release/set-version.sh and validate all version fields and compatibility metadata.
  7.1.4 Finalize CHANGELOG.md with a dated release entry containing only delivered changes.
  7.1.5 Update COMPATIBILITY.md and README release status; remove any “unreleased” ambiguity.
  7.1.6 Confirm all release manifest changes are intentional and reviewed.

Stage 7.2 — Build and independently verify
  7.2.1 Run the full CI suite from a clean checkout.
  7.2.2 Build the deterministic artifact and SHA-256 sidecar.
  7.2.3 Run release/verify.sh with --release and preserve the full output as release evidence.
  7.2.4 Inspect the archive listing, manifest, checksums, version metadata, and forbidden-content scan independently.
  7.2.5 Install into a new throwaway consumer repository using the documented release-download/update commands.
  7.2.6 Exercise plan/order tooling and supported operator workflow from the installed copy, not the source checkout.
  7.2.7 Test update from the previous supported version and preserve all consumer-owned plan data/configuration.
  7.2.8 Rebuild from the same commit and compare artifact checksum to confirm determinism.

Stage 7.3 — Release authorization and publication
  7.3.1 Confirm required CI, security, pilot, artifact, installation, compatibility, and operator approvals are complete.
  7.3.2 Confirm rollback/forward-fix plan and incident contact/owner.
  7.3.3 Create an annotated vX.Y.Z tag pointing to the approved main commit and push it.
  7.3.4 Allow the protected release workflow to re-run tests, package, verify, and publish the archive plus checksum.
  7.3.5 Verify the published release assets and checksum from a separate clean environment.
  7.3.6 Never edit or delete a published asset; fix defects in a new version.

Exit gate:
- The published artifact matches the approved source commit and version.
- Clean installation and update tests pass.
- All advertised first-release capabilities are backed by evidence.
- No release asset is published if any gate fails.

======================================================================
PHASE 8 — POST-RELEASE ACCEPTANCE AND HANDOVER
======================================================================

Intent:
Confirm the release is usable and supportable after publication.

Stage 8.1 — Consumer smoke test
  8.1.1 Download the published asset and checksum using the documented authenticated path.
  8.1.2 Verify the checksum and install into a clean consumer repository.
  8.1.3 Run documented health/doctor checks and a small non-production task.
  8.1.4 Confirm the consumer diff contains only expected managed files and seed files.
  8.1.5 Confirm no auto-commit, auto-merge, or unintended publication occurred.

Stage 8.2 — Handover and follow-up
  8.2.1 Publish release notes, known limitations, supported environment details, and upgrade instructions.
  8.2.2 Archive test reports, conformance results, pilot evidence, artifact checksum, source SHA, and deployment references.
  8.2.3 Update docs/STATUS.md and docs/END-TO-END.md to reflect evidence, not intent.
  8.2.4 Open follow-up work for deferred capabilities, defects, and operational improvements.
  8.2.5 Review incidents/metrics after the initial use and issue a patch release if needed.

Exit gate:
- Consumer smoke test passes.
- Documentation reflects the shipped reality.
- Release evidence and remaining work are traceable.

======================================================================
3. CROSS-CUTTING DEFECTS AND CRITICAL RISKS THAT MUST BE CLOSED
======================================================================

R-01 — Release metadata blocker:
ENGINE.json compatibility is UNSET and CHANGELOG has an unreleased heading. Resolve in Phase 1/2/7 with a real, approved compatibility value, not a bypass.

R-02 — Product/documentation inconsistency:
Castiel-specific prose conflicts with the generic Build Engine framing in some docs. Decide the product's compatibility identity, then update all affected docs, prompts, schemas, tests, and gates consistently.

R-03 — False impression of end-to-end readiness:
The read production port is not implemented; the write Worker returns 501; conformance vectors/harness and pilot are incomplete. Correct the status now and do not describe these as operational until Phases 4-6 pass.

R-04 — Side-effecting GET security:
The write gateway proposal encodes payloads in URLs and mutates state through GET. Caches, prefetch, proxies, client history, and infrastructure logs can expose URL contents or trigger requests unexpectedly. This is a production blocker until the residual risk is documented, mitigated, and explicitly accepted—or the protocol is changed.

R-05 — Credential blast radius:
A repository-scoped GitHub token is not folder-scoped. Enforce destination paths server-side and preferably isolate the submission destination/repository. Do not advertise stronger credential scope than actually exists.

R-06 — Ephemeral staging and retry ambiguity:
Ephemeral in-memory content can disappear on eviction, and a timed-out commit may have succeeded upstream. Define explicit recovery states, idempotency keys, durable metadata/leases, reconciliation, and operator-visible ambiguity before production.

R-07 — Incomplete tests:
Scaffold tests such as `export {}` are not tests. Pin a viable Worker test framework and replace stubs with assertions against actual behaviour, including adversarial and failure scenarios.

R-08 — Conformance fragmentation:
Signing rules exist in prose and implementation-specific tests. Shared machine-readable vectors and one harness must become the source of truth for client, reference gateway, and production port.

R-09 — Artifact verifier edge cases:
Test actual archive path components, duplicate members, link/special entries, manifest inconsistencies, and false positives. Verify both the package output and the finished archive independently.

R-10 — Release governance:
Branch/tag protection and permissions require GitHub settings outside repository code. Configure them explicitly, validate them, and preserve evidence; a workflow file alone does not prove protections are enabled.

R-11 — Privacy/audit leakage:
Audit query strings, proxy logs, exception messages, traces, and metrics. Redaction must be tested with injected sentinel capabilities, credentials, and payloads.

R-12 — Scope ambiguity:
Decide whether first release is the verified consumer artifact only or the full deployed Class B system. Do not mix the two acceptance claims. If the full end-to-end purpose is the release promise, production gateways and pilot are mandatory.

======================================================================
4. REQUIRED RELEASE ACCEPTANCE CHECKLIST
======================================================================

All items must be checked with linked evidence before the release is declared complete.

[ ] Version and compatibility metadata are consistent and approved.
[ ] Dated changelog and release notes match delivered functionality.
[ ] All required unit and integration tests pass from a clean checkout.
[ ] All security-negative tests fail closed as expected.
[ ] Release self-test covers every important rejection path.
[ ] Archive is deterministic, allowlisted, checksum-verified, and free of gateway code/secrets.
[ ] Artifact verifier rejects malicious paths, links, duplicate/missing files, bad hashes, and version mismatch.
[ ] Clean install succeeds without source-repository context.
[ ] Update from a previous release succeeds without overwriting consumer-owned data.
[ ] Modified managed files produce a safe, understandable conflict.
[ ] Operator publication remains explicit and auditable.
[ ] Read gateway conformance passes if Class B context retrieval is in release scope.
[ ] Write gateway unit/integration/adversarial/recovery tests pass if Class B submission is in release scope.
[ ] Quotas, type policy, single-writer, idempotency, seal, revocation, and work-order closure are verified.
[ ] No capability URL, signature, payload, token, or private content appears in logs.
[ ] End-to-end pilot passes if the release is advertised as end-to-end operational.
[ ] GitHub branch/tag/release protections and CI permissions are verified.
[ ] Independent consumer smoke test passes against the published asset.
[ ] Release evidence is archived and docs/STATUS.md is updated from observed results.

======================================================================
5. RECOMMENDED IMPLEMENTATION ORDER
======================================================================

1. Phase 0 baseline and defect register.
2. Phase 1 product scope and security-critical decisions.
3. Phase 2 shipped template, plan tooling, cbridge, installer/update repairs.
4. Phase 3 release pipeline and artifact-verifier hardening.
5. Phase 4 read gateway and shared conformance suite.
6. Phase 5 write gateway and operational security.
7. Phase 6 full staging pilot.
8. Phase 7 release candidate and publication.
9. Phase 8 consumer smoke test and handover.

Phases 4 and 5 may have separate implementation branches after Phase 1 decisions, but their integration and pilot must be sequentially gated. Do not release merely because the tarball passes while the product's advertised workflow remains nonfunctional.

FINAL DEFINITION OF DONE

The first release is complete only when:
- The exact release scope is approved and documented.
- Every included capability is implemented rather than scaffolded, and its acceptance tests pass.
- All release-critical defects are closed with evidence.
- The built artifact passes independent verification and installs/updates safely.
- Every required gateway and operator workflow in the release contract passes an end-to-end staging pilot.
- The published asset is tied to an approved main commit, version, checksum, release notes, and explicit operator authorization.
- Known limitations are stated plainly; no unimplemented or untested capability is represented as working.
