# Phase 6.1 — Closeout: a disposable staging environment

- Stage: **6.1** of `RELEASE-PLAN.md` (Phase 6, "Cross-system integration and real pilot") — *"Establish a disposable staging environment"*.
- Date: 2026-11-01.
- Source commit: `b5f4c0127df3b0d14bf4072a1cc4cd8a986e27ad` (`main`, the commit this branch was cut from).
- Branch: `phase-6/6.1-staging-environment`.
- Governing documents: `docs/release/DEFECT-REGISTER.md` (addendum A9), `docs/release/V0.5.1-BUILD-PLAN.md` (a draft; Stage BE-0 is not closed, so this stage follows `RELEASE-PLAN.md`).

## 1. Intent and scope

Plan tasks 6.1.1 to 6.1.4:

| Task | What it asks for | Done? |
|---|---|---|
| 6.1.1 | a dedicated test repository or isolated test branch/folder, and test-only credentials | **yes**, with a deviation (section 7) |
| 6.1.2 | deploy the read and write gateways, with separate staging keys and provider configuration | **the configuration is complete and proven; the publish step is blocked** on the operator's Cloudflare account (section 6) |
| 6.1.3 | staging data cannot be mistaken for production submissions, and is safely disposable | **yes**, and it is enforced by code rather than by care |
| 6.1.4 | record the source commit, the deployment IDs, the environment settings (no secrets) and the test fixture refs | **yes** (sections 3 to 5), except the deployment IDs (section 6) |

## 2. What was built

| What | Where |
|---|---|
| The disposable estate: the record, the tool, the fixtures | `ops/staging-estate.json`, `ops/staging-estate.py`, `ops/staging-fixtures/` |
| The rehearsal that drives both gateways against the real provider | `ops/staging-rehearsal.sh` |
| The read gateway's staging environment, filled in | `gateway/read/production/ops/environments.json` (and the `wrangler.toml` generated from it) |
| The write gateway's staging environment | `gateway/write/wrangler.toml` (`[env.staging]`) |
| The separation gate that keeps the two apart | `gateway/write/scripts/check-staging-separation.py`, wired into CI as `write-gateway-staging-separation` |
| The runtime rules that make the separation a property of the configuration | `gateway/write/src/config/env.ts` (`DEPLOY_ENV`, `SIGNING_KEY_IDS`, `PRODUCTION_SUBMISSIONS_REPO`) |
| The operator's procedure | `gateway/write/docs/operator-runbook.md` §7.2-7.3, `gateway/read/production/ops/environments.md` |

## 3. The environment settings (no secrets)

**Read gateway** — `gateway/read/production/ops/environments.json`, environment `staging`:

