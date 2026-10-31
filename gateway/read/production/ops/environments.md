# Environments: how the read gateway is set up, and how it is kept apart

Stage 4.3, item 1. The read gateway has three environments. They are separate Workers with
separate state, separate keys and separate secrets, and this document is how the operator
creates them, how they are kept from drifting into each other, and how to tell which one is
running.

## The three environments

| | `test` | `staging` | `production` |
|---|---|---|---|
| What it is | the local environment: CI, the conformance suite, the operator's laptop | a disposable deployment, used for the pilot and for rehearsing an incident | the gateway the operator's own tasks are served by |
| Deployed | no | yes | yes |
| Worker name | `ctxgate-read` | `ctxgate-read-staging` | `ctxgate-read` |
| Reachable on | nothing | `workers.dev` | one named host, and nothing else |
| Key ids | `k1` | `k1` | `p1` |
| Repository | whatever the test points at | a disposable copy | the real one |
| Secrets | test-only values, in `.dev.vars` | its own | its own |

They are separated in three ways, and all three are checked:

- **by name.** They are different Workers, so they have different Durable Object namespaces:
  a revocation in staging is not a revocation in production, and the audit trails are not
  shared.
- **by key id.** The key id sets are disjoint. A link minted for staging carries a key id
  production does not serve, so production refuses it with `unknown-key` before it looks at
  anything else. This is the separation that holds even if two environments were ever to share
  a Worker name.
- **by secret.** Each environment holds its own signing keys, its own operator token and its
  own repository credential. The values are never in the repository, and they are never the
  same across environments. `wrangler secret list` shows the names; the values are the
  operator's business.

## The configuration has one source

`ops/environments.json` is the only file that says what an environment is. `wrangler.toml` is
**generated** from it:

```sh
python3 ops/render-environments.py          # render wrangler.toml
python3 ops/render-environments.py --check  # fail if wrangler.toml is out of date
```

The render is deterministic and the check is part of the deploy gate, so the deployed
configuration cannot differ from the committed record of it. A reviewer reads one file and
knows what will be published.

To change an environment, edit `ops/environments.json`, re-render, and commit both. Editing
`wrangler.toml` by hand is pointless: the next render overwrites it, and the gate fails until
the two agree.

The renderer refuses to render a configuration that breaks one of these rules:

| Rule | Why |
|---|---|
| `CTXGATE_TEST_CLOCK` may not be set in a deployed environment | it is a test switch. With it on, a caller carrying `X-Conformance-Now` extends the life of an expired link |
| `MAX_TTL` may not exceed 259200 (72 h) | the operator's approved ceiling (`docs/decisions/0003`). The gateway refuses to start with a larger value |
| `CLOCK_SKEW_TOLERANCE` may not exceed 120 seconds | the same decision |
| the key id sets of the deployed environments must be disjoint | otherwise a link minted for one is accepted by the other |
| production may not be exposed on `workers.dev` | production is reachable on one named host, and that host is part of the work-order contract (`docs/decisions/0002`) |
| the secrets may not appear as plain variables | a secret in a file is a secret in the repository |

## What the operator has to fill in

Two things in `ops/environments.json` are placeholders, and they are the operator's to
replace:

- `GITHUB_REPO` — the repository the gateway may read. One repository, one credential. The
  staging entry names a **disposable** repository: staging is where the pilot runs, and it
  must not be pointed at the real content by accident.
- the production `routes` pattern — the host the gateway is served on. It is not a free
  choice: it is the host the Class B agent's proxy is allowed to contact for a work order
  (`docs/decisions/0002`), so it is part of the contract with the agent.

Until they are filled in, the gate refuses to publish that environment:

```sh
python3 ops/render-environments.py --assert-deployable production
```

## Creating an environment

Each environment needs three secrets. They are set once, per environment, and never written
down in the repository:

```sh
cd gateway/read/production

# staging
npx wrangler secret put --env staging SIGNING_KEYS      # {"k1": "<a fresh secret>"}
npx wrangler secret put --env staging OPERATOR_TOKEN   # a fresh bearer token
npx wrangler secret put --env staging GITHUB_TOKEN      # a read-only, short-expiry token

# production
npx wrangler secret put --env production SIGNING_KEYS    # {"p1": "<a different secret>"}
npx wrangler secret put --env production OPERATOR_TOKEN # a different bearer token
npx wrangler secret put --env production GITHUB_TOKEN    # a different read-only token
```

`SIGNING_KEYS` is a JSON object mapping a key id to a signing secret. The key id is a
selector, not a secret: it is what makes a rotation possible. The secrets are the minter's
side of the scheme — `template/engine/tools/ctxlink.py` holds the same value and signs with
it.

**The three values are different in each environment.** A staging signing secret that also
works in production is not a staging secret.

The repository credential is fine-grained, read-only, scoped to one repository, and issued
with the shortest expiry that will do. It is the only credential the gateway holds.

## Publishing

The gate is the thing that decides, and the operator is the thing that acts:

```sh
cd gateway/read/production
bash ops/deploy-gate.sh --env staging          # the gate; publishes nothing
bash ops/deploy-gate.sh --env staging --deploy # the gate, then publish
```

`--deploy` needs `CTXGATE_BASE_URL`: the public URL of the gateway, so that the gate can
check the published gateway against the configuration after it is up.

The same gate runs in CI (`.github/workflows/deploy-read-gateway.yml`), where the publish job
waits for the gate job and for the environment's reviewer, and refuses to publish from
anything but `main`.

## Checking an environment

`/healthz` is public on purpose. It reports the effective policy and the key ids, and
nothing else: no repository, no allow prefix, no deny pattern, no secret, no order, no path.

```sh
curl -s https://<the host>/healthz | python3 -m json.tool
```

It is the way to tell which environment is running, and whether it is the one that was
configured:

| Field | What it tells you |
|---|---|
| `version` | the version of the Worker that is running |
| `key_ids` | which key ids this environment serves. If this is not the set in `environments.json`, the environment is not the one that was configured |
| `max_ttl`, `max_bytes`, `clock_skew_tolerance` | the effective limits, which are the ones a link is judged against |
| `conformance_clock` | **must be `false`**. If it is `true`, the test clock is on in a published environment, and a caller can extend the life of an expired link. That is an incident, not a configuration |

`ops/verify-deployment.py` checks all of that automatically, and also checks that the health
endpoint discloses nothing, that the operator channel refuses an unauthenticated caller, and
that an unsigned link is refused.

## What is not done here

No environment has been published. The gateway has never run on Cloudflare: the checks in
this directory run it on the local Cloudflare Workers runtime, which is the same runtime and
the same code, but it is not a deployment and nothing here is evidence about a running
Cloudflare environment. The pilot (Stage 6) is what will be.

The credentials for a Cloudflare account are not in this repository, and the deploy gate
needs them to publish: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, in the
environment's secrets. The gate refuses to publish an environment whose three secrets are
not set, and it refuses to publish a configuration that still has a placeholder in it.
