# Operator Runbook

**Status: written.** The procedures below are executable against a deployed gateway. The gateway is
**not deployed yet** — the deployment is plan task 5.4.6 and the operational sign-off is Stage 6 — so
this document is a procedure, not a report of something that has happened.

**The contract is `ctxwrite-v1`**, in [`protocol.md`](protocol.md). The error semantics are in
[`error-catalog.md`](error-catalog.md). Where this runbook and the contract disagree, the contract
wins and this document is a defect. This runbook does not restate the rules; it says what to do.

**The three secrets, and what each one is for.**

| Secret | Where it lives | What it grants |
|---|---|---|
| `SIGNING_KEYS` | a Worker secret, a JSON map of key id to secret | the ability to **mint** capabilities. It does **not** grant operator rights. |
| `OPERATOR_TOKEN` | a Worker secret | the ability to use `/admin/*`: mint, revoke, close, reset a quota, read the audit stream, read the metrics. It does **not** grant the ability to mint a *signed* capability without `SIGNING_KEYS`. |
| `GITHUB_TOKEN` | a Worker secret | the gateway's write access to the submissions repository. It is **repository-scoped, not path-scoped**. |

Holding one does not imply holding another. A leaked `SIGNING_KEYS` mints capabilities; a leaked
`OPERATOR_TOKEN` reads the audit stream and revokes tasks; a leaked `GITHUB_TOKEN` can modify any
task's submissions in that repository and nothing else. The third is the one with the widest blast
radius, and the contract states that plainly (protocol section 12.4).

---

## 1. The operator-only routes

These are **not** part of the agent protocol. They are not hypermedia, they are not linked from any
agent response, and the agent has no credential for them. An agent that guesses the path is refused
with `401`.

| Route | Method | Credential | Effect |
|---|---|---|---|
| `{base}/healthz` | GET | none | liveness, version, protocol version, the effective policy, whether the test clock is on. No protected state. |
| `{base}/admin/mint` | POST | `OPERATOR_TOKEN` | mint a capability for a task. |
| `{base}/admin/revoke` | POST | `OPERATOR_TOKEN` | revoke a task: its capability is refused from then on. |
| `{base}/admin/close` | POST | `OPERATOR_TOKEN` | close a work order. |
| `{base}/admin/reset-quota` | POST | `OPERATOR_TOKEN` | reset a task's quota ledger after an eviction. |
| `{base}/admin/audit` | GET | `OPERATOR_TOKEN` | the redacted audit records of an order. |
| `{base}/admin/metrics` | GET | `OPERATOR_TOKEN` | the live counters of one Worker instance. |

Every call carries the credential in the `Authorization` header:

```bash
curl -sS -X POST https://<the gateway's host>/admin/revoke \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"task":"10008-1-001-01"}'
```

**The operator token belongs in a shell variable, never in a command line that is logged.** On a
shared machine, export it from a file with restrictive permissions, and unset it when you are done.

---

## 2. Before the first task

Two things, and neither is optional. Both are stated in the contract because they are part of the
credential boundary, not because the procedure is written here.

### 2.1 Prepare the destination

The submissions branch and the task folder must exist **before** the work order is issued, with a
`.keep` placeholder committed into the folder. Git does not store empty folders, so the placeholder
is how the folder exists.

```bash
git -C "$SUBMISSIONS" checkout "$BRANCH"
mkdir -p "plans/$PLAN/submissions/$ORDER/$TASK"
touch "plans/$PLAN/submissions/$ORDER/$TASK/.keep"
git -C "$SUBMISSIONS" add "plans/$PLAN/submissions/$ORDER/$TASK/.keep"
git -C "$SUBMISSIONS" commit -m "open the task folder for $ORDER/$TASK"
git -C "$SUBMISSIONS" push origin "$BRANCH"
```

**The gateway never creates a repository, a branch or a folder.** If the folder is missing at commit
time the commit is refused with `404 task-folder-missing`, and only the operator can fix it.

