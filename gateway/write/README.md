# ctxwrite: task-scoped write gateway (proposed)

A Cloudflare Worker with one Durable Object class that lets a **Class B agent** (one that can only make HTTPS GET
requests, no credentials) create, edit and deliver text files into a task-specific folder, using a single secret
root URL as both its identity and its scope. It is the write-side counterpart of the read gateway in `../ctxgate.py`.

**Status: the core request and session lifecycle (Stage 5.2), the GitHub delivery (Stage 5.3) and the audit,
privacy and operations (Stage 5.4) are implemented. Unsupported in 0.5.0 (Basic), planned for 0.6.0 Standard.** The protocol is `ctxwrite-v1`, specified in
[`docs/protocol.md`](docs/protocol.md) — the canonical, normative contract and the single authoritative definition
of the write protocol (plan rule G-11).

**What works now (Stage 5.3).** The Worker routes and authenticates; the Durable Object holds the session. The
capability is parsed and its signature verified before anything else happens; the session's writer lease,
sequence numbers, chunk hashes, idempotent replay, quota ledger, file inventory, tombstones, the type policy,
the path rules, the seal, the operator's revocation and closure, the hypermedia links, the redacted audit
record and the fail-closed environment validation are all implemented and tested. **The `commit` route delivers**:
it validates the selection, checks that the branch is still at the head the capability names, writes only the
selected files into the task folder, creates exactly one commit, and records it. **222 tests pass** against the
real Worker, the real Durable Object and the **real** provider client, driven against a mock GitHub that is an
actual HTTP server on loopback.

**What does not work yet.** The remaining chaos tests (the Durable Object eviction and the isolate eviction)
and the CI wiring are Stage 5.5. The gateway is **not deployed** — the deployment workflow exists and is
gated, but it has never been run — and it has never been run against the real GitHub, so nothing here may be
read as a claim that a write gateway is operational. The Phase 5 exit gate is therefore not met.

**The audit, the privacy and the operations (Stage 5.4).** The audit record is built field by field from a
fixed schema, and the **durable** copy of it — one instance per order, queryable at `/admin/audit` — is
rebuilt by the Durable Object that holds it, so a bug in the Worker cannot put a capability into the store.
The log-hygiene check plants a sentinel in every place a secret could be and drives the whole protocol with
them in place; the **same** driver backs the unit test and the deploy gate, so the two cannot drift apart.
The operator runbook is written: minting, monitoring, revoking, closing, resetting a quota, rotating each of
the three secrets, deploying, and four incident procedures. The deploy workflow is triggered by a push to
`main` or by hand, its credentials come from a protected environment, and the gate checks that no
pull-request-triggered workflow holds one.

**One property worth knowing before you use it.** A capability authorises **exactly one commit**: the commit's
parent is pinned to the head the capability was minted against, so the first commit moves the branch and a
second commit under the same capability finds a head that no longer matches (`409 expected-sha-conflict`). A
task that needs two commits needs two capabilities. Whether that is the intended workflow is an open question
in the Stage 5.3 closeout.

**This module never ships in a release.** It lives under `gateway/`, which `release/manifest.txt` does not list and
`release/verify.sh` rejects. Extra deny rules for Worker files (`wrangler.toml`, `.dev.vars`, `cloudflare:workers`)
back that up.

## The contract, in one page

| Document | What it is |
|---|---|
| [`docs/protocol.md`](docs/protocol.md) | **the protocol** (`ctxwrite-v1`): capability format, signature, routes, parameters, envelope, state machine, quotas, commit and seal, credential boundary, recovery. Normative. |
| [`docs/error-catalog.md`](docs/error-catalog.md) | every error code, its status, its retryability and what the client should do. Normative. |
| [`docs/quotas-and-type-policy.md`](docs/quotas-and-type-policy.md) | the published view of `src/config/quotas.json` and `src/config/type-policy.json`, which are the authorities. |
| [`docs/architecture.md`](docs/architecture.md) | the design: components, request flow, Durable Object coordination, module map. Not normative. |
| [`docs/security-checklist.md`](docs/security-checklist.md) | the contract's security requirements, collected, with the stage that checks each one. |
| [`docs/operator-runbook.md`](docs/operator-runbook.md) | the operator's procedures: mint, monitor, revoke, close, reset a quota, read the audit stream, rotate each of the three secrets, deploy, and four incident procedures. Written in Stage 5.4.4 and 5.4.5. The operational sign-off is Stage 6. |
| [`AGENTS.md`](AGENTS.md) | the agent-facing index and the stable section anchors. |
| [`docs/proposal/agent-tool-prompt.md`](docs/proposal/agent-tool-prompt.md) | the prompt handed to a Class B agent. A map, not the contract. |
| [`docs/adr/`](docs/adr/) | ADRs 0001–0004: the durable/ephemeral split, content handling, GET side effects, log hygiene. |

