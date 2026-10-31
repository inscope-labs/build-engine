# gateway/read/production

The deployable read gateway. A Cloudflare Worker that verifies a signed `ctxgate-v1` link and
serves **exactly one file at one pinned commit** to a caller that holds no credential of its own.

Hosting is decided: `docs/decisions/0001` (Cloudflare Workers, operator-owned, single-tenant).
The scheme it implements is `conformance/SCHEME.md`. The design is
`template/docs/CONTEXT-EXPORT.md` (a shipped document).

## What it is

| | |
|---|---|
| Runtime | Cloudflare Workers (TypeScript), one Worker, one Durable Object |
| Source | the GitHub contents API, read-only, with the raw media type |
| State | the Durable Object: revocation set, audit ring, abuse counters |
| Acceptance | `conformance/` — the shared suite, driven over real HTTP against this Worker |

The Worker is the whole gateway. The source adapter, the rules and the state are modules inside
it, not separate services, so there is one thing to deploy, one thing to reason about and one
thing to revoke against.

## Layout

| Path | What it is |
|---|---|
| `src/index.ts` | the entry point: routing, the health endpoint, the admin channel, the Durable Object binding |
| `src/scheme.ts` | link parsing and signature verification — the part that must match `conformance/SCHEME.md` exactly |
| `src/rules.ts` | the ten checks of SCHEME section 7, in order |
| `src/policy.ts` | the configuration surface: keys, prefixes, deny patterns, limits, ceilings |
| `src/source.ts` | the source adapter: one file, one commit, bounded read, JSON guard |
| `src/deny.ts` | the deny patterns |
| `src/audit.ts` | the audit record: which fields exist, and which can never exist |
| `src/state.ts` | the Durable Object: revocation, the audit ring, the counters |
| `test/unit/` | unit tests (the signing vectors, reproduced byte for byte) |
| `test/run-conformance.py` | drives the shared conformance suite against a locally running Worker |
| `test/run-abuse-controls.py` | the resource controls, which the conformance suite does not cover |
| `test/localenv.py` | the shared test plumbing: scratch repository, stand-in for the GitHub API, local Worker |
| `test/github_stub.py` | a small stand-in for the GitHub contents API |
| `ops/limits.md` | the limits, the ceilings, and what to do when one is hit |

## Running it locally

```sh
npm ci
npm run typecheck
npm test                      # unit tests: the signing vectors
npm run test:conformance      # the shared suite, against a Worker on the local runtime
npm run test:abuse            # the resource controls
```

`test:conformance` and `test:abuse` need `python3` and start the Worker themselves. They build a
scratch git repository, stand up a local stand-in for the GitHub contents API, start the Worker
with `wrangler dev --local`, drive the suite over real HTTP, and then tear everything down. They
write nothing outside a temporary directory.

## Configuration

`wrangler.toml` holds the non-secret configuration. The secrets are not in it and must never be:

| Secret | How it is set |
|---|---|
| `SIGNING_KEYS` | `wrangler secret put` — the JSON map of key id to signing secret |
| `OPERATOR_TOKEN` | `wrangler secret put` — the bearer token for the admin channel |
| `GITHUB_TOKEN` | `wrangler secret put` — the read-only repository credential |

Locally they go in `.dev.vars` (git-ignored). A misconfigured gateway fails closed: it says what
is missing to the operator and serves no content.

The non-secret surface is `SIGNING_KEYS`' key ids, `ALLOW_PREFIXES`, `DENY_PATTERNS`, `MAX_BYTES`,
`MAX_TTL`, `CLOCK_SKEW_TOLERANCE`, `SOURCE_TIMEOUT_MS`, the `RATE_LIMIT_*` budgets,
`REFUSAL_BURST`, `REFUSAL_COOLDOWN_SECONDS` and `AUDIT_RETENTION`. The values that describe the
policy are also reported on `/healthz`, so a verifier can test the gateway as it is actually
configured rather than as it was intended to be.

Two ceilings are policy, not configuration: `MAX_TTL` may not exceed 259200 (72 h) and
`CLOCK_SKEW_TOLERANCE` may not exceed 120 seconds. A deployment that asks for more is refused at
startup.

## The endpoints

| Endpoint | Who | What |
|---|---|---|
| `GET /v1/{kid}/{exp}/{order}/{sig}/{ref}/{path}` | anyone holding a link | the one file, or a refusal |
| `GET /healthz` | anyone | status, version, and the effective policy — no protected state |
| `GET /admin/audit` | the operator | the audit trail, as JSON lines |
| `GET /admin/metrics` | the operator | counters only |
| `POST /admin/revoke` | the operator | revoke an order |

`/healthz` is public on purpose: it discloses the policy and the key ids, never a path, an order,
a signature or a count of protected files. The admin channel requires the operator token; without
it, every admin route answers 401.

## The two switches that must stay off

`CTGXATE_TEST_CLOCK` enables the conformance test clock. With it set, a request carrying
`X-Conformance-Now` is judged against that time instead of the wall clock. It is a test hook: a
deployment that sets it lets a caller extend the life of an expired link. It is not set in
`wrangler.toml` and must not be set in any deployed environment.

`X-Conformance-Now` is ignored unless that switch is on.

## Not shipped

`gateway/` is a development asset. It is not in `release/manifest.txt` and does not reach a
consumer artifact; `conformance/test_conformance.py` asserts that.

## What is not done here

This is Stage 4.2: the port. Deployment, environment separation, the deploy gate and the
operator runbook are Stage 4.3, and the real end-to-end pilot is Stage 6. Nothing here has been
deployed to a staging or production environment, and no claim in this README should be read as a
claim about a running service.

## Release scope

The Class B gateways are **unsupported in 0.5.0** (Basic, Class A-only). This gateway is planned for
0.6.0 Standard, after Stage 4.3 (deployment) and the real pilot.
