# gateway/read/production

The deployable read gateway. **Structure and plan only; not started.** The platform is decided (Cloudflare Workers, decision 0001), but no runtime code exists yet. The work follows the production path in `template/docs/CONTEXT-EXPORT.md` (section 11):

| Step | What | Lives in | Done when |
|---|---|---|---|
| 1 | Decide where the gateway runs | `docs/decisions/0001`, `0002` | done: Cloudflare, operator-owned; host named in the work order |
| 2 | Source adapter: read one file at a pinned commit from the private repo | `source-adapter/` | passes `conformance/` against a scratch private repo |
| 3 | Port the ten gateway rules to the chosen runtime | `rules/` | reproduces the signing vectors, passes `conformance/` |
| 4 | Rate limiting, alerting on repeated refusals, log retention | `ops/` | documented limits; an alert fires in a test |
| 5 | Pilot: one real task, one Class B agent, including revoke and audit | `docs/pilot/` | task submitted; audit shows only expected reads |

Configuration surface the gateway needs (from the design): signing keys per key id, allowed path prefixes, deny
patterns, `max_bytes` (1 MB proposed), `max_ttl` (72 hours, decision 0003), an audit log, a revocation list, and a read-only,
single-repository, short-lived repository credential kept as a secret.

Add the Worker as a subdirectory here (for example `worker/`) with its own README. The write gateway (`../../write`) is
also a Cloudflare Worker, but the two are separate deployments.
