# BUILD ENGINE — STAGE 4.3 CLOSEOUT (deployment and operational verification)

Repository: https://github.com/inscope-labs/build-engine
Date: 2026-10-27
Version: 0.5.0
Plan stage: RELEASE-PLAN.md Phase 4, Stage 4.3 (deployment and operational verification)

STATUS: STAGE 4.3 IS COMPLETE AS WORK. The read gateway now has three separated environments with
a generated configuration, a deploy gate that nothing may pass without, the operational checks
that a deployment has to survive, an isolation proof, and an operator runbook. The stage also
found and closed three defects, one of them serious: the gateway failed open when it could not
read its own revocation list.

**NOTHING HAS BEEN DEPLOYED.** The gateway has never run on Cloudflare. The operational checks
run it on the local Cloudflare Workers runtime — the same runtime and the same code — and the
Cloudflare-side steps of a deployment (the secret list, `wrangler deploy`, and the check of
the published gateway) were not executed, because this stage had no Cloudflare account to
execute them with. The pilot is Stage 6. No claim in this document should be read as a claim
about a running service.

---

## WHAT STAGE 4.3 ASKED FOR, AND WHAT EXISTS NOW

  4.3.1  Reproducible environment/configuration instructions and separate test/staging/production
         settings.
         DONE. `ops/environments.json` is the single source of truth for every environment, and
         `wrangler.toml` is GENERATED from it by `ops/render-environments.py`. The generator
         refuses to render a configuration that breaks one of the operator's rules (the test
         clock in a deployed environment, a lifetime above 72 h, a skew tolerance above 120 s,
         overlapping key ids, production on workers.dev, a secret as a plain variable), and
         the deploy gate refuses to publish when the committed `wrangler.toml` does not match
         what the source says. The three environments are separated by Worker name, by key id
         and by secret, and all three separations are checked. `ops/environments.md` is the
         instruction set: what to create, what to fill in, how to publish, how to check what
         is running.

  4.3.2  A deploy gate that requires tests and conformance to pass before deployment.
         DONE. `ops/deploy-gate.sh` runs, in order: the configuration check, the type check,
         the unit tests, the bundle check for every environment, the shared conformance suite
         over real HTTP, the abuse controls, the operational checks and the isolation proof.
         Every step fails closed, and the gate publishes nothing unless all of them passed.
         The publish step additionally requires the environment's three secrets to be set and
         the environment to be free of placeholders, and it checks the published gateway
         against the configuration after the deployment. The same gate runs in CI
         (`.github/workflows/deploy-read-gateway.yml`), where the publish job waits for the
         gate job, waits for a reviewer on the environment, and refuses to publish from
         anything but `main`.

  4.3.3  Verify cold starts, provider failures, unavailable source repository, expiry, revoked
         order, and key rotation in staging.
         DONE, on the local Cloudflare Workers runtime. `test/run-staging-checks.py` observes
         each of them against a running Worker: a cold start, six provider failure modes
         (server error, refused credential, rate limit, unreachable, timeout, repository
         gone), an expired link, a revoked order, and a key rotation with a restart in the
         middle. The revocation is measured, not assumed: the documented bound is two seconds
         and the check asserts it on every run.

  4.3.4  Prove that the gateway does not write to the source repository and does not persist
         copied file contents to third-party storage.
         DONE. `test/run-isolation-checks.py` proves it four ways: every request the gateway
         made to the provider was a GET for one pinned blob, and the repository has the same
         HEAD and a clean working tree before and after; the configuration declares no storage
         but the Durable Object; the served content is in none of the Durable Object's files,
         in raw or base64 form; and it is in no audit record, no metric, no log line and no
         other response. The source is also checked statically: the only outbound call in the
         Worker is the source adapter's.

  4.3.5  The operator runbook for deploy, key rotation, revoke, inspect audit, incident
         response and rollback.
         DONE. `ops/runbook.md` covers all six, and the incident response is a table of
         symptoms: what each one means, and what to do about it. It also says the things
         that are easy to get wrong — that a revoke which failed means the order is STILL
         LIVE, that a rollback does not un-revoke anything, and that a rollback must not bring
         back a retired key id.

---

## THE EVIDENCE

