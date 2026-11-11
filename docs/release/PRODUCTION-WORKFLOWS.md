# Production workflows: what exists, what changed, what is still open

Context: ADR 0008 requires explicit operator approval for every production deploy, distinct
signing keys and credentials per environment, and a decision on the production destinations
before any production deploy (open items DX-1, DX-2). This document records the production-side
workflows next to the staging ones.

## Side by side

| | Staging | Production |
|---|---|---|
| Read gateway deploy | `deploy-read-gateway.yml`, environment `staging` | the same workflow, environment `production` |
| Write gateway deploy | `deploy-write-gateway-staging.yml` | `deploy.yml` (hardened here) |
| Secret initialisation | `staging-init.yml` | `production-init.yml` (new) |
| Pilot | `staging-pilot.yml` | none: a production pilot is a separate stage |

The read gateway's production deploy already had the full gate (`ops/deploy-gate.sh`: placeholder
refusal, secrets check, post-deploy `verify-deployment.py`). It is unchanged.

## What changed for the write gateway

- **`deploy.yml` runs by hand only.** It used to run on every push to `main`; with the production
  credentials set, merging any pull request would have published the gateway.
- Only from `main`. After the existing gates it runs `scripts/check-production.py`, which refuses a
  placeholder submissions repository, a shared key id or destination with staging, and a drifted
  `workers_dev` posture.
- It checks that the production Worker has `SIGNING_KEYS`, `OPERATOR_TOKEN` and `GITHUB_TOKEN`
  before publishing (skipped with `first_deploy: yes`; a Worker without `SIGNING_KEYS` refuses to
  start, so a first deploy is safe).
- After publishing, with `base_url` given, the published gateway is asked what it is (`/healthz`):
  environment, exactly the declared key ids, no staging key id, the configured repository and
  branch, the conformance clock off. Without `base_url` the run says the gateway was **not**
  checked.
- **`production-init.yml`** (`ops/production-init.sh`) sets the three secrets on the production
  Worker(s) and delivers the generated values in an encrypted artifact, like `staging-init`. It uses
  the `production` environment's own `READ_GH_TOKEN` / `WRITE_GH_TOKEN`, refuses to run while any
  placeholder remains, and creates a missing Worker only with `create_if_missing: yes`.

## Setup in GitHub (not something a workflow can do)

1. **Required reviewer on the `production` environment.** *(Done on 2026-11-09: the reviewer is the second
   account `inscope-xlabs`, not the operator who dispatches; see ADR 0013, addendum 2.)* Originally the environment
   had no protection rules, so the approval ADR 0008 asks for did not exist.
2. In `production`: secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `READ_GH_TOKEN`,
   `WRITE_GH_TOKEN` (production's own credentials, not staging's); variable `DELIVERY_PUBLIC_KEY`.
   The read gateway's deploy also reads the secret `CTXGATE_BASE_URL`.

## Verifying the write credential's reach (S5 entry gate)

`verify-write-credential-scope` (manual, `main` only, `production` environment, so its required
reviewer approves each run) asks GitHub, with the environment's `WRITE_GH_TOKEN`, which repositories
that credential can reach. It passes only when the credential can push to the submissions repository
named in `gateway/write/wrangler.toml` and nothing else grants write rights or is private, and the
consumer repository (input `consumer_repo`) has no write rights (ADR 0014). It changes nothing and
prints counts, not other repositories' names or the token. Rules: `ops/verify-write-credential-scope.py`.
It cannot tell whether the token is limited to one branch: a GitHub token is repository-scoped.

## Still open (none of this PR resolves it)

- **Production destinations**: the write gateway's `SUBMISSIONS_REPO` and `SUBMISSIONS_BRANCH` are now
  named for the pilot plan (`inscope-labs/acme-pilot-dev`, branch `submissions`; ADR 0014). They are plan
  values held in gateway configuration for 0.6.0 (pending decisions P-002 and P-003). A placeholder still
  makes the production gates and `production-init` refuse to run. That is intended.
- **Production on `workers.dev`** (ADR 0008 decision D-6.1): **changed by BE-0.** The gates no longer
  require `workers_dev = false`; production is exposed on `workers.dev` for both gateways, on each
  Worker's own host, and the shared-zone mitigations (distinct Worker names, distinct key ids,
  distinct credentials, distinct destinations, no wildcard routes, explicit operator approval for
  every production deploy) are what keep the zone safe. `base_url` still has nothing to point at,
  because the production destinations are still placeholders.
- **Not run against Cloudflare.** `production-init.sh` was exercised with a fake `wrangler`
  (placeholder refusal, secrets-exist refusal, replace, create-if-missing, per-environment token
  routing, bundle decryption, no secret in output). The workflows have not run on GitHub Actions.