For a **throwaway** repository — a rehearsal, or a pilot's own sandbox — there is a tool that does
it, because doing it by hand is four commands that are easy to get subtly wrong:

```bash
GITHUB_TOKEN=… node --experimental-strip-types scripts/seed-test-repo.ts \
  --repo owner/name --branch build-engine --folder "plans/$PLAN/submissions/$ORDER/$TASK" \
  --i-understand-this-writes-to-a-real-repository
```

It writes the placeholder, creates the branch and **refuses to touch a branch that already
exists**. It reads the credential from the environment, never from an argument, and it is an
operator tool with a wider reach than the gateway's own client — it can create a branch, which the
gateway deliberately cannot.

### 2.2 Accept the residual transport risk in writing

The transport is a GET with side effects, and the residual risk of caching, prefetching and
intermediary logging of the request URL is **accepted, not eliminated** (ADR 0003, protocol 10.1).
The deployment must also be configured so that the platform's own logs do not retain the capability
path prefix.

This is a process step because it is the only honest way to discharge a risk the protocol cannot
remove. Write it down, with the date and the name of the person who accepted it.

---

## 3. Mint a capability

The agent never receives a credential. It receives a URL, and the URL is the credential.

```bash
curl -sS -X POST https://<the gateway's host>/admin/mint \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "10008-1-001-01",
    "order": "10008-S001",
    "plan": "castiel-dev",
    "writer": "agent-7",
    "head": "'"$(git -C "$SUBMISSIONS" rev-parse "$BRANCH")"'",
    "ttl": 3600
  }'
```

The answer is `{"capability": "https://…/w1/…", "exp": …, "kid": "k1"}`.

Four things about the parameters:

- **`head` is the branch's current commit sha.** It is bound into the signature, and the commit
  checks that the branch is still there before it writes. A capability minted against a stale head
  will commit and answer `409 expected-sha-conflict`. **One capability authorises one commit** — if
  the task needs a second commit, mint a new capability against the new head.
- **`ttl` is in seconds** and is capped by the gateway's `max_ttl` (7 days by default). A longer
  request is refused with `403 ttl-exceeded`.
- **`kid` names a signing key**, and several may be served at once. See the rotation procedure.
- **`writer` is the agent's identity**, and the gateway enforces one writer per task: a second
  writer is refused with `409 writer-conflict`.

**Do not put the capability anywhere that is logged, shared, or pasted into a chat.** It is a bearer
credential: anyone holding it can do what the agent can do, for that task, until it expires.

There is also an **offline** mint, for the cases where the gateway is not the thing to ask — a
rehearsal against a local harness, or a capability that is minted on the operator's own machine and
handed to the agent afterwards. It signs with the **shipped** signing code, so a capability minted
this way is exactly one the gateway verifies:

```bash
SIGNING_KEYS='{"k1":"…"}' node --experimental-strip-types scripts/mint-root-url.ts \
  --task "$TASK" --order "$ORDER" --plan "$PLAN" --writer "agent-7" \
  --head "$(git -C "$SUBMISSIONS" rev-parse "$BRANCH")"
```

The signing keys come from the environment and never from an argument, so the secret does not end
up in the shell history or in the process list, and the script never prints them.

---

## 4. Monitor a running task

