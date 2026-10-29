# Build Engine — Phase 1.1 First-Release Product Contract (APPROVED; Basic redesignation 2026-10-29)

- Repository: https://github.com/inscope-labs/build-engine
- Revises: the Stage 1.1 draft merged in PR #2 (baseline `8ca5769`); this document as approved 2026-10-27
- Audited against: `main` @ `28b04aa19fe385767d8cd6870d5d8199719debba` (post Stage 3.2 merge)
- Version under consideration: 0.5.0
- Original date: 2026-10-26
- Status: **APPROVED (Basic redesignation)**
- Approval history:
  - Approved by developer on 2026-10-27 with the amendments listed in the Stage 1.1 compliance closure.
  - **Redesignated 2026-10-29 by operator decision (D1):** 0.5.0 is published as **Basic, Class A-only**. Deployed Class B read and write gateways are **not required** for 0.5.0 and are deferred to **0.6.0 Standard**. Decisions 0001–0005 (read) and 0001–0004 (write) remain the basis for Standard; they are not reopened.

This document defines the product contract for the first release. The 2026-10-26/27 decision that both gateways were mandatory for 0.5.0 is **reversed** by the redesignation recorded in §1.1.3 below. Class B implementation work continues on unmerged branches and is targeted at 0.6.0; it is not discarded.

Where a decision is already recorded elsewhere it is referenced, not restated, so there is one authoritative definition (plan rule G-11): read-gateway decisions in `docs/decisions/0001`–`0005` and `PHASE-1.3-READ-GATEWAY-DECISIONS.md`; write-gateway decisions in `gateway/write/docs/adr/0001`–`0004` and `PHASE-1.4-WRITE-GATEWAY-DECISIONS.md`; compatibility in `PHASE-1.2-COMPATIBILITY.md`.

## 1.1.1 Users, Class A / Class B behaviour, consumer repository, environments, limitations

### Supported users

| Role | Description | Credential model |
|------|-------------|------------------|
| Operator | Human who owns the plan, mints work orders and context links, reviews deliverables, publishes, reconciles, and controls revocation and audit. | Operator-held repository credentials. Only the operator publishes. |
| Class A agent | Authenticated agent that can read private raw URLs or clone the private repository with its own credentials. Includes the Supervisor Agent (operator-initiated). | Agent-held credential scoped to the private consumer repository or the sealed task folder in the submissions repository (task-scoped). The operator supplies a short-lived token secret during the work-order / transfer request process; the token must cover the task scope exactly. Decision 0005 keeps this as a separate trust path; it does not use the gateways and must not weaken Class B controls. Standard audit practices apply. |
| Class B agent | Unprivileged agent that must not hold any repository credential and can only issue HTTPS GET. | None. Reads context only through short-lived, signed, path-scoped links served by the read gateway, and submits deliverables only through the task-scoped write gateway. **Not supported in 0.5.0 Basic.** |

### Class A / Class B behaviour (0.5.0 Basic contract)

- **Class A (supported in 0.5.0):** the operator embeds raw URLs pinned to a commit in the work order; the agent fetches them with its own credential. No gateway mediation. The Supervisor Agent is an operator-initiated Class A agent whose authority is limited to the sealed task folder in the submissions repository and the corresponding destination paths in the consumer repository; it may not publish, revoke, or alter any other work order. Operator-side `cbridge upload` is the documented delivery route for Class A (subject to R0-011 resolution).
- **Class B read (unsupported in 0.5.0; planned for 0.6.0 Standard):** a work order carries signed, expiring, path-scoped links (minted by `plan_tool.py links` / `ctxlink.py`). The production read gateway returns exactly the one authorized file at the pinned reference and nothing else. Decisions 0001–0004 stand; implementation and deployment are deferred.
- **Class B write (unsupported in 0.5.0; planned for 0.6.0 Standard):** the agent submits through the task-scoped write gateway. Decisions 0001–0004 (write) stand; implementation landing, deployment, pilot and residual risks (R0-005, R0-007) remain open for Standard.

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
- Required tools (minimum versions for both Linux and Termux/Android): bash ≥ 4.4, python3 ≥ 3.10, git ≥ 2.30, GNU tar, sha256sum (coreutils), mktemp, gh (GitHub CLI).
- The write and read gateways (when deployed for 0.6.0) run on Cloudflare; the consumer artifact has no runtime dependency on them beyond links and work-order contents.
- Network access is needed only for operations the operator chooses to perform; offline plan authoring and local verification remain possible.

**Acceptance matrix (supported environments for Basic):**
- Automated in CI: all artifact packaging/verification checks, plan_tool and ctxlink unit tests, update-flow tests.
- Manual operator verification required on both Linux and Termux/Android: end-to-end install/update of a consumer repository and Class A workflow (plan → order with raw pinned URLs → operator review and publication → consumer update).

