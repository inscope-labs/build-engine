# ctxwrite: task-scoped write gateway (proposed)

A Cloudflare Worker with one Durable Object class that lets a **Class B agent** (one that can only make HTTPS GET
requests, no credentials) create, edit and deliver text files into a task-specific folder, using a single secret
root URL as both its identity and its scope. It is the write-side counterpart of the read gateway in `../ctxgate.py`.

**Status: contract specified, implementation still a scaffold; unsupported in 0.5.0 (Basic), planned for 0.6.0 Standard.** The protocol is
specified as `ctxwrite-v1` in [`docs/protocol.md`](docs/protocol.md) — the canonical, normative contract, and the
single authoritative definition of the write protocol (plan rule G-11). 46 of 48 source files and all 32 test
files are still stubs, and the Worker still answers `501` to every request. The structure is exactly the one
proposed in `docs/proposal/project-structure.md` (112 files, generated from it). Real content now:
`wrangler.toml`, `package.json`, `tsconfig.json`, `src/config/quotas.json` (units decided and note removed),
`src/config/type-policy.json` (the type allow-list), `docs/protocol.md`, `docs/error-catalog.md`,
`docs/quotas-and-type-policy.md`, `docs/architecture.md`, `docs/security-checklist.md`, `AGENTS.md` (the agent
index and the stable section anchors), the agent-facing tool prompt `docs/proposal/agent-tool-prompt.md`, and a
Worker entry that answers `501` with a `TaskSession` stub so the Durable Object binding resolves. Everything
else in `src/` and `tests/` is a stub that says so in its first lines.

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
| [`docs/operator-runbook.md`](docs/operator-runbook.md) | what Stage 5.1 specified; the procedures themselves are Stage 5.4.4 and the sign-off is Stage 6. |
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
    npm run typecheck      # tsc --noEmit over src, tests, scripts
    npm run check:bundle   # wrangler deploy --dry-run: validates wrangler.toml and bundles the Worker

## Decision status

The questions raised in the proposal are recorded in `docs/release/PHASE-1.4-WRITE-GATEWAY-DECISIONS.md` and the ADRs under `docs/adr/`.

| Question | Status |
|---|---|
| Token scope | Decided (Stage 1.4.6, amended): a dedicated, isolated submissions repository and branch; branch and task folder pre-created, never created by the gateway. The token is repository-scoped; folder confinement is enforced by this Worker's code. The boundary, the placeholder-file handling and the residual risk are now written down (`docs/protocol.md` section 12). |
| Engine invariants | To do: `template/engine/AGENTS.md`, `template/docs/SECURITY.md` and the supervisor prompt still say the operator uploads submissions; update them when the gateway is adopted (Phases 5 and 6). |
| Name | Open: `ctxgate` also names the read gateway. The protocol version is `ctxwrite-v1` and does not depend on the gateway's name. |
| GET with side effects | Decided with mitigations (ADR 0003, Stage 1.4.4); residual risk accepted, and the accepted risk is now stated in the contract rather than only in the ADR (`docs/protocol.md` section 10). |
| Units | Decided: binary KiB, bytes authoritative (Stage 1.4.8). `src/config/quotas.json` no longer carries the "KB undefined" note; it was updated in Stage 5.1. |
| Test framework | Open: none installed; pinning a runner is Stage 5.5.1. All tests are `export {}` stubs. |
| Durable Object storage | Decided (ADR 0001, Stage 1.4.2): control-plane state durable, task file contents ephemeral. The recovery model that follows from it is in `docs/protocol.md` section 13. |
| Protocol contract | **Closed by Stage 5.1**: `ctxwrite-v1` in `docs/protocol.md`, with the error catalogue, the published quota and type policy, and the stable agent-facing anchors. |
| Submissions-to-consumer transfer | Undefined (register R0-011). The transfer path and the pre-creation tooling are not in the plan; the operator decision is open. |
