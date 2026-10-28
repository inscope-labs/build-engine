# Build Engine — Phase 1.1 First-Release Product Contract (APPROVED)

- Repository: https://github.com/inscope-labs/build-engine
- Revises: the Stage 1.1 draft merged in PR #2 (baseline `8ca5769`)
- Audited against: `main` @ `99a5a7318cff755b1c34ba68b7e57494e0328066`
- Version under consideration: 0.5.0
- Date: 2026-10-26
- Status: **APPROVED**
- Approval: Approved by developer on 2026-10-27 with the amendments listed in the Stage 1.1 compliance closure. Status updated from “REVISED DRAFT — pending operator approval” to “APPROVED”.

This revision replaces the earlier draft, which classified the Class B read gateway and the write gateway as out of scope. Stage 1.3 and Stage 1.4 record the operator's decision that both are **in scope and mandatory** for the first release. This document aligns the contract with that decision. Where a decision is already recorded elsewhere it is referenced, not restated, so there is one authoritative definition (plan rule G-11): read-gateway decisions in `docs/decisions/0001`–`0005` and `PHASE-1.3-READ-GATEWAY-DECISIONS.md`; write-gateway decisions in `gateway/write/docs/adr/0001`–`0004` and `PHASE-1.4-WRITE-GATEWAY-DECISIONS.md`; compatibility in `PHASE-1.2-COMPATIBILITY.md`.

## 1.1.1 Users, Class A / Class B behaviour, consumer repository, environments, limitations

### Supported users

| Role | Description | Credential model |
|------|-------------|------------------|
| Operator | Human who owns the plan, mints work orders and context links, reviews deliverables, publishes, reconciles, and controls revocation and audit. | Operator-held repository credentials. Only the operator publishes. |
| Class A agent | Authenticated agent that can read private raw URLs or clone the private repository with its own credentials. Includes the Supervisor Agent (operator-initiated). | Agent-held credential scoped to the private consumer repository or the sealed task folder in the submissions repository (task-scoped). The operator supplies a short-lived token secret during the work-order / transfer request process; the token must cover the task scope exactly. Decision 0005 keeps this as a separate trust path; it does not use the gateways and must not weaken Class B controls. Standard audit practices apply. |
| Class B agent | Unprivileged agent that must not hold any repository credential and can only issue HTTPS GET. | None. Reads context only through short-lived, signed, path-scoped links served by the read gateway, and submits deliverables only through the task-scoped write gateway. |

### Class A / Class B behaviour (first-release contract)

- **Class A:** the operator embeds raw URLs pinned to a commit in the work order; the agent fetches them with its own credential. No gateway mediation. The Supervisor Agent is an operator-initiated Class A agent whose authority is limited to the sealed task folder in the submissions repository and the corresponding destination paths in the consumer repository; it may not publish, revoke, or alter any other work order.
- **Class B read:** a work order carries signed, expiring, path-scoped links (minted by `plan_tool.py links` / `ctxlink.py`). The production read gateway returns exactly the one authorized file at the pinned reference and nothing else (no directory listing, branch switching or repository proxying). Expiry, key rotation, revocation and audit are as decided in 0001–0004.
- **Class B write:** the agent submits through the task-scoped write gateway using a root capability bound to one work order and one task folder. Transport, quotas, single-writer rule, commit and seal semantics, audit hygiene and the GitHub credential boundary are as decided in Stage 1.4. The transport is a constrained compatibility transport for GET-only agents; the contract does not claim that GET is safe for mutation, and the residual risks accepted in Stage 1.4.1 are listed under limitations.

### Supported consumer repository shape

A consumer repository that has received the artifact via `engine/bin/update.sh` (or the first-install equivalent) contains at minimum:

- `engine/` — managed files from the artifact (VERSION, release.json, tools, schemas, prompts, templates, `bin/update.sh`, AGENTS.md) and the seed file `engine/engine.json`.
- `operator/` — managed operator bridge (`cbridge`, `install.sh`, example config).
- `docs/` — managed operational documentation shipped with the artifact.
- `plans/` — consumer-owned plan data; the artifact ships only `plans/README.md`.
- `.build-engine.lock` — state file maintained by the updater.

