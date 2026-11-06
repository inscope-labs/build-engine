# Running the Class B pilot against the deployed staging gateways

Workflow: `.github/workflows/staging-pilot.yml` (Actions tab, Run workflow). It runs only from
`main`, only against `ctxgate-*-staging` hosts, and never touches production. It closes the
"deployed signed leg" gap of Stage 6.2 (register entry R0-013).

There is a second pilot, and it is a different thing: **the failure and recovery pilot**
(Stage 6.3), `ops/staging-failure-pilot.py`, run by
`.github/workflows/staging-failure-pilot.yml`. It interrupts the workflow — it stops the
gateway and starts it again, and it puts a fault injector between the gateway and GitHub — so
it runs against the **local** Workers runtime and the **real** provider, and it is repeatable.
Its closeout is `docs/release/PHASE-6.3-CLOSEOUT.md`.

## One-time setup: four secrets in the `staging` environment

| Secret | Value |
|---|---|
| `CTXGATE_SECRET` | the read gateway's signing secret |
| `CTXGATE_OPERATOR_TOKEN` | the read gateway's operator token |
| `CTXGATE_WRITE_SECRET` | the write gateway's signing secret |
| `CTXGATE_WRITE_OPERATOR_TOKEN` | the write gateway's operator token |

They are in `bundle.json`, from the `staging-init` delivery (see `STAGING-INIT.md`). List its
structure without printing any value, then set each secret from the file, so that the value never
appears on a screen or in shell history:

```bash
jq -r 'paths(scalars) | map(tostring) | join(".")' bundle.json
gh secret set CTXGATE_SECRET --env staging --repo inscope-labs/build-engine < <(jq -j '<path to the read signing secret>' bundle.json)
# ... the same for the other three
```

The value is the signing secret itself (not the `{"s1": ...}` map). Delete `bundle.json` and
`bundle.key` afterwards. `WRITE_GH_TOKEN` is already in the environment.

## Modes

- **probes-only** needs no secret and is repeatable.
- **signed** runs the full workflow against the deployed Workers (the same checks as the local
  leg). It is **single use per plan number**: the seal and the revocation are durable, and the
  estate's task folder is consumed. The workflow refuses to start unless
  `acknowledge_single_use` is `yes`.

A second signed run needs a fresh plan number in `ops/staging-pilot.py` and a re-seeded estate,
or rotated staging keys (`staging-init --replace yes`) with a re-seeded estate.

## What the run keeps

The run summary shows the tail of the output; the full output is the artifact
`staging-pilot-<run id>` (30 days). Before anything is kept, the output is checked for the value of
each of the five secrets; if one is found the output is discarded and the run fails. The audit scan
inside the pilot checks the provider credential against `WRITE_GH_TOKEN` only.
