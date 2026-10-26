# Build Engine — Phase 1.1 First-Release Product Contract

- Repository: https://github.com/inscope-labs/build-engine
- Branch: phase-1/product-contract
- Baseline: main @ 8ca5769ad0f8f316539932c0711c71a7cff1f93b
- Version under consideration: 0.5.0
- Date: 2026-10-26
- Status: **DRAFT — submitted for operator review and approval**

This document satisfies Stage 1.1 of RELEASE-PLAN.md. It defines the product contract for the first release so that subsequent implementation, testing, and documentation remain internally consistent. No implementation or metadata changes are authorised by this document until the operator approves the contract (or records required amendments).

## 1.1.1 Supported users, Class A / Class B behaviour, consumer repository shape, operating environments, and explicit limitations

### Supported users

| Role | Description | Credential model |
|------|-------------|------------------|
| Operator | Human who owns the plan, mints work orders and context links, reviews deliverables, publishes, reconciles, and controls revocation/audit. | Operator-controlled GitHub credentials (or equivalent) with write access to the private consumer repository and, where publishing occurs, the public upstream. |
| Class A agent | Authenticated agent that can read private raw URLs or clone private repositories using its own credentials. | Agent-held fine-grained or classic PAT / deploy key scoped to the private consumer repository (or narrower). No Build Engine gateway credential is issued to the agent. |
| Class B agent | Unprivileged agent that must not hold repository credentials. Context is obtained only through short-lived, signed, path-scoped links served by a read gateway. | No long-lived repository credential. Access is limited to the links presented in the work order. |

The first release ships tooling and documentation that support the Operator and Class A paths. Class B support is limited to the client-side link-minting and verification libraries; a production Class B read path is not included in the supported release scope (see 1.1.3).

### Class A / Class B behaviour (first-release contract)

- **Class A**: An operator may embed private raw GitHub (or equivalent) URLs, pinned to a commit SHA, inside a work order. The Class A agent uses its own credentials to fetch those URLs. No gateway mediation is required or claimed. Decision 0005 remains open only for any additional Class A conveniences; the basic raw-URL path is already usable.
- **Class B**: Client-side minting (`ctxlink.py` / `plan_tool.py links`) and the reference read-gateway implementation exist and are tested. The production read gateway and any remote revocation/audit channel are **not** part of the supported first-release surface. Operators must not instruct Class B agents to rely on a deployed production gateway until that capability is explicitly added to a later release contract.

### Supported consumer repository shape

A consumer repository that has received the release artifact via `engine/bin/update.sh` (or first-install equivalent) is expected to contain, at minimum:

- `engine/` — managed files from the artifact (VERSION, ENGINE.json, tools, schemas, prompts, templates, bin/update.sh, AGENTS.md).
- `operator/` — managed operator bridge (`cbridge` and supporting files).
- `docs/` — managed operational documentation shipped with the artifact.
- `plans/` — consumer-owned plan data (seeded once; never overwritten by ordinary updates).
- `.build-engine.lock` — lock file maintained by the updater.

The consumer may hold additional private content (source, tests, configuration) outside the managed paths. The updater treats only the paths declared in the release manifest as managed or seed; all other files are left untouched.

### Supported operating environments

- POSIX shell environment with `bash`, `python3` (≥ 3.10 recommended), `git`, and common utilities (`tar`, `sha256sum` / `shasum`, `mktemp`, etc.).
- Linux and macOS are the primary targets; other POSIX systems are expected to work if the above tools are present.
- Network access is required only for the operations the operator chooses to perform (GitHub API calls via `cbridge`, package download, etc.). Offline plan authoring and local verification remain possible.
- No container, Kubernetes, or cloud-runtime dependency is required for the shipped consumer artifact.

### Explicit limitations (first release)

1. Production Class B read gateway is not deployed and is not claimed operational.
2. Write gateway (agent-side submission) returns HTTP 501 and is scaffold-only; it is out of scope.
3. Shared conformance harness and complete signing-vector set are incomplete; cross-implementation conformance claims are not made.
4. Real end-to-end pilot has not been executed; claims of complete end-to-end readiness are not made.
5. Abstract compatibility identifier (`implements_abstract`) remains to be decided in Stage 1.2; the release gate will remain blocked until that decision is recorded and metadata synchronised.
6. Repository branch/tag protection and Actions hardening are recorded as gaps (R0-004) and are not yet enforced; they are deferred to later hardening work unless the operator elevates them.
7. Object-storage export variant is design-only and future work.
8. The shipped documentation may still contain residual Castiel-specific prose; a full neutralisation pass is part of Stage 1.2 / 2.1 if the product-neutral path is chosen.

## 1.1.2 Minimum successful workflow

The minimum successful workflow that the first release must support (and that acceptance tests must cover) is the **operator-controlled, Class A path**:

1. **Plan creation** — Operator creates or updates a plan under `plans/<plan_id>/` using the shipped schemas and `plan_tool.py`.
2. **Work-order generation** — Operator runs `plan_tool.py order` (or equivalent) to produce a work order that binds exact file paths and immutable commit references.
3. **Context access (Class A)** — Work order contains private raw URLs pinned to commits. Class A agent fetches them with its own credentials.
4. **Submission** — Agent (or operator) places deliverables into the designated submission location. Operator uses `cbridge upload` to stage them into the private consumer repository.
5. **Operator review** — Operator inspects the staged deliverables, runs any local verification, and records decisions via `plan_tool.py decide` / coverage tools as required.
6. **Publication / reconciliation** — Operator runs `cbridge publish` (and `reconcile` if needed) to open or update the upstream pull request / branch. Publication is an explicit operator action; the bridge never publishes autonomously.
7. **Revocation / audit (local / reference only)** — For the reference read gateway, revoke and audit commands exist. Remote production revocation is out of scope for this release.
8. **Consumer update** — A later release artifact can be installed or applied via `engine/bin/update.sh` without loss of consumer-owned plan data or seed configuration, subject to the conflict rules already implemented and tested.

The Class B path (signed links → production read gateway → agent fetch → write-gateway submission) is **not** part of the minimum successful workflow for the first release.

## 1.1.3 Decision on deployed Class B read and write gateways

**Decision (proposed):** The first release does **not** require deployed Class B read or write gateways.

Rationale (aligned with the Phase 0 proposed classification and the two acceptance levels in RELEASE-PLAN.md):

- Level A (RELEASE ARTIFACT COMPLETE) can be achieved with the existing packaged tooling, operator bridge, install/update path, and Class A context access.
- Level B (END-TO-END SYSTEM COMPLETE) requires the production gateways, conformance harness, pilot, and remote revocation/audit. Those remain future work.
- Claiming “complete end-to-end functionality” without the gateways would be false. Therefore the first release will explicitly label the production Class B read path and the write gateway as **not included / not operational**.

If the operator later decides that a Level-B claim is required for the 0.5.0 tag, the release target must be deferred until Phase 4–6 complete. The default under this contract is the narrower, honest Level-A release.

## 1.1.4 Finite meaning of “100 % working”

For the first release, “100 % working” means that every capability listed below has a corresponding acceptance test (or set of tests) that has been executed and whose output has been inspected, and that the documentation accurately describes only those capabilities:

1. The release artifact packages exactly the paths in `release/manifest.txt`, produces a deterministic tarball and checksum, and passes ordinary `release/verify.sh`.
2. First install into an empty consumer repository succeeds and yields a usable layout.
3. Update from a previous supported artifact (or simulated prior state) preserves consumer-owned files, respects seed files, and surfaces conflicts on modified managed files.
4. `plan_tool.py` can create, order, link (Class A raw URLs), set status, decide, and verify a plan against the shipped schemas without error under valid inputs; invalid inputs produce actionable failures.
5. `cbridge` supports the documented operator commands (init, bootstrap, doctor, sync, upload, publish, reconcile, halt/resume) against a private test repository without silent data loss.
6. No gateway, Worker, credential, or forbidden path appears in the packaged artifact (verified by `release/verify.sh` and the self-test).
7. Documentation shipped in the artifact does not instruct the operator to rely on undeployed production gateways or claim capabilities that fail their acceptance tests.

Any capability not listed above is either explicitly out of scope for 0.5.0 or is future work. The phrase “100 % working” must not be used in release notes, README, or marketing text unless the above checklist has been satisfied and recorded.

## Traceability to Phase 0

This contract adopts the Phase 0 proposed classification:

| Capability | Classification in this contract |
|------------|---------------------------------|
| Consumer package, checksum, artifact verification, install/update | REQUIRED FOR FIRST RELEASE |
| Operator-controlled plan/order/context-link tooling and `cbridge` workflow | REQUIRED FOR FIRST RELEASE (Class A path) |
| Production Class B read gateway | EXPLICITLY OUT OF SCOPE for first release |
| Agent-side write gateway | EXPLICITLY OUT OF SCOPE for first release |
| Shared conformance harness | EXPLICITLY OUT OF SCOPE for first release (required only before conformance claims) |
| Real end-to-end pilot | EXPLICITLY OUT OF SCOPE for first release (required only before Level-B claims) |
| Object-storage variant | FUTURE WORK |

## Next steps after approval

1. Operator approves this contract or returns required changes.
2. Stage 1.2 resolves the abstract-compatibility identifier and synchronises VERSION / ENGINE.json / COMPATIBILITY.md / CHANGELOG preparation.
3. Stages 1.3–1.4 close or explicitly defer the remaining architecture decisions that affect later phases.
4. Only after the Phase 1 exit gate is satisfied may Phase 2 implementation begin.

## Unresolved questions for the operator

- Confirm or amend the Level-A / Level-B boundary above.
- Confirm the supported operating environments (any additional platforms or minimum tool versions?).
- Confirm that residual Castiel-specific prose is acceptable for the first release provided machine-readable metadata is corrected in Stage 1.2, or whether a full prose neutralisation is required before tagging.
- Any additional acceptance criteria that should be added to the finite “100 % working” checklist?

---
End of Stage 1.1 draft.