### Explicit limitations of the 0.5.0 Basic release

1. **No deployed read gateway.** Class B agents cannot obtain context through signed links in this release. Shipped consumer documentation already states this.
2. **No deployed write gateway.** Agent-side submission through the write path is unsupported. Operator-side `cbridge upload` is the Class A delivery route.
3. **No remote revocation / audit channel** for gateway-served links (none are served).
4. **No end-to-end Class B pilot.** The Phase 6 pilot is deferred to 0.6.0.
5. Submissions-to-consumer transfer path (R0-011) remains a design gap for any path that depends on it; for pure Class A operator-side upload it may be deferred.
6. macOS is not a supported target (F0-014).
7. Checksum proves integrity, not authenticity (F0-017); document and accept for Basic.

Class B residual risks (R0-005 GET-mutation semantics, R0-007 ephemeral staging / ambiguous retry, credential scope, audit leakage) remain **open blockers for 0.6.0 Standard**. They are not closed by this redesignation.

## 1.1.2 Minimum successful Class A workflow (0.5.0 Basic)

The minimum successful workflow that 0.5.0 must support end-to-end:

1. **Plan creation** — operator creates a plan with stages and tasks via `plan_tool.py`.
2. **Work order** — operator issues a work order with raw URLs pinned to a commit (Class A).
3. **Agent execution** — Class A agent fetches context with its own short-lived task-scoped credential and produces deliverables.
4. **Operator review and delivery** — operator receives deliverables (via `cbridge upload` or equivalent documented Class A path), reviews, and publishes upstream.
5. **Consumer update** — a later artifact installs or updates through `engine/bin/update.sh` without loss of consumer-owned plan data or seed configuration; conflicts on locally modified managed files are reported without partial update.

## 1.1.3 Decision on deployed Class B read and write gateways

**Original decision (operator, 2026-10-26; recorded in Stages 1.3 and 1.4):** the first release required both the deployed Class B read gateway and the deployed write gateway, together with the shared conformance suite and a passing end-to-end staging pilot.

**Redesignation (operator, 2026-10-29 — Decision D1):**

> 0.5.0 is published as **Basic, Class A-only**. Deployed Class B read and write gateways are **not required** for 0.5.0. They are deferred to **0.6.0 Standard**. The Stage 1.3 and 1.4 decisions themselves stand as the basis for Standard; they are not reopened. Implementation work that exists on unmerged branches is to be landed, not discarded; only deployment, the pilot, and the submissions-transfer path are deferred.

Consequences:

- The release target for 0.5.0 is **Acceptance Level A** (artifact complete + Class A workflow). Level B (end-to-end Class B system complete) is the target for 0.6.0 Standard.
- Version 0.5.0 may be tagged and published once Basic exit gates pass (packaging, independent static verification, install/update, Class A workflow, documentation alignment, governance). Gateway deployment and the Class B pilot are not gates for 0.5.0.
- Shipped consumer documentation already disclaims the gateway. Maintainer-facing docs (`README.md`, `docs/STATUS.md`, `docs/END-TO-END.md`) and this contract must agree that gateways are unsupported in 0.5.0 and planned for 0.6.0.
- Class B code on branches (`phase-4/*`, `phase-5/*`) is not discarded. Landing it into `main` may proceed in parallel with 0.5.0 publication; deployment remains an operator decision for 0.6.0.

## 1.1.4 Finite meaning of "100 % working" (Basic)

"100 % working" for 0.5.0 Basic means every item below has an executed acceptance test whose output was inspected and recorded, every Basic release-critical defect in the register is closed with evidence (or explicitly accepted by the operator with a stated residual risk), and the documentation describes only what passes. The phrase must not be used in release notes or the README unless this checklist is satisfied and recorded.

**Artifact and consumer path (required for Basic)**

1. The artifact contains exactly the paths in `release/manifest.txt` taken from tracked files; the build is byte-identical across rebuilds and environments; ordinary and `--release` verification pass (F0-010, F0-016 closed by Stage 3.2).
2. First install into an empty consumer repository yields a usable layout.
3. Update preserves consumer-owned files, never overwrites seed files, reports conflicts on modified managed files, and is all-or-nothing or recoverable.
4. `plan_tool.py` creates, orders, links, sets status, decides and verifies a plan; invalid input yields actionable errors; `plan_tool.py` and `ctxlink.py` agree on signing.
5. `cbridge` operator commands work against a private test repository without silent data loss.
6. No gateway, Worker, credential or forbidden path is in the artifact.

**Class A workflow (required for Basic)**

7. Plan → work order with raw pinned URLs → Class A agent fetch → operator review → publication → consumer update completes without data loss.
8. Operator-side delivery route is documented (R0-011 resolved for Class A or explicitly deferred with rationale).