## Invariants it must keep (from the contract)

GET only, payload in the query string as base64url. The capability is authenticated in the **path**, so a
query-stripping proxy still works, and the capability never appears in a response body. The destination folder is
**derived** from the signed task ids and the configured template; no request may choose a repository, a branch or
a path. Uncommitted state is ephemeral, and the contract says exactly what is lost and what the agent does about
it. One writer per task (`409`). A commit pushes only the listed files, on the expected parent, and is idempotent
for one file list. Seal freezes the folder (`410` afterwards). Revocation is operator-only and not exposed.
Quotas: 20 files, 240 KiB (245760 bytes) total, 12 KiB (12288 bytes) per file, 30 requests per 60 s,
concurrency 1.

## Working on it

    cd gateway/write
    npm ci
    npm run typecheck      # tsc --noEmit over src, scripts, and the tests
    npm test               # the Node test runner, over the unit, integration and load suites
    npm run check:bundle   # wrangler deploy --dry-run: validates wrangler.toml and bundles the Worker

The test runner is Node 22's built-in one, with type stripping — the same runner the read gateway has used
since Stage 4.2. The tests drive the **real** Worker and the **real** Durable Object class over an in-memory
storage, so a test cannot pass against a re-implementation that has drifted from the shipped code.

## Decision status

The questions raised in the proposal are recorded in `docs/release/PHASE-1.4-WRITE-GATEWAY-DECISIONS.md` and the ADRs under `docs/adr/`.

| Question | Status |
|---|---|
| Token scope | Decided (Stage 1.4.6, amended): a dedicated, isolated submissions repository and branch; branch and task folder pre-created, never created by the gateway. The token is repository-scoped; folder confinement is enforced by this Worker's code. The boundary, the placeholder-file handling and the residual risk are now written down (`docs/protocol.md` section 12). |
| Engine invariants | To do: `template/engine/AGENTS.md`, `template/docs/SECURITY.md` and the supervisor prompt still say the operator uploads submissions; update them when the gateway is adopted (Phases 5 and 6). |
| Name | Open: `ctxgate` also names the read gateway. The protocol version is `ctxwrite-v1` and does not depend on the gateway's name. |
| GET with side effects | Decided with mitigations (ADR 0003, Stage 1.4.4); residual risk accepted, and the accepted risk is now stated in the contract rather than only in the ADR (`docs/protocol.md` section 10). |
| Units | Decided: binary KiB, bytes authoritative (Stage 1.4.8). `src/config/quotas.json` no longer carries the "KB undefined" note; it was updated in Stage 5.1. |
| Test framework | **Decided by Stage 5.2**: Node 22's built-in runner with type stripping, the same one the read gateway has used since Stage 4.2. No new dependency. |
| Durable Object storage | Decided (ADR 0001, Stage 1.4.2): control-plane state durable, task file contents ephemeral. The recovery model that follows from it is in `docs/protocol.md` section 13. |
| Protocol contract | **Closed by Stage 5.1**: `ctxwrite-v1` in `docs/protocol.md`, with the error catalogue, the published quota and type policy, and the stable agent-facing anchors. |
| Core request and session lifecycle | **Closed by Stage 5.2**: routing, signature verification, the writer lease, sequencing and replay, quotas, the type policy, staging, the seal, revocation and closure, hypermedia, the audit record. |
| GitHub commit and delivery | **Closed by Stage 5.3**: a fixed-destination client, the selection rules, the commit idempotency, the provider's failure modes, the expected-SHA precondition, the audit metadata, and the seal's precondition. The provider is exercised against a real HTTP server, and the client has no method that could reach anywhere but the configured repository and branch. |
| One commit per capability | **Open**: a consequence of the expected-SHA precondition, not a separate rule. The operator decides whether the workflow should be one commit per capability, or a fresh capability per commit. Recorded in the Stage 5.3 closeout. |
| The commit's author identity | **Open**: the gateway signs as itself, by default `build-engine write gateway <ctxwrite@users.noreply.github.com>`, and `GITHUB_COMMIT_AUTHOR` changes it. The operator may want a different identity. |
| The provider's error codes | **Decided by Stage 5.3**: `provider-rate-limited`, `provider-unavailable`, `provider-rejected` and `provider-credential-invalid`, in the error catalogue and in the code table. `provider-rate-limited` is the provider's limit on the gateway, and is a different code from `rate-limited`, which is the gateway's limit on the agent. |
| Submissions-to-consumer transfer | Undefined (register R0-011). The transfer path and the pre-creation tooling are not in the plan; the operator decision is open. |
