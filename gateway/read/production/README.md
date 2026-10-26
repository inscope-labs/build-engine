# gateway/read/production

The deployable read gateway. **Structure and plan only: no runtime is chosen**, so there is deliberately no language or
platform directory yet. The work follows the production path in `template/docs/CONTEXT-EXPORT.md` (section 11):

| Step | What | Lives in | Done when |
|---|---|---|---|
| 1 | Decide where the gateway runs | `docs/decisions/0001`, `0002` | hosting chosen |
| 2 | Source adapter: read one file at a pinned commit from the private repo | `source-adapter/` | passes `conformance/` against a scratch private repo |
| 3 | Port the ten gateway rules to the chosen runtime | `rules/` | reproduces the signing vectors, passes `conformance/` |
| 4 | Rate limiting, alerting on repeated refusals, log retention | `ops/` | documented limits; an alert fires in a test |
| 5 | Pilot: one real task, one Class B agent, including revoke and audit | `docs/pilot/` | task submitted; audit shows only expected reads |
| 6 | Optional object-storage variant | `variants/object-storage/` | same order integration; delete-based revocation proven |

Configuration surface the gateway needs (from the design): signing keys per key id, allowed path prefixes, deny
patterns, `max_bytes` (1 MB proposed), `max_ttl` (7 days proposed), an audit log, a revocation list, and a read-only,
single-repository, short-lived repository credential kept as a secret.

When a runtime is chosen, add it as a subdirectory here (for example `worker/` or `service/`) with its own README.
The write gateway (`../../write`) is a Cloudflare Worker, so sharing that platform is one option for decision 0001, not
a decision.