**Release controls (required for Basic)**

9. Branch and tag protection and required checks are configured and evidenced; the release workflow publishes only a verified artifact from a tag on the tip of an approved `main` commit (F0-023, R0-004).
10. Release notes state **"Basic — Class A only"**, supported environments, installation/update instructions, and known limitations plainly. The operator gives explicit publication authorization (G-12).

**Explicitly not required for Basic (required for 0.6.0 Standard)**

- Deployed production read gateway and conformance against a live deployment.
- Deployed write gateway, agent-side submission, remote revocation/audit.
- End-to-end Class B pilot.
- Resolution of R0-005, R0-007 and remaining Standard blockers.

## 1.1.5 Submissions-to-consumer transfer path (design)

High-level design decisions (implementation later assigned as appropriate; for Basic, operator-side `cbridge upload` is the documented route unless R0-011 is resolved otherwise):

- **Actor:** Supervisor Agent (operator-initiated Class A agent). The operator initiates the agent; the agent performs the transfer.
- **Pre-conditions:** submissions branch and task folder must already exist and contain a committed placeholder; work order must be sealed; expected tip SHA of the task folder must be supplied and must match before any transfer begins.
- **Conflict handling:** transfer fails closed if the expected SHA does not match the current tip; operator (via Supervisor Agent) must re-inspect and re-issue with the new SHA.
- **Validation:** only paths inside the sealed task folder are eligible; content must be valid UTF-8 text of allowed types; total size and file count must respect published quotas where applicable; each file must carry a matching SHA-256 recorded at seal time.
- **Failure recovery and audit:** on any validation or SHA mismatch the transfer aborts with no partial writes; a structured audit record is written and retained under operator control.
- **Authority boundary:** limited to the sealed task folder in the submissions repository and the corresponding destination paths in the consumer repository; may not publish, revoke, or alter any other work order.

## Traceability to Phase 0 / scope classification

| Capability | 0.5.0 Basic | 0.6.0 Standard |
|------------|-------------|----------------|
| Consumer package, checksum, artifact verification, install/update | **REQUIRED** | Required |
| Operator-controlled plan/order tooling and `cbridge` workflow | **REQUIRED** | Required |
| Independent verification (static, non-executing) | **REQUIRED** | Required |
| Class A workflow end-to-end | **REQUIRED** | Required |
| Operator-side `cbridge upload` delivery | **REQUIRED** if R0-011 resolved for Class A | Required |
| Production Class B read gateway (deployed) | **UNSUPPORTED** | Required |
| Agent-side write gateway (deployed) | **UNSUPPORTED** | Required |
| Shared conformance harness against a live deployment | **UNSUPPORTED** | Required |
| Real end-to-end Class B pilot | **UNSUPPORTED** | Required |
| Remote revocation / audit | **UNSUPPORTED** | Required |
| Submissions-to-consumer transfer path (R0-011) | Deferred unless Class A depends on it | Required |
| GET-mutation semantics (R0-005), ephemeral staging (R0-007) | n/a | **Open blockers** |
| Object-storage variant | NOT INCLUDED (rejected in Stage 1.3) | NOT INCLUDED |

## Operator decisions recorded

| Item | Date | Recorded answer | Effect |
|---|---|---|---|
| Class A credential exception | 2026-10-26/27 | Class A (including Supervisor Agent) is an intentional exception; operator supplies short-lived task-scoped token | Global rule clarified; Class B remains credential-free |
| Managed / seed metadata | 2026-10-27 (corrected 2026-10-28) | managed `engine/release.json`; seed `engine/engine.json` | Naming collision resolved |
| Transfer actor | 2026-10-26/27 | Supervisor Agent (operator-initiated Class A) | Workflow design |
| Contract status (original) | 2026-10-27 | APPROVED with listed amendments | Stage 1.1 exit criteria satisfied for design |
| **Basic redesignation (D1)** | **2026-10-29** | **0.5.0 is Basic, Class A-only; deployed gateways not required; deferred to 0.6.0 Standard** | **Reverses the 2026-10-26 mandatory-gateway requirement for 0.5.0; Stage 1.3/1.4 decisions stand for Standard** |

## Next steps after redesignation

1. Close remaining Basic defects (F0-002 dated changelog at RC time, F0-023 release workflow, R0-004 repository protection, documentation alignment, R0-011 for Class A).
2. Publish 0.5.0 Basic when Basic exit gates pass and the operator authorises the tag (G-12).
3. Land Class B branches into `main` in parallel (do not discard the work); deploy, rehearse and pilot under the 0.6.0 Standard contract.
4. Keep R0-005, R0-007 and related Class B risks open as Standard blockers.

End of Stage 1.1 product contract (Basic redesignation 2026-10-29).
