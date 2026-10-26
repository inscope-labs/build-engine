# ctxgate: task-scoped write gateway (proposed)

A Cloudflare Worker with one Durable Object class that lets a **Class B agent** (one that can only make HTTPS GET
requests, no credentials) create, edit and deliver text files into a task-specific folder, using a single secret
root URL as both its identity and its scope. It is the write-side counterpart of the read gateway in `../ctxgate.py`.

**Status: scaffold only.** The structure is exactly the one proposed in `docs/proposal/project-structure.md` (112 files,
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
operator-only and not exposed. Quotas: 20 files, 240 KB total, 12 KB per file, 30 requests per 60 s, concurrency 1.

## Working on it

    cd gateway/write
    npm ci
    npm run typecheck      # tsc --noEmit over src, tests, scripts
    npm run check:bundle   # wrangler deploy --dry-run: validates wrangler.toml and bundles the Worker

## Open questions (decide before implementing)

1. **Token scope.** The commit step needs a GitHub credential that can write to the private repository. GitHub
   fine-grained tokens are scoped by repository and permission, not by folder, so "path-scoped" has to be enforced by
   this Worker's own code (`policy/path-safety.ts`, `scripts/check-token-scope.ts`) and a leaked token could write
   anywhere in that repository. Consider a dedicated submissions repository or branch, so the blast radius is only the
   submissions.
2. **Engine invariants.** `template/engine/AGENTS.md` says workers hold no credential and the operator uploads
   submissions (`cbridge upload`). This module changes that for Class B agents: the gateway writes submissions itself.
   The invariant text, `docs/SECURITY.md` and the supervisor prompt need to be updated when it is adopted.
3. **Name.** `ctxgate` already names the read gateway (`../ctxgate.py`, link scheme `ctxgate-v1`). Same family, two
   programs; decide whether the write gateway keeps the name.
4. **GET with side effects** (`docs/adr/0003-get-only-side-effects.md`): GET is cacheable, prefetchable and logged by
   intermediaries; payload in the query string lands in access logs. ADR 0003 and 0004 (log hygiene) must settle this.
5. **Units.** "240 KB" and "12 KB" are not defined in the proposal; `quotas.json` assumes 1024 bytes per KB.
6. **Test framework.** None is installed yet: the proposal names a "Miniflare / worker-test harness" but not a runner, and the
   latest vitest failed to install under npm 10 (a resolver error), so no runner was pinned. Tests are `export {}` stubs.
7. **Durable Object storage.** `wrangler.toml` assumes a SQLite-backed class; ADR 0001 should confirm.