```bash
# the counters of one Worker instance
curl -sS https://<the gateway's host>/admin/metrics -H "Authorization: Bearer $OPERATOR_TOKEN"

# the audit records of an order, most recent last
curl -sS "https://<the gateway's host>/admin/audit?order=10008-S001" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"

# only the last ten records
curl -sS "https://<the gateway's host>/admin/audit?order=10008-S001&limit=10" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"

# only what happened since a point in time
curl -sS "https://<the gateway's host>/admin/audit?order=10008-S001&since=$(date +%s)" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

**What the counters are and are not.** The metrics endpoint reports the counters of **one Worker
instance**, and a Worker has many. The body says `scope: worker-instance`, and it means it: the
numbers are a live view of one isolate, not a total. The durable totals are the audit stream.

**What the audit stream is and is not.** The platform's log is the **complete** stream — every
request writes exactly one line there, including the requests that never authenticated. The
durable stream at `/admin/audit` holds the records that belong to **one order**, and it is bounded:
the oldest records are pruned after `AUDIT_RETENTION_SECONDS` (one day by default). To watch the
refusals that never reached a session, read the platform's log or the counters.

**The records are redacted, and that is the point.** A record carries the identifiers, the counts
and the reason. It never carries the file's name, the file's content, the capability, the query
string or the provider's error text. A commit's record carries the commit's sha and a digest of the
selection, so two commits can be compared and one can be correlated with the commit record — but
the selection's paths are in the session's commit record, not in the audit stream.

---

## 5. Revoke a task, close a work order

```bash
# revoke one task: its capability is refused from then on
curl -sS -X POST https://<the gateway's host>/admin/revoke \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"task":"10008-1-001-01"}'

