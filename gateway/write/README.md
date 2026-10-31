# ctxgate: task-scoped write gateway (proposed)

A Cloudflare Worker with one Durable Object class that lets a **Class B agent** (one that can only make HTTPS GET
requests, no credentials) create, edit and deliver text files into a task-specific folder, using a single secret
root URL as both its identity and its scope. It is the write-side counterpart of the read gateway in `../ctxgate.py`.

**Status: scaffold only; required for 0.5.0 (Phase 5).** 46 of 48 source files and all 32 test files are stubs. The structure is exactly the one proposed in `docs/proposal/project-structure.md` (112 files,
generated from it). Real content so far: `wrangler.toml`, `package.json`, `tsconfig.json`, `src/config/quotas.json`,
`AGENTS.md` (section anchors + quotas), a Worker entry that answers `501`, and a `TaskSession` stub so the Durable
Object binding resolves. Everything else is a stub that says so in its first lines. The agent-facing tool prompt is
`docs/proposal/agent-tool-prompt.md`, kept verbatim.

**This module never ships in a release.** It lives under `gateway/`, which `release/manifest.txt` does not list and
`release/verify.sh` rejects. Extra deny rules for Worker files (`wrangler.toml`, `.dev.vars`, `cloudflare:workers`)
back that up.

## Invariants it must keep (from the tool prompt)

GET only, payload in the query string as base64url. Uncommitted state is ephemeral. One writer per task (`409`).
Commit pushes only the listed files and is idempotent. Seal freezes the folder (`410` afterwards). Revocation is
operator-only and not exposed. Quotas: 20 files, 240 KiB (245760 bytes) total, 12 KiB (12288 bytes) per file, 30 requests per 60 s, concurrency 1.

## Working on it

    cd gateway/write
    npm ci
    npm run typecheck      # tsc --noEmit over src, tests, scripts
    npm run check:bundle   # wrangler deploy --dry-run: validates wrangler.toml and bundles the Worker

## Decision status

The questions raised in the proposal are recorded in `docs/release/PHASE-1.4-WRITE-GATEWAY-DECISIONS.md` and the ADRs under `docs/adr/`.

| Question | Status |
|---|---|
| Token scope | Decided (Stage 1.4.6, amended): a dedicated, isolated submissions repository and branch; branch and task folder pre-created, never created by the gateway. The token is repository-scoped; folder confinement is enforced by this Worker's code. |
| Engine invariants | To do: `template/engine/AGENTS.md`, `template/docs/SECURITY.md` and the supervisor prompt still say the operator uploads submissions; update them when the gateway is adopted (Phases 5 and 6). |
| Name | Open: `ctxgate` also names the read gateway. |
| GET with side effects | Decided with mitigations (ADR 0003, Stage 1.4.4); residual risk accepted. |
| Units | Decided: binary KiB, bytes authoritative (Stage 1.4.8). `src/config/quotas.json` still carries the old note and is updated in Phase 5. |
| Test framework | Open: none installed; pinning a runner is Stage 5.5.1. All tests are `export {}` stubs. |
| Durable Object storage | Decided (ADR 0001, Stage 1.4.2): control-plane state durable, task file contents ephemeral. |
