# Read gateway: limits and abuse controls

What the gateway refuses, how much of it it will do, and what the operator does when a limit is
hit. The numbers live in `wrangler.toml`; this document says what they mean and what they cost.

The controls are a property of the deployment, not of the scheme. `conformance/SCHEME.md` says
nothing about them, and the conformance suite does not test them: a port that has no rate limits
still conforms. That is why they are documented and tested here instead.

## The ceilings

Two values are policy rather than configuration. A deployment that asks for more is refused at
startup, and the gateway then serves nothing at all.

| Setting | Ceiling | Why |
|---|---|---|
| `MAX_TTL` | 259200 s (72 h) | the longest a context capability may live |
| `CLOCK_SKEW_TOLERANCE` | 120 s | how far the gateway's clock may lag the minter's |

`CLOCK_SKEW_TOLERANCE` is applied to the expiry comparison only: a link is refused once
`now > exp + tolerance`. It does not extend a link's lifetime in any other place, and it is
reported on `/healthz` so that a verifier can see the real value rather than the intended one.

## The budgets

All three budgets are per 60-second window, and all three are counted in the Durable Object.

| Setting | Default | What it bounds |
|---|---|---|
| `RATE_LIMIT_PER_ORDER` | 120 | how much one work order may fetch in a window |
| `RATE_LIMIT_PER_IP` | 600 | how much one caller address may fetch in a window |
| `RATE_LIMIT_GLOBAL` | 2000 | how much the gateway serves in a window |
| `REFUSAL_BURST` | 60 | authenticated refusals for one order before it is cooled down |
| `REFUSAL_COOLDOWN_SECONDS` | 300 | how long that cooldown lasts |
| `AUDIT_RETENTION` | 500 | how many audit records are kept |

A task that legitimately fetches many context files can hit the per-order budget. That is the
trade: the budget is per order, not per file, so a task that fetches forty files has forty
requests against one order. Raise `RATE_LIMIT_PER_ORDER` if the real workload needs it; do not
raise it far enough to make the budget meaningless.

## The order of the checks

The resource controls sit around the scheme's checks, not inside them:

1. the method must be `GET` or `HEAD`;
2. the state is read: the per-IP and global budgets are checked, and the revocation list is
   read. **If the state cannot be read, the request is refused with `503 state-unavailable`**
   (see "When the state store is unavailable" below);
3. the link is parsed, and its key id, signature, expiry, lifetime, revocation and path policy
   are checked in the order `conformance/SCHEME.md` section 7 gives;
4. the per-order budget and the order's cooldown are checked, after the signature has verified;
5. the file is read, and the audit record is written last, carrying the final outcome.

Two consequences follow from step 4 being after the signature:

- **A forger cannot spend a real order's budget.** The order in a link the gateway cannot verify
  is just a string the caller chose, so it is never counted against anybody.
- **A forger cannot put a real order in a cooldown.** The refusal burst counts only refusals
  that happened *after* the signature verified. A flood of forged links is bounded by the per-IP
  and global budgets instead.

The cost of that choice is that a flood of forged links is charged to the caller's address
rather than to the order it names. If the gateway is being used as a signing oracle, the answer
is a smaller per-IP budget, not a scheme change.

## When the state store is unavailable

The revocation set, the audit ring and the counters all live in one Durable Object. If that
object cannot be read, the gateway **cannot know** whether the order in the link has been
revoked, and it cannot know whether a budget has been spent. It therefore refuses every
request with `503` and the reason `state-unavailable`.

The alternative - treating an unreadable state store as an empty one - is how a revoked
capability keeps working. "There are no revocations" is a fact the store can answer; "I could
not read the revocations" is an absence of information, and an absence of information is not
consent. The same reasoning applies to the budgets: a budget that cannot be read is not an
exhausted budget, but it is certainly not an unlimited one.

While the state store is down the audit ring is down too, so the refusals are written to the
platform log instead. The record is the same record the ring would have held: it has no
signature, no secret and no content in it. **A state-store outage costs availability, and
nothing else.** It cannot serve a file, and it cannot lose a revocation.

The operator channel fails the same way. A `POST /admin/revoke` that the state store did not
accept is reported as a failure, never as a revocation: an operator who is told "revoked"
stops watching that order.