| Setting | Value |
|---|---|
| worker name | `ctxgate-read-staging` |
| exposure | `workers.dev` |
| key ids | `s1` (disjoint from production's `p1`) |
| `GITHUB_REPO` | `inscope-labs/build-engine` |
| `GITHUB_API_BASE` | `https://api.github.com` |
| `ALLOW_PREFIXES` | `amk/,plans/*/package/` |
| `MAX_TTL` / `MAX_BYTES` / `CLOCK_SKEW_TOLERANCE` | `259200` / `1048576` / `120` (the operator's ceilings) |
| secrets (names only) | `SIGNING_KEYS`, `OPERATOR_TOKEN`, `GITHUB_TOKEN` |

**Write gateway** — `gateway/write/wrangler.toml`, environment `staging`:

| Setting | Value |
|---|---|
| worker name | `ctxgate-write-staging` |
| exposure | `workers.dev` |
| `DEPLOY_ENV` | `staging` |
| `SIGNING_KEY_IDS` | `sk1` (disjoint from production's `k1`) |
| `SUBMISSIONS_REPO` | `inscope-labs/build-engine` |
| `SUBMISSIONS_BRANCH` | `staging/submissions` |
| `SUBMISSIONS_FOLDER_TEMPLATE` | `plans/{plan}/submissions/{order}/{task}` |
| `PRODUCTION_SUBMISSIONS_REPO` | `OWNER/REPO` — the repository the staging deployment **refuses** to be pointed at |
| `GITHUB_COMMIT_AUTHOR` | `build-engine write gateway (staging) <ctxwrite-staging@users.noreply.github.com>` |
| secrets (names only) | `SIGNING_KEYS`, `GITHUB_TOKEN`, `OPERATOR_TOKEN` |

The production settings are unchanged, except that `workers_dev = false` is now where it belongs (section 4.1) and that `DEPLOY_ENV` and `SIGNING_KEY_IDS` are declared.

## 4. The findings

Three defects were found by the rehearsal and closed in the same stage. The register's addendum A9
holds the full evidence; the summary is:

### 4.1 F0-070 — `workers_dev = false` was a variable

`gateway/write/wrangler.toml` carried the deployment default *inside* the `[vars]` table, so it was
an ordinary variable and the **setting** was never applied. Wrangler's default is `true`: the first
production deployment would have been published on a public `*.workers.dev` URL, against protocol
section 12.5.

Evidence, before the fix:

```
$ python3 -c "import tomllib; d=tomllib.load(open('gateway/write/wrangler.toml','rb')); \
  print(d.get('workers_dev','(unset)'), d['vars'].get('workers_dev'))"
(unset) False
```

After the fix: `workers_dev = False` is a root key, and it is not in `vars`.

### 4.2 F0-071 — the gateway could not start in the Workers runtime

`src/index.ts` exported `PROTOCOL`, a string. The runtime accepts a default handler, Durable
Object classes and a few named entry points, and nothing else:

```
ERROR service core:user:ctxgate-write-staging: Uncaught TypeError: Incorrect type for map entry
'PROTOCOL': the provided value is not of type 'function or ExportedHandler'.
```

The 363-test suite did not see it (the tests import the module in Node) and the bundle dry run did
not see it (it builds without starting the runtime). The export is removed and the gateway starts.

### 4.3 F0-072 — every provider call failed with "Illegal invocation"

`GitHubClient` called `this.fetchImpl(url, init)`. The Workers runtime refuses to run `fetch`
with the wrong receiver, and the receiver of a method call is the client. The behaviour was
isolated on the runtime:

| call | result |
|---|---|
| `fetch(url, init)` | the request goes out |
| `const f = globalThis.fetch; f(url, init)` | the request goes out |
| `const o = { f: globalThis.fetch }; o.f(url, init)` | `TypeError: Illegal invocation` |
| `globalThis.fetch.call(globalThis, url, init)` | the request goes out |

The TypeError was caught as a *network* failure and mapped to `provider-unavailable` — a
**retryable** code — so the first rehearsal commit answered `503 provider-unavailable` after three
attempts and 820 ms, with no cause in the log. The implementation is now bound to the global
scope, and a unit test reproduces the runtime's rule (it fails with the fix reverted).

**The write gateway had never spoken to GitHub, and could not have.** This answers the open
question in the Stage 5.5 closeout.

## 5. The evidence

### 5.1 The rehearsal

`ops/staging-rehearsal.sh` starts both gateways on the local Workers runtime with their staging
configuration and drives them against the real provider. Its output, in full:

```
== the disposable estate ==
repository: inscope-labs/build-engine (present)
read_gateway: staging/source
  head: 346a38f14894dd8707e88bda879df1d5530aeb8e
write_gateway: staging/submissions
  head: 7a4120854b09b76fda35a0ae3e7f212f83a90ede
  task folder: plans/pilot-001/submissions/wo-10008/10008-1-001-01

== the read gateway, against the real provider ==
   port 21000
   the read gateway is running
   the allowed file was served (200)
   the second allowed file was served (200)
   the file outside the allowed prefixes was refused (403)

== the write gateway, against the real provider ==
   port 21000
   the write gateway is running
   the write gateway reports deploy_env=staging
   a capability was minted with the shipped signing code
   the file was scaffolded
   the chunk was staged
   the staged content reads back byte for byte
   the commit landed: fd7b4f766f8a70f5ef86bde0e94f7e4157c31032
   the retry was a replay, not a second commit
   the task was sealed
   a write after the seal was refused
   the disposable branch points at the commit

THE REHEARSAL PASSED.
```

What each line is worth:

- the read link was minted with the **shipped** client, `template/engine/tools/ctxlink.py` — the
  one that goes to consumers — so the shipped artefact and the gateway agree on the scheme;
- the negative fixture (`plans/pilot-001/private/notes.md`) is outside the allowed prefixes and was
  refused with `403` and the same body as every other refusal;
- the write capability was minted with the **shipped** signing code
  (`gateway/write/scripts/mint-root-url.ts`), so a capability minted offline is one the gateway
  verifies;
- the commit landed in the real repository. The branch history shows the staging identity:

  ```
  fd7b4f766f8a  build-engine write gateway (staging)  ctxwrite-v1: 10008-1-001-01 (wo-10008)
  7a4120854b09  build-engine write gateway (staging)  ctxwrite-v1: 10008-1-001-01 (wo-10008)
  85870301290d  build-engine write gateway (staging)  ctxwrite-v1: 10008-1-001-01 (wo-10008)
  abb4acc10dd9  build-engine write gateway (staging)  ctxwrite-v1: 10008-1-001-01 (wo-10008)
  04a2d0de6afb  build-engine staging estate             seed the disposable staging submissions branch
  ```

  and the commit itself:

  ```
  commit   abb4acc10dd9907421b9825c182a662d3c0655f6
  parent   04a2d0de6afb8c64c3e73a3619e57e340d7298f3   (the expected head: the precondition held)
  author   build-engine write gateway (staging) <ctxwrite-staging@users.noreply.github.com>
  message  ctxwrite-v1: 10008-1-001-01 (wo-10008)
  file     plans/pilot-001/submissions/wo-10008/10008-1-001-01/report.md   82 bytes
  ```

### 5.2 The gates

| Gate | Command | Result |
|---|---|---|
| the write gateway's suite | `npm test` (in `gateway/write`) | **370 passed, 0 failed** (363 before this stage) |
| the write gateway's typecheck | `npm run typecheck` (three programs) | pass |
| the write gateway's bundle | `npm run check:bundle` | pass |
| the contract consistency | `npm run check:contract` | pass |
| the log hygiene gate | `npm run verify:log-hygiene` | 18 outputs scanned, 0 findings |
| **the new separation gate** | `npm run check:staging` | 20 checks, pass |
| the read gateway's configuration | `python3 ops/render-environments.py --check` | `wrangler.toml` matches `ops/environments.json` |
| the read gateway's typecheck | `npm run typecheck` | pass |
| the read gateway's unit suite | `npm test` | 20 passed |

### 5.3 The separation gate fails closed

The gate was tested against three broken configurations. Each one is refused, with the message that
says which rule was broken:

| Broken configuration | The gate says | Exit |
|---|---|---|
| `workers_dev = false` moved back into `[vars]` (F0-070) | `workers_dev is set at the top level of wrangler.toml`; `production is not exposed on workers.dev`; `workers_dev is not an ordinary variable` | 1 |
| staging pointed at the production repository | `staging writes to a different repository than production`; `the staging destination is not the production repository` | 1 |
| staging and production sharing a key id | `staging and production share no key id (shared: k1)` | 1 |
| staging's production guard removed | `the staging deployment declares the production submissions repository`; `the declared production repository is the one production actually writes to` | 1 |

### 5.4 The runtime rules fail closed

The new configuration rules are unit-tested, including the case that matters: a staging deployment
that is pointed at the production repository **refuses to start**, and the message names the
setting and not a value.

## 6. What is NOT done, and why

**The gateways are not deployed.** No Cloudflare account credential was available in this
environment, and publishing is an operator action in any case (plan rule G-12). Nothing here is
evidence about a running Cloudflare environment, and this stage does not claim to be.

What is ready for the operator, and is the whole of what a publish needs:

```sh
# the read gateway
cd gateway/read/production
bash ops/deploy-gate.sh --env staging --deploy          # needs CTXGATE_BASE_URL and the Cloudflare credential

# the write gateway
cd gateway/write
npm run check:staging
npx wrangler deploy --env staging
npm run check:staging -- --base-url https://<the staging host>
```

The write gateway's staging deployment needs three secrets (`SIGNING_KEYS`, `GITHUB_TOKEN`,
`OPERATOR_TOKEN`) and the read gateway's needs the same three. The deploy gate refuses to publish
an environment whose secrets are not set.

**The deployment IDs are therefore not recorded.** They are the `wrangler deploy` run and the
Worker version, and they exist only after the publish above.

## 7. The deviation: branches, not dedicated repositories

The protocol wants the write gateway's destination to be a **dedicated** submissions repository
with a credential scoped to it alone (protocol section 12.1). The staging estate does not have that
topology, and the reason is a credential, not a preference.

The only credential available while this stage was executed is a fine-grained token whose
repository selection covers the build-engine repository alone. What it can and cannot do, measured:

| Action | Result |
|---|---|
| `GET /repos/inscope-labs/build-engine` | 200 |
| `POST /repos/inscope-labs/build-engine/git/blobs` | 201 |
| `POST /user/repos` (create a repository) | 201 |
| `GET /repos/inscope-labs/<a repository it created>` | **404** |
| `POST /repos/inscope-labs/<a repository it created>/git/blobs` | **404** |
| `POST /repos/inscope-labs/<a public repository it created>/git/blobs` | **403** `Resource not accessible by personal access token` |
| `DELETE /repos/inscope-labs/<a repository it created>` | **404** |

So the token can create a repository and then cannot see it. The estate is therefore **isolated
branches** of the build-engine repository — the other thing plan task 6.1.1 allows ("a dedicated
test repository **or** isolated test branch/folder") — and the record says so, with the transcript,
in `ops/staging-estate.json`.

To move the estate to dedicated repositories: create them, add them to the staging credential's
repository selection, change the repository and the two branches in `ops/staging-estate.json`, and
re-run `ops/staging-estate.py create`. Nothing else changes, because both gateways name their
destination in configuration only.

**The separation does not depend on the topology.** The staging deployment is a different Worker
with different Durable Object namespaces, different key ids and a different destination, and it
refuses to start if it is pointed at the production repository.

## 8. The test fixture references

| Fixture | Where | Notes |
|---|---|---|
| the estate record | `ops/staging-estate.json` | the names, the branches, the task folder, the credential's environment variable |
| the source fixture | `ops/staging-fixtures/source/` | `README.md`, `amk/context.md`, `plans/pilot-001/package/brief.md`, `plans/pilot-001/private/notes.md` |
| the submissions fixture | `ops/staging-fixtures/submissions/` | `README.md`; the `.keep` placeholder is generated from the record |
| the disposable source branch | `staging/source` @ `346a38f14894dd8707e88bda879df1d5530aeb8e` | the commit the pilot's links pin |
| the disposable submissions branch | `staging/submissions` @ `fd7b4f766f8a70f5ef86bde0e94f7e4157c31032` | after the rehearsal; the seeded head was `04a2d0de6afb8c64c3e73a3619e57e340d7298f3` |
| the task folder | `plans/pilot-001/submissions/wo-10008/10008-1-001-01` | with its `.keep` placeholder |
| the pilot's ids | plan `pilot-001`, order `wo-10008`, task `10008-1-001-01` | they satisfy the protocol's id rules: a plan id is lower-case, a task id is the plan tooling's pattern |

## 9. Risks and unresolved questions

| # | Question | Why it matters | Who |
|---|---|---|---|
| 1 | The staging estate is on branches of the engine repository, not on dedicated repositories. | The protocol wants a dedicated submissions repository with a repository-scoped credential. The staging topology is a deviation forced by the credential's scope, and it is recorded. | operator: widen the token's repository selection, or accept the deviation for staging |
| 2 | The credential the deployed staging gateway holds is not yet minted. | It must be scoped to the estate's destination and nothing else. `gateway/write/scripts/check-token-scope.ts` is the check. | operator |
| 3 | The staging deployments have never been published. | The configuration is proven against the real provider on the local runtime, which is the same code and the same runtime — but it is not a deployment, and the deploy gate is still to be run for real. | operator, with a Cloudflare account |
| 4 | `workers_dev = true` for staging is a deliberate exposure. | Staging holds no real content and is disposable. If the operator would rather it were on a named host, the exposure is one line in `ops/environments.json` and one in `wrangler.toml`. | operator |
| 5 | The production repository, the production host and the production submissions repository are still placeholders. | They are the operator's to name, and the gates refuse to publish an environment that still carries one. | operator |
| 6 | Three repositories were created by this stage's probing and cannot be deleted with the available credential. | `inscope-labs/build-engine-staging-source`, `inscope-labs/build-engine-staging-submissions` and `inscope-labs/be-staging-probe2` (public). They are empty. The credential answers 404 to the first two and 403 to the third, so **they have to be deleted by hand**. | operator |
| 7 | `DEPLOY_ENV` and `SIGNING_KEY_IDS` are now **required** settings of the write gateway. | A deployment that does not declare them refuses to start. That is the fail-closed behaviour, but it changes what a deployment must set. | noted, no action |

## 10. What Stage 6.2 needs

- the staging deployments, published and verified (`npm run check:staging -- --base-url …`);
- the credential scoped to the estate's destination;
- the pilot's ids, which the estate already provides: plan `pilot-001`, order `wo-10008`, task
  `10008-1-001-01`;
- the fixture commit `346a38f14894dd8707e88bda879df1d5530aeb8e`, which the read links pin;
- `ops/staging-estate.py dispose` when the pilot is over, and `npx wrangler delete --env staging`
  for the write gateway.

The write gateway's commit path has now been exercised against the real provider once. The failure
and recovery matrix of Stage 6.3 — rate limits, timeouts after a commit, eviction, stale heads —
is still unproven against the real provider, and the mock is what the suite uses.
