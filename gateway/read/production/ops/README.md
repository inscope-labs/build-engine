# ops

Everything needed to run the read gateway.

| File | What it is |
|---|---|
| `environments.md` | the three environments, how they are kept apart, and how to create one |
| `environments.json` | the single source of truth for the configuration; `wrangler.toml` is generated from it |
| `render-environments.py` | renders `wrangler.toml`, and checks that it has not drifted |
| `runbook.md` | the operator runbook: publish, rotate, revoke, read the audit, incident response, rollback |
| `limits.md` | the limits, the ceilings, and what to do when one is hit |
| `deploy-gate.sh` | the gate: nothing is published until every check has passed |
| `bundle-check.sh` | the Worker builds, for every environment, with no configuration field left unrecognised |
| `verify-deployment.py` | checks a published gateway against the configuration it was published with |

## What the gateway refuses, and why

The refusals are in `conformance/SCHEME.md` section 7 and in the `src/rules.ts` port. The
resource controls are a property of the deployment, not of the scheme, and they are
documented in `limits.md`.

The revoke and audit channel is the operator's side of the gateway, and it is part of the
Worker: `POST /admin/revoke`, `GET /admin/audit`, `GET /admin/metrics`, all behind the
operator token. It is authenticated separately from the signing keys, so that holding a
signing key does not give anybody the right to rewrite the revocation list.

The state - the revocation set, the audit ring and the counters - is a Durable Object, and it
fails closed: if it cannot be read, the gateway serves nothing, because it cannot know
whether an order has been revoked. See `limits.md`.

## What is not here

- The write gateway's operations. It is a scaffold (Stage 5) and it has its own
  `gateway/write/docs/operator-runbook.md`.
- The pilot's operations. That is Stage 6, with its own acceptance document.
- Anything about the release of the artifact itself. That is Phase 7, in `docs/RELEASING.md`.