The updater treats only paths declared in the release manifest as managed or seed; all other consumer files are left untouched. The gateways are infrastructure, not artifact content: they are never packaged (release boundary in the plan, section 1).

Exact metadata pair (authoritative):
- managed `engine/release.json` (release metadata: `engine_version`, `protocol`; renamed from `ENGINE.json`)
- seed    `engine/engine.json` (the consumer's editable configuration, read by `plan_tool.py`; never overwritten)

### Supported operating environments

- **Linux and Termux/Android:** supported. The operator bridge is a Termux-oriented script and the maintainer builds and operates from Termux.
- **macOS:** not claimed as supported. The shipped scripts need bash 4.4 or newer, `sha256sum` and (for packaging) GNU `tar`, which stock macOS does not provide (it ships bash 3.2 and BSD tools). Support can be added later either by documenting Homebrew `bash`, `coreutils` and `gnu-tar` as requirements or by porting the scripts (register F0-014).
- Required tools (minimum versions for both Linux and Termux/Android): bash ≥ 4.4 (raised from 4.0 in Stage 2.4: older bash 4.x treats empty arrays as unset under `set -u`), python3 ≥ 3.10, git ≥ 2.30, GNU tar, sha256sum (coreutils), mktemp, gh (GitHub CLI).
- The write gateway runs on Cloudflare Workers with a Durable Object (Stage 1.4); the read gateway runs on Cloudflare, operator-owned and single-tenant (decision 0001). Operators need accounts for those platforms; the consumer artifact has no runtime dependency on them beyond the links and the work-order contents.
- Network access is needed only for operations the operator chooses to perform; offline plan authoring and local verification remain possible.

**Acceptance matrix (supported environments):**
- Automated in CI: all artifact packaging/verification checks, plan_tool and ctxlink unit tests, update-flow tests, and any gateway conformance vectors that can run without live credentials.
- Manual operator verification required on both Linux and Termux/Android: end-to-end install/update of a consumer repository, Supervisor-Agent transfer of a sealed submission, and revocation/audit inspection.

### Explicit limitations of the first release

1. Task file contents in the write gateway are ephemeral by design (Stage 1.4.2); an isolate loss before commit loses staged, uncommitted files. Control-plane state (lease, seal/revocation, idempotency, quota metadata) is durable.
2. The write transport carries payloads in a GET query string. Caching, prefetch and intermediary or platform logging risks are accepted subject to the Stage 1.4 mitigations and are not eliminated.
3. The write gateway's GitHub credential is repository-scoped, not folder-scoped. Stage 1.4.6 (amended 2026-10-26) confines it to a dedicated submissions repository and branch, with the task folder created beforehand by the operator; the gateway never creates branches or folders. A leaked token could alter any task's submissions in that repository but not the private consumer repository. The documentation must not describe the credential as path-scoped.
4. A checksum sidecar proves integrity, not authenticity: it ships beside the artifact (register F0-017). Provenance is added in Stage 3.3.8; no cryptographic attestation is claimed unless generated and verified.
5. The object-storage export variant was rejected in Stage 1.3 and is not included.
6. The consumer artifact does not contain and must not instruct operators to use any endpoint that is not deployed. Documentation describes only capabilities that have passed acceptance (plan Stage 2.1.4/2.1.5).
7. Repository branch/tag protection, required checks and Actions hardening are not in place today (R0-004); they must be configured and evidenced before any tag (Stage 3.3.7).

## 1.1.2 Minimum successful workflow

The first release must support, and acceptance tests and the Phase 6 pilot must cover, this workflow end to end:

1. **Plan creation:** the operator creates or updates a plan under `plans/<plan_id>/` using the shipped schemas and `plan_tool.py`.
2. **Work order:** `plan_tool.py` produces a work order that binds exact file paths and immutable commit references.
3. **Context access:** a Class A agent fetches pinned private raw URLs with its own credential; a Class B agent fetches only the intended pinned files through the read gateway using signed links.
4. **Submission:** before issuing the work order the operator ensures the submissions branch and the task folder exist. A Class B agent submits deliverables through the write gateway into that folder (stage, replace/append, read back, commit, seal); a Class A agent or the operator may place deliverables directly in the task folder of the submissions branch. Quotas, single-writer and path rules apply as decided. Absolutely no submission is allowed outside of a valid submission branch / folder.
5. **Supervisor review and transfer:** the operator initiates a Supervisor Agent to inspect the committed deliverables in the submissions repository, runs local verification, transfers accepted files into the consumer repository, and records decisions via `plan_tool.py`. The transfer tooling is not yet designed (register R0-011); the high-level design is recorded in Stage 1.1.5.
6. **Publication / reconciliation:** the operator runs `cbridge publish` and `reconcile`. Publication is always an explicit operator action; neither the bridge nor either gateway publishes or merges.
7. **Revocation and audit:** the operator can revoke or close a work order, after which further reads and writes are denied, and can inspect redacted audit records that contain no capability secrets, signatures or payloads.
8. **Failure and recovery:** a lost response after a successful commit, an evicted staging session, an expired link and a revoked order each end in the documented outcome (Phase 6.3), never a silent duplicate or silent loss.
9. **Consumer update:** a later artifact installs or updates through `engine/bin/update.sh` without loss of consumer-owned plan data or seed configuration, and conflicts on locally modified managed files are reported without partial update.

## 1.1.3 Decision on deployed Class B read and write gateways

**Decision (operator, 2026-10-26; recorded in Stages 1.3 and 1.4):** the first release **requires** both the deployed Class B read gateway and the deployed write gateway, together with the shared conformance suite and a passing end-to-end staging pilot.

Consequences:

- The release target is **Acceptance Level B** (end-to-end system complete). Level A (artifact complete) is necessary but not sufficient.
- Version 0.5.0 stays unreleased until Phases 3–6 have passed their exit gates and Phase 7 authorization is given. Nothing is tagged or published earlier, and no document may describe the gateways as available before then.
- Nothing in the repository today satisfies this: the production read gateway is not implemented, the write gateway is a scaffold, conformance and the pilot are incomplete (register F0-003 to F0-006, F0-009). Those are closed by Phases 4, 5 and 6 respectively.

## 1.1.4 Finite meaning of "100 % working"

"100 % working" for 0.5.0 means every item below has an executed acceptance test whose output was inspected and recorded, every release-critical defect in the register is closed with evidence (or explicitly accepted by the operator with a stated residual risk), and the documentation describes only what passes. The phrase must not be used in release notes or the README unless this checklist is satisfied and recorded.

**Artifact and consumer path**

1. The artifact contains exactly the paths in `release/manifest.txt` taken from tracked files; the build is byte-identical across rebuilds and environments; ordinary and `--release` verification pass (F0-010 to F0-012, F0-016).
2. First install into an empty consumer repository yields a usable layout.
3. Update preserves consumer-owned files, never overwrites seed files, reports conflicts on modified managed files, and is all-or-nothing or recoverable (F0-013, F0-015).
4. `plan_tool.py` creates, orders, links, sets status, decides and verifies a plan; invalid input yields actionable errors; `plan_tool.py` and `ctxlink.py` agree on signing.
5. `cbridge` operator commands work against a private test repository without silent data loss.
6. No gateway, Worker, credential or forbidden path is in the artifact.

**Read gateway**

7. Only the single authorized file at the pinned reference can be fetched with plain HTTPS GET; adjacent files, traversal and encoding bypasses are refused.
8. The production gateway passes the same conformance vectors and tests as the Python signer and reference gateway.
9. Expiry, key rotation and revocation behave as decided (0003), within the documented bound; audit contains no secrets.

**Write gateway**

10. No 501 handler and no placeholder source, test, script or CI stub remains (register F0-009; Phase 5 exit gate).
11. Quotas (20 files, 245760 total bytes, 12288 bytes per file, 30 requests per 60 s, one writer) and path/type policy are enforced as published; cross-task reads and writes are denied.
12. Append and commit are idempotent; the same key with different content conflicts; ambiguous outcomes return reconcile-required; seal, work-order closure and revocation are distinct and irreversible as specified.
13. No root URL, signature, payload, token or raw query appears in logs, errors, metrics or traces (sentinel-secret tests); responses carry no-store headers.

**Release controls**

14. The Phase 6 staging pilot completes the workflow in 1.1.2 on a disposable repository and the record is preserved.
15. Branch and tag protection and required checks are configured and evidenced; the release workflow publishes only a verified artifact from a tag on an approved `main` commit (F0-008, F0-023, R0-004).
16. Release notes state known limitations plainly (1.1.1), and the operator gives explicit publication authorization.

## 1.1.5 Submissions-to-consumer transfer path (design)

High-level design decisions (implementation later assigned to Phase 2 or Phase 6 as appropriate):

- **Actor:** Supervisor Agent (operator-initiated Class A agent). The operator initiates the agent; the agent performs the transfer.
- **Pre-conditions:** submissions branch and task folder must already exist and contain a committed placeholder; work order must be sealed; expected tip SHA of the task folder must be supplied and must match before any transfer begins.
- **Conflict handling:** transfer fails closed if the expected SHA does not match the current tip; operator (via Supervisor Agent) must re-inspect and re-issue with the new SHA.
- **Validation:** only paths inside the sealed task folder are eligible; content must be valid UTF-8 text of allowed types; total size and file count must respect the published write-gateway quotas; each file must carry a matching SHA-256 recorded at seal time.
- **Failure recovery and audit:** on any validation or SHA mismatch the transfer aborts with no partial writes; a structured audit record (task-id, expected-SHA, actual-SHA, outcome, timestamp, operator identity) is written and retained under operator control.
- **Authority boundary:** limited to the sealed task folder in the submissions repository and the corresponding destination paths in the consumer repository; may not publish, revoke, or alter any other work order.

## Traceability to Phase 0

| Capability | Classification in this contract |
|------------|---------------------------------|
| Consumer package, checksum, artifact verification, install/update | REQUIRED |
| Operator-controlled plan/order/context-link tooling and `cbridge` workflow | REQUIRED |
| Production Class B read gateway | **REQUIRED** (Phase 4) |
| Agent-side write gateway | **REQUIRED** (Phase 5) |
| Shared conformance harness | **REQUIRED** (Phase 4.1) |
| Real end-to-end pilot | **REQUIRED** (Phase 6) |
| Remote revocation / audit | **REQUIRED** (Phases 4–5, verified in 6) |
| Object-storage variant | NOT INCLUDED (rejected in Stage 1.3) |
| Submissions-to-consumer transfer path | REQUIRED (design in 1.1.5; implementation later) |

## Next steps after approval

1. With Phase 1 closed, Phase 2 starts at Stage 2.1 (metadata and documentation, register F0-019), then 2.2–2.4.
2. Phases 4 and 5 may run on separate branches; integration and the pilot (Phase 6) are sequentially gated, as in the plan.
3. Implement the transfer path defined in 1.1.5 in the assigned later stage.

## Operator decisions recorded (2026-10-26 / 2026-10-27)

| Item | Recorded answer | Effect |
|---|---|---|
| Class A credential exception | Class A (including Supervisor Agent) is an intentional exception; operator supplies short-lived task-scoped token | Global rule clarified; Class B remains credential-free |
| Managed / seed metadata | managed `engine/release.json`; seed `engine/engine.json` (corrected 2026-10-28: the first merge of this row had the two roles transposed) | Naming collision resolved; `ENGINE.json` renamed to `release.json` |
| Transfer actor | Supervisor Agent (operator-initiated Class A) | Workflow step 5 updated |
| Contract status | APPROVED 2026-10-27 with listed amendments | Stage 1.1 exit criteria satisfied for design |

End of Stage 1.1 approved contract.