# close a work order
curl -sS -X POST https://<the gateway's host>/admin/close \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"task":"10008-1-001-01"}'
```

**The three closures are three different things**, and the codes say which one happened:

| Closure | Who caused it | What the agent sees afterwards | When to use it |
|---|---|---|---|
| `sealed` | the agent | `410 task-sealed` | the agent finished. Nothing to do. |
| `revoked` | you | `410 task-revoked` | the task was hostile, or it was a mistake. The agent stops. |
| `closed` | you | `410 order-closed` | the work order is over. The agent stops. |

**Revocation is not reversible.** There is no un-revoke: the session's state is `revoked` and stays
`revoked`. If the task is legitimate, mint a new capability for a new task.

**A revocation does not delete anything.** The staged content is ephemeral and disappears with the
instance; the commit that was already made is in the repository and stays there.

**Revoke when**: the capability leaked, the agent is misbehaving, the task was issued to the wrong
agent, or the work is abandoned. **Close when** the work order is finished for reasons that are not
the task's fault.

### 5.1 Reset a quota after an eviction

An isolate eviction loses the staged **content** and keeps the **inventory** (ADR 0001). The session
reports the difference: the file is still listed, its content is not there, and the agent has to
stage it again. The bytes are released automatically when the loss is noticed.

```bash
curl -sS -X POST https://<the gateway's host>/admin/reset-quota \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"task":"10008-1-001-01"}'
```

**Only do this if the ledger and the reality disagree.** The ledger is reconciled against the
inventory every time the session loads, so a reset is almost never needed. A reset clears the live
file count and the live byte count but keeps the cumulative counters, so the audit trail still says
how much was accepted in total.

---

## 6. Rotate a secret

### 6.1 Rotate a signing key — no outage

Several key ids are served at once, so a signing key rotates without an outage.

1. Add the new key to the secret, keeping the old one:

   ```bash
   printf '%s' '{"k1":"<the old secret>","k2":"<the new secret>"}' | \
     npx wrangler secret put SIGNING_KEYS
   ```

2. Mint new capabilities with `"kid": "k2"`. Capabilities signed under `k1` keep working.
3. Wait for the longest capability minted under `k1` to expire. The answer to `/admin/mint` carries
   `exp`, and the gateway's `max_ttl` bounds how long that can be.
4. Remove `k1`:

   ```bash
   printf '%s' '{"k2":"<the new secret>"}' | npx wrangler secret put SIGNING_KEYS
   ```

**A capability whose kid the gateway does not know is refused with `401 not-authorised`**, before
anything else happens, and the refusal is the same body as every other pre-signature failure. So
removing a key id *revokes every capability signed with it, immediately*. That is the lever to pull
in an incident; see section 8.

### 6.2 Rotate the provider credential

The GitHub credential is a single secret, so its rotation has a window.

1. Mint a new token with the **same scope**: the submissions repository, and as narrowly as GitHub
   allows. The scope is repository-scoped, not path-scoped.
2. Put it: `printf '%s' "$NEW_TOKEN" | npx wrangler secret put GITHUB_TOKEN`.
3. The old token is dead from that moment. Any commit in flight fails with
   `502 provider-credential-invalid`, which is **not retryable** — the agent stops and tells the
   operator, which is the correct behaviour, because a retry cannot fix a credential.
4. Revoke the old token in GitHub.

**The token's scope is the operator's responsibility, not the code's.** The gateway can only reach
one repository and one branch, but a leaked token can reach every task's folder in that
repository. `scripts/check-token-scope.ts` checks the credential's scope; it was written in
Stage 5.5 and it has two halves.

The **static** half runs in CI on every pull request, and it needs no credential: the provider
client's method list is the credential's entire reach inside this codebase, and a method that
created a branch, merged, deleted or force-pushed would widen it. Run it yourself with:

    cd gateway/write && npm run check:token-scope -- --static

The **live** half asks GitHub what scopes the credential carries, and it is the operator's to run
before a deployment:

    GITHUB_TOKEN=… node --experimental-strip-types scripts/check-token-scope.ts

It refuses a credential that carries a scope the gateway has no business holding — `workflow`,
`admin:*`, `delete_repo`, `write:packages` and the rest — and it **fails closed** when the scopes
cannot be determined, which is what a fine-grained token looks like from the outside. Note what the
check reports about a classic token: the `repo` scope reaches every repository the account can
reach, not only the submissions repository. That is the residual risk the contract records in
section 12.4, and the check says so rather than hiding it.

### 6.3 Rotate the operator token

Also a single secret, and also with a window.

1. `printf '%s' "$NEW_OPERATOR_TOKEN" | npx wrangler secret put OPERATOR_TOKEN`.
2. Update whatever holds the old value — your shell, your runbook, your monitoring.
3. The old value is dead from step 1. An operator call with it answers `401`.

**There is no second operator token.** That is a deliberate simplification and it is a real
limitation: the operator token cannot be rotated without a brief window in which the old one is
dead and the new one is not yet in your hands. If that window is unacceptable, the answer is a
second token and a change to the contract, not a workaround.

---

## 7. Deploy

The deployment is a workflow, and the workflow is not reachable from a pull request.

| | |
|---|---|
| the trigger | a push to `main`, or a manual `workflow_dispatch` |
| the credentials | the `production` **environment's** secrets, not the repository's |
| the gate | the whole test suite, the contract consistency check, and the log hygiene gate |
| the protection | the `production` environment can require reviewers, so a deployment is a decision |

```bash
# the gate on its own, before you push
cd gateway/write
npm ci
npm run typecheck
npm test
npm run verify:log-hygiene
```

**The gate checks four things**, and it is the same code the unit test uses, so the gate and the
test cannot drift apart:

1. no sentinel — a signing secret, a provider token, an operator token, the capability, the
   signature, the file's content, its base64, or a file name — appears in any log line, failure
   body, metric or audit record;
2. the gateway's own source contains no credential-shaped value, and nothing but the audit logger
   writes to the platform's log;
3. no workflow that a pull request can trigger holds a deployment credential.

**After the deployment, check it by hand.** The workflow does not probe the deployed gateway,
because the operator's host name is the operator's decision. Do it once, and record it:

```bash
curl -sS https://<the gateway's host>/healthz
```

The answer carries the version, the protocol, the effective policy and whether the test clock is
engaged. **`conformance_clock` must be `false` in production.** A deployed gateway with the test
clock on would let a caller extend the life of an expired capability.

### 7.1 The deployment defaults

Pinned in `wrangler.toml`, and checked by the contract (section 12.5):

| Setting | Value | Why |
|---|---|---|
| `workers_dev` | `false` | a first deploy must not silently expose a public `*.workers.dev` URL |
| `routes` | explicit, operator-named | the gateway must be on a host the operator controls |
| `compatibility_date` | pinned | a pinned-but-stale date is its own risk; bump it deliberately |
| secrets | `wrangler secret put` | never in `wrangler.toml` |
| deployment credentials | the environment's, never the repository's | a pull request must not be able to reach them |

`workers_dev` is a **setting**, not a variable, and a TOML setting belongs to the table it is
written in. A `workers_dev = false` written after the `[vars]` table is an ordinary variable
named `workers_dev`, the setting stays unset, and wrangler's default exposes the gateway on a
public `*.workers.dev` URL anyway. That was F0-070. The gate
`npm run check:staging` refuses that configuration, and it runs on every pull request.

### 7.2 The staging environment

Stage 6.1 established a **staging** environment: a separate Worker, with its own Durable Object
namespaces, its own keys and its own destination, for the pilot and for operational rehearsal.
It is disposable, and it holds nothing of the operator's.

```sh
cd gateway/write

