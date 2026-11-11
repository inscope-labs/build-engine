# The compatibility-date review for the write gateway (R0-008's open half)

**Stage:** S5 of `docs/release/V0.6.0-ROLLOUT-PLAN.md`, work item 1: *"Review the
compatibility-date bump (R0-008) for the write gateway."*
**Reviewed:** 2026-11-11, against `main` at `c88bca9`.
**What is being reviewed:** the Workers `compatibility_date` the write gateway is deployed
with, and whether it should be bumped.
**What this document is:** a review and a recommendation. **The decision is the operator's**,
and it is recorded as an ADR (the repository's convention). Nothing here has been applied.

The read gateway's review (`COMPATIBILITY-DATE-REVIEW.md`, 2026-11-09) says of this one: *"It
should — but its Durable Object migrations and its audit stream are separate, and it is
deployed later, so it is S5's review as well as S5's change."* This is that review. **The
platform facts it rests on are the same ones, and are cited in section 7. What differs is
what the bump would touch.**

---

## 1. The question, and the short answer

The write gateway is pinned to `compatibility_date = "2025-09-01"`. R0-008's open half asks
for that date to be *"reviewed and bumped deliberately"*, and its evidence called the date
*"over a year old"*.

**The recommendation is: bump it, and keep the runtime's surface exactly as it is today.**

- **Bump** the date to the deployment date, because Cloudflare supports old dates forever, so
  there is no pressure from a deprecation — but the documentation Cloudflare publishes
  describes only the current date's behaviour, and this gateway is a security boundary whose
  behaviour must be readable from the documentation that describes it.
- **Keep the surface** by declaring `no_nodejs_compat` and `no_nodejs_compat_v2`, because the
  one behaviour change a bump to a date after 2026-08-04 brings is the Node.js compatibility
  layer switching on by default, and **the Worker's bundle uses none of it**.
- **Do it after staging is accepted**, so the bump is proved on the disposable environment
  before it reaches production.

**One thing is different from the read gateway, and it is the reason this review is not a
copy.** The write gateway **holds state**: two Durable Object classes, a task session per
work order and an audit stream of every commit, seal and revocation. The read gateway holds
a revocation set and an audit ring; the write gateway holds the *record of the decisions
taken about work*, and a sealed task's seal must survive a runtime change. Section 5 says
what has to be proved, and it is a stronger proof than the read gateway's.

---

## 2. The facts about this gateway

| | Value | Where |
|---|---|---|
| the date | `compatibility_date = "2025-09-01"` | `gateway/write/wrangler.toml` line 12 |
| the flags | **none declared** | the same file |
| is the file generated? | **no** — it is committed directly | there is no renderer for it, and `ops/render-environments.py` covers the read gateway only |
| the Durable Object classes | **two**: `TaskSession`, `AuditStream` | `gateway/write/wrangler.toml` lines 50-52 (and 118-119 for staging), both under `tag = "v1"` |
| the bundle's entry point | `main = "src/index.ts"` | line 7 |
| Node.js APIs in the bundle | **none** | `src/` imports no `node:` module; the only `node:` imports in the gateway are in `scripts/` (`verify-log-hygiene.ts` uses `node:fs`, `node:path`, `node:url`), and `scripts/` is **not** in the Worker's bundle — it runs in CI, on a machine |
| the crypto it uses | **WebCrypto only** — `crypto.subtle.importKey`, `crypto.subtle.sign`, `crypto.subtle.verify`, `crypto.subtle.digest` | `src/auth/signature.ts`, `src/util/hash.ts`, `src/router.ts` |

**The Node.js surface is worth spelling out, because it is the one place where a bump could
hurt.** `no_nodejs_compat` turns off the Node.js compatibility layer for the **Worker**. The
scripts that *do* use `node:fs` and `node:path` run under Node in CI and are unaffected by a
Workers compatibility flag. The bundle check (`npm run check:bundle`) builds the Worker for
every environment, so a script that found its way into the bundle would show up there.

---

## 3. What a bump would change in *this* gateway, and what it would not

### 3.1 It would not change

- **The Durable Object storage.** A migration is keyed by its **tag and its class**, not by the
  compatibility date. `new_sqlite_classes = ["TaskSession", "AuditStream"]` under `tag = "v1"`
  is a *creation* record: those classes already exist, and a date bump creates no new class
  and runs no migration. **A bump cannot invalidate a task session, a seal, an audit record or
  a revocation.** This is the same conclusion the read gateway's review reached for its single
  class, and it is the reason a bump is safe to make at all.
- **The protocol.** `ctxwrite-v1` is this gateway's own scheme identifier and is unaffected.
- **The signing.** WebCrypto is available on every compatibility date the Workers runtime has
  ever offered, and `crypto.subtle` is not a Node.js API.

### 3.2 It would change one thing

**The runtime's global surface.** With a date on or after 2026-08-04, `node:crypto`,
`node:buffer`, `node:stream`, `node:net`, `node:dns`, `node:fs` and `node:http` become
available inside the Worker whether or not it asks for them, and `nodejs_compat_v2` adds
polyfills and globals to the bundle.

For this gateway that is a **cost and no benefit**:

- it uses none of those APIs — its crypto is WebCrypto — so it gains nothing;
- the bundle grows with the v2 polyfills (the Workers docs note the v2 flag *"increases bundle
  size"*);
- and a Worker whose job is to accept a signed request, write one commit, seal it and refuse
  everything after the seal has no business exposing a Node.js filesystem, network and crypto
  surface it does not use.

`no_nodejs_compat` + `no_nodejs_compat_v2` turn it back off, and Cloudflare's own guidance is
that these two flags together *"turn off Node.js compatibility completely"*. With them, the
bump is a **change of bug-fix baseline only**: the runtime keeps serving, and the Worker's
observable behaviour is the same.

### 3.3 The recommendation, precisely

| | Value |
|---|---|
| `compatibility_date` | the deployment date (a date in the past; **2026-11-11** as of this review) |
| `compatibility_flags` | `["no_nodejs_compat", "no_nodejs_compat_v2"]` |
| Applied to | the write gateway, **after** staging has been deployed and accepted |
| Verified by | the deployed probes, the **signed pilot**, and the S5 exit-gate checks, re-run after the deploy |

**Why not simply leave the date alone?** It is defensible — Cloudflare supports it forever, and
"if it ain't broke". But the gateway's behaviour is then documented only in a compatibility
flags page, and the operator's own register calls the date out as stale. The cost of the bump
with the two flags is two lines and a deploy; the cost of leaving it is a permanent
documentation gap on a security boundary.

**Why not bump without the flags?** That would silently give a write gateway a Node.js
surface. The two are separable, so the operator can take either independently — but taking the
date without the flags buys nothing that the date with the flags does not already buy.

---

## 4. Exactly what has to change, in which file

**One file, two lines.** `gateway/write/wrangler.toml`:

```toml
compatibility_date = "2025-09-01"
compatibility_flags = ["no_nodejs_compat", "no_nodejs_compat_v2"]
```

The write gateway's `wrangler.toml` is **committed directly** — unlike the read gateway's,
which is generated from `ops/environments.json` and re-rendered. So there is no renderer to
re-run and no second file to keep in step. The change is self-contained, and the review's
"exactly what has to change" is two lines in one file.

**Nothing else changes.** The Durable Object migrations stay as they are (`tag = "v1"`, the two
classes); the key ids stay as they are; the protocol identifier stays as it is.

---

## 5. The proof that has to come with it

A compatibility-date bump is a runtime change, so it is proved like one — and for this gateway
the proof is stronger than the read gateway's, because this gateway's state is the record of
decisions about work:

1. **the local gate in full** — `release/rollout-gate.sh S5`, including the bundle check, which
   builds the Worker for every environment;
2. **staging first**: deploy the bumped build to staging, and re-run the deployed probes and
   the **signed pilot** against it;
3. **the state that must not be disturbed**: a **task sealed before the bump must still be
   sealed after it**, and the **audit stream must still carry the record** of the commit, the
   seal and the revocation that happened before the bump. A seal that can be written past
   because a runtime flag changed is not a seal;
4. **only then production**, with the environment's approval;
5. **the audit trail of the production run**, to show the Worker restarted on the new date and
   still serves.

**Point 3 is the one this gateway adds.** The read gateway's proof had to show that a revoked
link stays revoked; this one's must show that **a sealed task stays sealed** and that the
audit trail survives, because that is the state a bump must not disturb here. The signed pilot
is what produces that evidence: it commits, seals, and then proves the sealed task refuses a
further write.

---

## 6. What this review does not decide

- **The date.** The recommendation is "the deployment date". If the operator would rather pin a
  date earlier than the deployment, the same flags apply and the same proof applies.
- **Whether the two gateways take the same date.** They need not. They are deployed at
  different times, they hold different state, and the plan makes them separate stages. Taking
  them separately is what lets each be proved on its own staging environment first.
- **Whether R0-008's other half is closed.** It is: the `workers_dev` and `routes` halves were
  closed in Stage 4.3 (read gateway) and Stage 6.1 (write gateway), and the register says so.
  This review covers only the compatibility-date half.
- **The `scripts/` Node.js usage.** It is CI-side and unaffected by a Workers flag. It is
  recorded here only so that a later reader does not mistake it for a reason not to set the
  flags.

---

## 7. The sources

| What | Where |
|---|---|
| "The Workers runtime will support old compatibility dates forever"; "There is no need to update your `compatibility_date` if you do not want to"; the two costs of an old date | [Compatibility dates · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-dates/) |
| Every flag and its "Default as of" date | [Compatibility flags · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) |
| `nodejs_compat` and `nodejs_compat_v2` on by default from 2026-08-04; how to turn them off | [changelog, 2026-08-04](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/) and [Node.js compatibility · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) |
| "Set it to today's date … Periodically updating it … gives you access to new APIs and fixes without changing your code" | [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) |
| the read gateway's review of the same question | `docs/release/COMPATIBILITY-DATE-REVIEW.md` |
| the finding this review closes | `docs/release/DEFECT-REGISTER.md`, **R0-008** |