Every number below is the output of the command as written, run in this repository.

  python3 conformance/harness/run.py all --reference          94 passed, 0 failed
  python3 -m unittest discover -s template/engine/tools       73 tests, OK
  python3 -m unittest discover -s gateway/read/reference      15 tests, OK
  python3 -m unittest discover -s conformance                  14 tests, OK
  release/test-release.sh                                     22 passed, 0 failed
  tests/test_update.sh                                        22 passed, 0 failed
  npx tsc --noEmit (gateway/read/production)                  clean
  npm test (gateway/read/production)                          20 pass, 0 fail
  bash ops/bundle-check.sh                                    test, staging and production all build,
                                                                no configuration field left unrecognised
  npm run test:conformance                                    58 passed, 0 failed
  npm run test:abuse                                          PASSED
  npm run test:staging                                        PASSED
  npm run test:isolation                                      PASSED
  npm audit (gateway/read/production)                         0 vulnerabilities
  bash ops/deploy-gate.sh                                     THE GATE PASSED. Nothing was published.

The operational checks, in their own words:

  ok   a cold start serves the intended file in 0.07s (15 bytes)
  ok   a link pinned to another commit serves that commit's content
  ok   the response is no-store, nosniff and carries a digest
  ok   only the named file is served: neighbours, denied names, missing files and tampered
       paths are all refused, and unusual but legal paths work
  ok   an expired link is refused, and X-Conformance-Now cannot extend it
  ok   the provider in mode 'server-error' is answered with 502
  ok   the provider in mode 'unauthorized' is answered with 502
  ok   the provider in mode 'rate-limited' is answered with 503
  ok   the provider in mode 'unreachable' is answered with 502
  ok   the provider in mode 'slow' is answered with 504
  ok   the provider in mode 'repository-missing' is answered with 404
  ok   the gateway serves again once the provider recovers
  ok   the audit trail records the outcomes without leaking (18 records)
  ok   the metrics endpoint counts without disclosing
  ok   a revoked order is refused 26ms after the revoke, inside the 2s bound
  ok   a revoked order is still revoked after the Worker restarts
  ok   a key rotation needs no outage, retires the old key id, and keeps the revocation set

And the isolation proof:

  ok   every request the gateway made to the source repository was a GET for one pinned blob
  ok   the source repository is unchanged (same HEAD, clean tree)
  ok   the configuration declares no storage but the Durable Object
  ok   the served content is not in the Durable Object's storage (24 files searched)
  ok   the content is in no audit record, in no metric and in no log line
  ok   the only outbound call in the Worker is the source adapter's

The conformance run is the shared suite, driven over real HTTP against the Worker running on
the local Cloudflare runtime, against a scratch git repository and a local stand-in for the
GitHub contents API. It is not a re-implementation of the suite: the Worker is judged by
exactly the suite that judges the reference gateway.

---

## WHAT WAS FOUND AND FIXED

  F0-030  The gateway failed open when the state store could not be read. The state client
          turned any error from the Durable Object into "allow", and the same call path
          carried the revocation check. A revoked order was therefore served, with no
          revocation check at all, whenever the state store was unhealthy. Severity S1.
          Fixed: the state channel was extracted to `src/state-client.ts` and fails closed.
          An unreadable, an erroring and a malformed state store all produce the action
          `state-unavailable`, and the request is refused with 503. There is no path from a
          state-store failure to "allow". The audit record of such a refusal goes to the
          platform log, because the ring is unreachable too.

  F0-031  The operator channel reported a revocation that had not been stored.
          `POST /admin/revoke` ignored the state store's answer and returned
          `{"revoked": "..."}` with status 200 whatever had happened. An operator told
          "revoked" stops watching that order, and the capability stays alive. Severity S2.
          Fixed: the operator channel reports what the state store confirmed. A revoke that
          was not stored is a failure with 503, and the runbook says in three places that a
          failed revoke means the order is still live.

  F0-032  The test harness left the Cloudflare runtime running after every run. The staging
          check that restarts the Worker was answered by the old one, so the key-rotation
          check was reading the settings it had before the "restart". Severity S3, with a
          sting: it also broke the deploy gate at its first step, because `npm ci` could not
          remove a `node_modules` whose binaries were still open. Fixed: `test/procs.py`
          stops a whole process tree, and the staging harness refuses to go on if the port
          was not released.

---

## THE EXIT GATE OF PHASE 4