## The budgets per environment

The numbers in the table above are the defaults. Each environment sets its own in
`ops/environments.json`, and the values that are actually in force are reported on
`/healthz`, so a verifier can test the gateway as it is configured rather than as it was
intended to be.

| Environment | `RATE_LIMIT_PER_ORDER` | `RATE_LIMIT_PER_IP` | `RATE_LIMIT_GLOBAL` |
|---|---|---|---|
| `test` | 120 | 600 | 2000 |
| `staging` | 120 | 600 | 2000 |
| `production` | 120 | 600 | 2000 |

Staging is deliberately not tighter: the pilot has to exercise the same limits production
has, or the pilot proves nothing about production. Staging is disposable, so a flood there
costs nothing; production is not, and the budgets are the operator's to change in
`environments.json` when the real workload says so.

## The refusal burst and the cooldown

When an order accumulates more than `REFUSAL_BURST` authenticated refusals in a window, the
order is put in a cooldown for `REFUSAL_COOLDOWN_SECONDS`. While the cooldown lasts, every
request for that order is answered with `429` and the reason `cooldown`, including requests that
are otherwise perfectly valid.

The refusals that count are the ones that say something about the order: `expired`,
`ttl-too-long`, `revoked`, `path-denied`, `not-found`, `too-large`, `rate-limited` and the
upstream errors. A refusal that happened before the signature verified — `malformed`,
`unknown-key`, `bad-signature` — is not counted against any order.

The typical cause is a client that keeps using an expired link, or a task that has been revoked
and whose agent has not noticed. The cooldown is meant to make that visible rather than to make
it silent.

## What the operator sees

Every request produces exactly one audit record, whatever the outcome, and the record is written
**after** the file read so that it carries the final answer. The record holds: the timestamp, the
status, the reason, the key id, the order, the ref, the path, the byte count and the request id.

The record never holds the signature, the signing secret, the raw request URL, the file content
or the repository credential. The audit trail is readable by anybody who can reach the admin
channel, so it must not become a second copy of the capability.

`GET /admin/metrics` returns counters only — how many records there are, how many refusals by
reason, how many orders are revoked. It holds no order, no path and no key id.

## What to do when a limit is hit

| Symptom | Likely cause | What to do |
|---|---|---|
| `429`, reason `rate-limited`, for one order | the task is fetching more than the per-order budget | check how many files the task really needs; raise `RATE_LIMIT_PER_ORDER` if the answer is "more than 120" |
| `429`, reason `cooldown` | the order is being refused repeatedly, and has been cooled down | look at the audit trail for that order; it will show the refusals that caused it. Fix the client, then wait for the cooldown to expire |
| `429`, reason `rate-limited`, for many orders at once | a flood from one address | the per-IP budget is doing its job. If the traffic is legitimate, the gateway is being used by a NAT or a proxy; that is a deployment question, not a scheme question |
| the audit trail has many `bad-signature` records | something is guessing links, or a client is signing with the wrong key | check the key ids in use; `unknown-key` records mean the client is using a key id the gateway does not have |

## Rotation and revocation

Revoking an order takes effect on the next request: the revocation set is held in the Durable
Object, not in a cache, precisely so that a revoked capability stops working at once rather than
up to a cache TTL later. `POST /admin/revoke` with `{"order": "..."}` is the operator's
interface. The documented bound is **two seconds**, and the staging checks measure it on every
run: the revocation is refused on the first request after the revoke, and the measurement is
asserted rather than assumed.

The revocation set is durable: it survives a deployment, a restart and a key rotation, because
it lives in the Durable Object and not in the Worker process. A rollback does not un-revoke
anything, and that is the safe direction to be wrong in.

Key rotation is a matter of minting with a new key id and removing the old secret from
`SIGNING_KEYS`. A link signed with a removed key id is refused with `unknown-key` as soon as the
new configuration is deployed. Because the gateway serves several key ids at once, rotation does
not need an outage: add the new key id, switch the minter, then remove the old one. The
procedure is in `runbook.md`.

The audit ring is bounded, not archived. `AUDIT_RETENTION` records are kept; older ones are
dropped. If the operator needs a longer record, the ring has to be exported before it turns
over — there is no archive behind it.