# the destination, the disposable branch, seeded by the operator
python3 ../../ops/staging-estate.py create --i-understand-this-creates-real-branches

# the gate, which publishes nothing
npm run check:staging

# the secrets, once
npx wrangler secret put --env staging SIGNING_KEYS    # {"sk1": "<a fresh secret>"}
npx wrangler secret put --env staging GITHUB_TOKEN     # scoped to the staging destination
npx wrangler secret put --env staging OPERATOR_TOKEN  # a fresh bearer token

# publish
npx wrangler deploy --env staging

# and check what was published
npm run check:staging -- --base-url https://<the staging host>
```

The separation is a property of the configuration, and it is checked rather than assumed:

| Rule | Checked by |
|---|---|
| a different Worker, so a different Durable Object namespace | `npm run check:staging` |
| disjoint key ids, so a capability minted for one is refused by the other | `npm run check:staging` |
| a different submissions repository and branch | `npm run check:staging` |
| the staging deployment declares the production repository and refuses to start if it is pointed at it | the gateway itself, at startup |
| the published gateway serves the key ids and the destination it was configured for | `npm run check:staging -- --base-url …` |

**`/healthz` says which environment it is.** A pilot that cannot tell staging from production
is not a pilot:

```sh
curl -s https://<the host>/healthz | python3 -m json.tool | grep deploy_env
```

### 7.3 Throwing the staging environment away

```sh
python3 ../../ops/staging-estate.py dispose --i-understand-this-deletes-branches
npx wrangler delete --env staging
```

The estate is disposable, and disposing of it is part of the stage that used it, not a chore
for later.

---

## 8. Respond to an incident

### 8.1 A capability may have leaked

1. **Revoke the task.** `POST /admin/revoke`. The capability is refused from that moment.
2. **Check what the leaked capability did.** The audit stream for the order shows the requests. The
   record of a commit carries the commit's sha; look that sha up in the submissions repository.
3. **If a commit was made that should not have been**, the gateway cannot undo it — it never
   rewrites history. Revert it in the repository, by hand, as a normal commit.
4. **Rotate the signing key** if the leak was the key rather than the URL (section 6.1). Removing
   the key id revokes every capability signed with it, immediately.

### 8.2 The gateway looks like it is under attack

1. **Look at the counters.** `not-authorised` counts the requests that never authenticated. A
   rising count with a flat `requests` is the shape of a credential-guessing attack.
2. **Read the platform's log.** The durable stream does not hold the requests that never
   authenticated; the log does.
3. **The rate limit is the first line of defence.** 30 requests per 60 seconds per task, and one
   writer at a time. A flood of refusals costs the attacker the gateway's time and nothing else.
4. **The blast radius of a pre-signature refusal is zero.** Every pre-signature failure answers
   `401` with the same body, so a caller who cannot authenticate learns nothing about which check
   failed, and nothing about the task.

### 8.3 A commit's outcome is unknown

`409 reconcile-required` means the gateway could not tell whether its commit landed, and it
**refused to guess**. It happens when the branch moved while a commit was in flight, or when a
provider call timed out and the branch could not be read afterwards.

1. Look at the branch: `git -C "$SUBMISSIONS" log --oneline -5 "$BRANCH"`.
2. If the commit is there, the delivery worked. Nothing to do.
3. If it is not there, the delivery did not work. The agent can retry with the **same** idempotency
   key, and the gateway will either deliver it or refuse again. It will not create a second commit
   without saying so.
4. If the branch holds a commit that is not yours, another writer got there first. That is what
   `expected-sha-conflict` is for, and the answer is to mint a fresh capability against the current
   head.

### 8.4 The gateway is not answering

1. `GET /healthz`. If it answers, the gateway is up and the problem is in front of it.
2. If it does not, look at the platform's log and at the deployment's own status.
3. The state channel **fails closed**: an unreadable Durable Object answers `503
   state-unavailable` and serves nothing. It never falls back to "allow".

---

## 9. The error semantics, in one table

The catalogue is the authority; this is the operator's reading of it.

| Status | Codes | What it means | What the operator does |
|---|---|---|---|
| 400 | `unknown-operation`, `unknown-parameter`, `repeated-parameter`, `empty-selection`, `type-mismatch`, `hash-mismatch`, `not-utf8`, `not-text`, `type-not-allowed`, `schema-invalid`, `empty-not-allowed`, `destination-not-selectable`, `malformed-path`, `invalid-parameter` | the request is malformed | nothing. The agent fixes the request. If it keeps happening, the agent's tool prompt is wrong. |
| 401 | `not-authorised` | no valid capability was presented | the capability is wrong, expired, signed under a retired key, or the path is malformed. All four look the same, on purpose. |
| 403 | `capability-expired`, `ttl-exceeded`, `not-permitted` | a valid capability that may not proceed | mint a new one. An expired capability is the normal end of a task. |
| 404 | `file-not-found`, `task-folder-missing` | after a valid capability, something is not there | `task-folder-missing` is the operator's: create the folder (section 2.1). `file-not-found` is the agent's. |
| 405 | `method-not-allowed` | the wrong method | this protocol is GET only. |
| 409 | `writer-conflict`, `path-exists`, `sequence-gap`, `sequence-conflict`, `idempotency-conflict`, `file-not-staged`, `file-count-exceeded`, `expected-sha-conflict`, `seal-requires-commit`, `reconcile-required` | the request disagrees with the current state | the agent adjusts, except `reconcile-required`, which is a human (section 8.3). |
| 410 | `task-sealed`, `task-revoked`, `order-closed` | the task's write path is closed | the agent stops. Which of the three says who closed it. |
| 413 | `file-too-large`, `total-bytes-exceeded` | a size quota | the agent writes less, or fewer files. |
| 429 | `rate-limited`, `provider-rate-limited` | a rate quota | `rate-limited` is the agent asking too often. `provider-rate-limited` is the provider throttling the **gateway**: only the operator can fix that. |
| 5xx | `provider-rejected`, `provider-credential-invalid`, `provider-unavailable`, `gateway-misconfigured`, `state-unavailable` | the gateway or the provider could not do it | `provider-credential-invalid` is section 6.2. `gateway-misconfigured` names the setting that is wrong. `provider-unavailable` is retryable. |

---

## 10. What this runbook does not cover

- **The submissions-to-consumer transfer path** is register entry R0-011 and is not designed. The
  gateway commits into the submissions repository; what happens after that is not part of this
  release.
- **The pilot procedure** is Stage 6, and the sign-off with it.
- **The scope of the token itself** is the operator's responsibility. The check that exists
  (Stage 5.5, `scripts/check-token-scope.ts`) confirms that the credential carries no scope the
  gateway does not need and that the code does not widen its reach; it cannot make a classic
  `repo` token narrower than GitHub makes it.
