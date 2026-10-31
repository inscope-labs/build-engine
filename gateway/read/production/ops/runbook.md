# The operator runbook: the read gateway

Stage 4.3, item 5. What the operator does with a running gateway: publish it, rotate a key,
revoke an order, read the audit trail, deal with an incident, and roll back.

Every command here is run by the operator. The gateway never does any of it on its own: a
publication, a rotation and a revocation are all operator actions (`RELEASE-PLAN.md` G-12),
and the only thing the gateway does by itself is refuse a link it should refuse.

The three environments are described in `environments.md`. The limits and what they mean are
in `limits.md`.

---

## Publish

```sh
cd gateway/read/production
bash ops/deploy-gate.sh --env staging --deploy
```

The gate runs everything and publishes only if everything passed. It cannot be told to skip a
step, and it will not publish a configuration that has drifted from
`ops/environments.json`.

After it publishes, the gate checks the published gateway against the configuration: the
version, the key ids, the limits, the test clock, what the health endpoint discloses, that
the operator channel is closed without a credential, and that an unsigned link is refused.
**If that check fails, the deployment is wrong, and the incident response below applies.**

In CI, the same gate runs from `.github/workflows/deploy-read-gateway.yml`. The publish job
waits for the gate job and for a reviewer on the environment, and refuses to publish from
anything but `main`.

The repository credential is a fine-grained, read-only token scoped to one repository. If it
expires, the gateway answers `502 upstream-unauthorized`; see the incident response.

---

## Rotate a key

Rotation does not need an outage. The gateway serves several key ids at once, so the new key
can be added before the old one is removed.

The key id is a selector, not a secret. A rotation changes the **secret** behind a key id, or
introduces a new key id and retires the old one.

**Adding a key id (the usual rotation):**

1. Mint with the new key id. The minter is `template/engine/tools/ctxlink.py`; the new
   secret must be in the minter's configuration and in the gateway's `SIGNING_KEYS`.
2. Add the new key id to the gateway's secrets, keeping the old one:

   ```sh
   npx wrangler secret put --env production SIGNING_KEYS
   # {"p1": "<the old secret>", "p2": "<the new secret>"}
   ```

3. Publish. Both key ids are served from now on.
4. Switch the minter to the new key id, and mint new links with it.
5. Let the old links expire (at most 72 h, and at most 24 h by default), then remove the old
   key id:

   ```sh
   npx wrangler secret put --env production SIGNING_KEYS
   # {"p2": "<the new secret>"}
   ```

6. Publish again. Links signed with the retired key id are now refused with `unknown-key`.

**Changing the secret behind a key id** is the same procedure with one difference: the old
secret must stop being used by the minter at the same moment, or the links signed with it
stop working immediately. Do this only when the old secret has leaked, and expect the links
signed with it to die at once.

**What a rotation does not touch:** the revocation set, the audit trail, or the rate-limit
counters. They live in the Durable Object and survive a deployment and a rotation. A revoked
order stays revoked across a rotation.

**The staging and production key ids are disjoint.** A key id belongs to one environment. Do
not give production the key id staging uses, even for a moment: the disjointness is what
stops a staging-minted link from being replayed against production.

---

## Revoke an order

Revoking an order kills every link minted for it, and no link of any other order. The order
is the unit of revocation, and the order is bound into the signature, so a link cannot be
moved to another order.

```sh
curl -sS -X POST https://<the host>/admin/revoke \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order": "10008-S001"}'
```

The revocation takes effect on the **next request**: the revocation set lives in the Durable
Object, not in a cache, so there is no propagation delay to wait out. The measured bound in
the staging checks is under a second; the documented bound is two seconds
(`limits.md`).

The answer tells the truth. If the state store could not be reached, the call fails with
`503` and the order is **not** revoked — a revoke that is reported as done but was not stored
would leave a live capability behind a closed door. **If a revoke fails, the order is still
live.** Revoke again.

The order of events after a revoke:

1. revoke the order;
2. confirm it took effect — request a link for that order and expect `403`;
3. tell the agent that owns the order, so it stops using the link;
4. if the revoke was for a leak, also rotate the signing key (above) and check the audit
   trail for what was fetched while the capability was live.

**Revocation is not the same as a key rotation.** Revoking an order kills the links for that
order. Rotating a key kills every link signed with that key, including the ones for orders
that are perfectly legitimate.

---

## Read the audit trail

Every request writes exactly one record, whatever the outcome.

```sh
# the whole trail
curl -sS https://<the host>/admin/audit -H "Authorization: Bearer $OPERATOR_TOKEN"

# one order
curl -sS "https://<the host>/admin/audit?order=10008-S001" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

One JSON object per line:

```json
{"ts": 1700000000, "status": 200, "reason": "ok", "kid": "p1", "order": "10008-S001",
 "ref": "aaaa…", "path": "amk/spec.md", "bytes": 16, "request_id": "9f2c1a7e4b8d0356"}