| The gate | Where it stands |
|---|---|
| the production implementation passes the same conformance suite as the reference gateway | **met.** 58 cases, 0 failed, over real HTTP, against the same suite that judges the reference gateway. The reference passes 94 checks of its own |
| a Class B agent can fetch only the intended pinned file using plain HTTPS GET, and cannot fetch adjacent or unauthorised content | **met on the local runtime.** A link serves exactly the bytes of the one file at the one pinned commit; a path outside the allow prefix, a path the deny list names and a tampered path are refused; a file that does not exist is a 404; a link pinned to another commit serves that commit's content, so the pin is real. The client side is the shipped `ctxlink.py` and the harness. **Not yet met against a deployed gateway with a real agent** — that is the pilot, Stage 6 |
| revocation takes effect within the documented bound | **met.** The documented bound is two seconds; the check measures it on every run and it is around 30 ms. The revocation is durable: it survives a deployment, a restart and a key rotation, and it is refused on the first request after the revoke |
| audit logs contain no capability secrets | **met.** The audit trail holds no signature, no signing secret, no raw URL, no file content and no repository credential; the metrics hold no order, no path and no key id. The isolation proof searches the Durable Object's own storage, the audit trail, the metrics and the log for the content it served and finds none of it |

---

## WHAT STAGE 4.3 DOES NOT ESTABLISH

  **No environment has been published.** The gateway has never run on Cloudflare. The
  Cloudflare-side steps of a deployment — `wrangler secret list`, `wrangler deploy`, and
  `ops/verify-deployment.py` against a live URL — were not executed, because this stage had no
  Cloudflare account to execute them with. The gate contains them and they are written to be
  run by the operator who holds the credentials. The configuration still carries the
  operator's placeholders: the repository and the production host. The gate refuses to publish
  an environment that still has one.

  **The staging platform is the local Cloudflare Workers runtime.** It is the same runtime,
  the same Worker and the same Durable Object as a deployment, and it is the only platform
  available without an account. It is not a deployment, and the stage says so in the
  documentation as well as here.

  **The real end-to-end pilot is Stage 6**, with its own acceptance document. The operational
  checks in this stage are about the gateway, not about a real task: they do not mint links
  from a plan, they do not run an agent, and they do not deliver anything back.

  **The write gateway is still a scaffold** (Stage 5). Nothing in this stage touches it.

  **The release is still Phase 7**, and the two hard blockers in `docs/STATUS.md` (the
  `protocol` field and the dated changelog entry) are still open. They belong to Stages 2.1
  and 7.1, and Stage 2.1 is open as PR #9.

  **The reason vocabulary is wider than the scheme's list.** The production gateway's
  authoritative list of audit reasons is `src/audit.ts` (twenty reasons). `conformance/SCHEME.md`
  section 10 names twelve of them, and the harness checks the ones it names. The eight extra
  reasons are deployment-specific (`rate-limited`, `cooldown`, the four `upstream-` reasons,
  `state-unavailable` and `internal-error`) and were already there at Stage 4.2. The scheme's
  list reads as examples rather than a closed set, and this stage did not change the
  normative document to close a question it did not need to. A later amendment should say
  whether the vocabulary is closed, because a machine reading the audit trail has to know.

---

## CHANGES OUTSIDE gateway/read/production

  .github/workflows/ci.yml            the read-gateway job now runs the configuration drift
                                     check, the operational checks and the isolation proof
  .github/workflows/deploy-read-gateway.yml   the gate in CI: a gate job, and a publish job
                                     that waits for it, for a reviewer, and for `main`
  docs/release/DEFECT-REGISTER.md     F0-030, F0-031 and F0-032 recorded and closed; F0-003
                                     and R0-008 updated
  docs/STATUS.md, docs/END-TO-END.md  the status of the read gateway, stated from the evidence
  gateway/read/README.md              the status table
  conformance/                        unchanged. The scheme is not amended by this stage: the
                                     deployment surface is policy, not scheme

---

## THE NEXT STAGE

Stage 5 is the write gateway, which is still a scaffold: a Worker that answers 501 and a test
tree full of `export {}`. Stage 6 is the pilot, and it needs a deployed staging environment,
which needs the operator's Cloudflare account and the two placeholders in
`ops/environments.json` filled in. The order in the plan is 5 then 6, and the plan is right:
the pilot exercises the write gateway's delivery path, so the write gateway has to exist first.