```

| Field | What it is |
|---|---|
| `ts` | when the request was answered |
| `status` | the HTTP status the caller got |
| `reason` | why: `ok`, `expired`, `revoked`, `path-denied`, `not-found`, `bad-signature`, `unknown-key`, `upstream-error`, `state-unavailable`, … |
| `kid` | the key id the link named |
| `order` | the work order the link was minted for |
| `ref` | the pinned commit |
| `path` | the file that was named |
| `bytes` | how many bytes were served |
| `request_id` | the correlation id, the same one as the `X-Request-Id` response header |

The record never holds the signature, the signing secret, the raw URL or the file content.
The trail is a bounded ring of `AUDIT_RETENTION` records, not an archive: **export it before
it turns over** if a longer record is needed.

Counters only, with no order, no path and no key id:

```sh
curl -sS https://<the host>/admin/metrics -H "Authorization: Bearer $OPERATOR_TOKEN"
```

---

## Incident response

| Symptom | What it means | What to do |
|---|---|---|
| `503` with `state-unavailable` | the Durable Object could not be read: the gateway cannot know whether an order is revoked or a budget spent | it fails closed, so nothing is served. Check the platform status and the Worker logs. **Do not disable the check.** The refusals are in the platform log, because the audit ring is unreachable too |
| `502 upstream-unauthorized` | the repository credential was refused | the token expired, was revoked, or lost its scope. Issue a new one and `wrangler secret put` it, then publish. Until then the gateway serves nothing |
| `502 upstream-error` | the provider failed | check the provider. The gateway retries nothing: a failure is a failure |
| `503 upstream-rate-limited` | the provider is rate limiting | back off. The budget here is the provider's, not the gateway's |
| `504 upstream-timeout` | the provider did not answer within `SOURCE_TIMEOUT_MS` | check the provider and the network path. The gateway serves nothing rather than serving something old |
| `429 rate-limited` for one order | the task is fetching more than the per-order budget | check how many files the task really needs; raise `RATE_LIMIT_PER_ORDER` if the answer is "more than the budget" |
| `429 cooldown` for one order | the order has been refused too many times and is cooling down | the audit trail for that order shows the refusals. Fix the client, then wait out the cooldown |
| many `bad-signature` records | something is guessing links, or a client is signing with the wrong key | `unknown-key` records mean the client is using a key id this gateway does not serve |
| `conformance_clock: true` on `/healthz` | **the test clock is on in a published environment** | treat it as an incident: a caller carrying `X-Conformance-Now` can extend the life of an expired link. Remove the variable, publish, and re-check `/healthz` |
| a key id on `/healthz` that should not be there | the environment is serving a key it was not configured with | the secrets and the configuration have drifted. Re-check `ops/environments.json`, re-set the secret, publish |
| a revoke that returned `503` | the order is **still live** | revoke again, and check the platform. Do not assume the capability died |

**The general rule:** the gateway fails closed. A misconfiguration, an unreachable state
store, an expired credential and an invalid link all end in a refusal, never in content. A
gateway that is failing is refusing, and a refusal is the safe outcome.

---

## Roll back

The gateway is versioned by the Worker deployment, so a rollback is a redeployment of a
previous version. Nothing else is involved: the Durable Object state is not versioned with
the code, and the revocation set is meant to survive a rollback.

**A rollback does not un-revoke anything.** The revocation set lives in the Durable Object and
is not touched by a deployment. If an order was revoked and the gateway is rolled back, the
order stays revoked. That is the safe direction to be wrong in.

**A rollback does not bring back a retired key id.** If a key was retired because its secret
leaked, rolling back to a version that still serves it would bring the leaked secret back
into service. Roll forward with a new key instead: the key id stays retired.

To roll back:

1. find the deployment to go back to:

   ```sh
   npx wrangler deployments list --env production
   ```

2. redeploy that version:

   ```sh
   npx wrangler rollback --env production <the deployment id>
   ```

   or, equivalently, `npx wrangler versions deploy <the version id> --env production`.

3. check the result:

   ```sh
   python3 ops/verify-deployment.py --env production --base-url https://<the host>
   ```

A rollback is an operator action, like a publication. It does not need the gate, because the
gate is about what may be published for the first time; but a rollback should be followed by
`ops/verify-deployment.py`, and the reason for it should be written down here, in the
repository's release notes, the same day.

**When to roll back rather than fix forward:** the deployment is serving the wrong thing -
the wrong key ids, the wrong policy, a configuration that was never meant to be published.
A failing provider, a failing credential and a failing state store are not reasons to roll
back: the previous version would fail the same way.

---

## What this runbook does not cover

- **The write gateway.** It is a scaffold (Stage 5) and has its own documentation under
  `gateway/write/docs/`.
- **The pilot.** The end-to-end pilot is Stage 6. It has its own acceptance document under
  `docs/pilot/`.
- **The consumer update path.** That is the shipped `update.sh`, and it is documented for
  consumers, not for the gateway operator.
- **The release itself.** The artifact, the tagging and the publication of the 0.5.0 release
  are Phase 7 and are documented in `docs/RELEASING.md`.
