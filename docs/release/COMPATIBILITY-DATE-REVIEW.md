# The compatibility-date review for the read gateway (R0-008's open half)

**Stage:** S4 of `docs/release/V0.6.0-ROLLOUT-PLAN.md`, work item 1: *"Review the
compatibility-date bump (R0-008 open half) for the read gateway."*
**Reviewed:** 2026-11-09, against `main` at `83e15e15`.
**What is being reviewed:** the Workers `compatibility_date` the read gateway is deployed
with, and whether it should be bumped.
**What this document is:** a review and a recommendation. **The decision is the operator's**,
and it is recorded as an ADR (the repository's convention). Nothing here has been applied.

---

## 1. The question, and the short answer

The read gateway is pinned to `compatibility_date = "2025-09-01"`. R0-008's open half asks for
that date to be *"reviewed and bumped deliberately"*, and its evidence called the date *"over
a year old"*.

**The recommendation is: bump it, and keep the runtime's surface exactly as it is today.**

- **Bump** the date to the deployment date, because Cloudflare supports old dates forever, so
  there is no pressure from a deprecation — but the *documentation* Cloudflare publishes
  describes only the current date's behaviour, and this gateway is a security boundary whose
  behaviour must be readable from the documentation that describes it.
- **Keep the surface** by declaring `no_nodejs_compat` and `no_nodejs_compat_v2`, because the
  one behaviour change a bump to a date after 2026-08-04 brings is the Node.js compatibility
  layer switching on by default, and this gateway uses no Node.js API at all.
- **Do it after staging is accepted**, so the bump is proved on the disposable environment
  before it reaches production.

The write gateway's date is **S5's**: it has its own Durable Object migrations and its own
audit stream, and the two gateways are deployed at different times. The same date and the same
flags should be applied there, and the same proof should be run.

---

## 2. What the platform actually does (the facts, and where they come from)

### 2.1 An old date is never withdrawn

> "The Workers runtime will support old compatibility dates forever. If, for some reason,
> Cloudflare finds it is necessary to make a change that will break live Workers, Cloudflare
> will actively contact affected developers."
> — [Compatibility dates · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)

> "There is no need to update your `compatibility_date` if you do not want to."
> — same page

So the register's phrase *"the runtime date is over a year old"* describes **staleness**, not a
deprecation risk. **Nothing breaks if the date is left alone.** That matters: it means the
decision is about hygiene, and it can be taken on the operator's schedule rather than under
pressure.

### 2.2 What staleness does cost

The same page gives the two costs of an old date:

> "Sometimes, new features can only be made available to Workers that have a current
> `compatibility_date`."
>
> "Generally, other than the compatibility flags page, the Workers documentation may only
> describe the current `compatibility_date`, omitting information about historical behavior.
> If your Worker uses an old `compatibility_date`, you will need to continuously refer to the
> compatibility flags page in order to check if any of the APIs you are using have changed."

For a gateway that hands out signed, short-lived, read-only capability links, "the behaviour
must be checkable from the published documentation" is worth something. The **Workers
Best Practices** page says the same thing from the other side: *"Set it to today's date on new
projects … Periodically updating it on existing projects gives you access to new APIs and fixes
without changing your code."*

### 2.3 The flags between 2025-09-01 and today

From [Compatibility flags · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
and [Node.js compatibility is now enabled by default (2026-08-04)](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/):

| Flag | Default as of | Effect on this gateway |
|---|---|---|
| `remove_nodejs_compat_eol` | **2025-09-01** | **Already in force** — it is today's date. No change. |
| `remove_nodejs_compat_eol_v22` | 2027-04-30 | After any candidate date. No change. |
| `nodejs_compat` | **2026-08-04** | **The one that matters.** It switches **on by default**, together with `nodejs_compat_v2`. |
| `nodejs_compat_v2` | **2026-08-04** | As above. |

> "Workers now enable the `nodejs_compat` and `nodejs_compat_v2` compatibility flags by
> default for compatibility dates of `2026-08-04` or later. … This means all Node.js built-in
> APIs supported by the Workers runtime are available by default, including `node:crypto`,
> `node:buffer`, `node:stream`, `node:net`, `node:dns`, `node:fs`, `node:http`, and more."
> — [changelog, 2026-08-04](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)

And the way to turn it back off, from the same source:

> "To turn off Node.js compatibility completely, remove any `nodejs_compat` and
> `nodejs_compat_v2` flags. Then add both of the following flags:
> `no_nodejs_compat`, `no_nodejs_compat_v2`"

**This is the whole of the change.** Every other flag whose default falls in the window either
does not apply (the Node.js end-of-life removals are already in force) or lands after the
candidate date.

---

## 3. What a bump would change in *this* gateway, and what it would not

### 3.1 It would not change

- **The Durable Object's storage, its migrations, or anything in them.** The read gateway's
  migrations are `tag = "v1"`, `new_sqlite_classes = ["GatewayState"]`
  (`gateway/read/production/wrangler.toml`). A Durable Object migration is keyed by its **tag
  and its class**, not by the compatibility date, so a date bump adds no migration and moves
  no storage. **The revocation set, the audit trail and the rate-limit counters are untouched.**
  This is the property that matters most: a bump cannot invalidate a revocation.
- **The signing scheme, the capability format, the key ids, the TTLs, or the clock skew
  tolerance.** Those are this repository's own contract, not the runtime's
  (`conformance/SCHEME.md`, `gateway/read/production/docs/`).
- **The read gateway's source.** The bump needs no code change: the gateway uses no Node.js
  API, so no flag it inherits changes anything it calls. Verified: a search of
  `gateway/read/production/src/` for `nodejs_compat`, `require("node:`, `from "node:`,
  `process.` and `Buffer` returns exactly one hit, `new Uint8Array(await
  response.arrayBuffer())` in `src/source.ts`, which is a **web standard**, not a Node API.
- **The exposed policy.** `clock_skew_tolerance`, `max_ttl`, `max_bytes`, `key_ids` and
  `scheme` are the gateway's own configuration and are reported on `/healthz`; the runtime
  date is not among them.

### 3.2 It would change one thing

**The runtime's global surface.** With a date on or after 2026-08-04, `node:crypto`,
`node:buffer`, `node:stream`, `node:net`, `node:dns`, `node:fs` and `node:http` become
available inside the Worker, whether or not it asks for them, and `nodejs_compat_v2` adds
polyfills and globals to the bundle.

For this gateway that is a **cost and no benefit**:

- it uses none of those APIs, so it gains nothing;
- the bundle grows with the v2 polyfills (the Workers docs note the v2 flag *"increases bundle
  size"*);
- and a Worker whose entire job is to mint and serve signed, read-only, short-lived
  capability links has no business exposing a Node.js filesystem, network and crypto surface it
  does not use.

`no_nodejs_compat` + `no_nodejs_compat_v2` turn it back off, and Cloudflare's own guidance is
that these two flags together *"turn off Node.js compatibility completely"*. With them, the
bump is a **change of bug-fix baseline only**: the runtime keeps serving, and the Worker's
observable behaviour is the same.

### 3.3 The recommendation, precisely

| | Value |
|---|---|
| `compatibility_date` | the deployment date (a date in the past; **2026-11-09** as of this review) |
| `compatibility_flags` | `["no_nodejs_compat", "no_nodejs_compat_v2"]` |
| Applied to | the read gateway, **after** staging has been deployed and accepted |
| Verified by | the deployed probes (`S4-PROBES`) and the deployed conformance run, re-run after the deploy |

**Why not simply leave the date alone?** It is defensible — Cloudflare supports it forever, and
"if it ain't broke". But the gateway's behaviour is then documented only in a compatibility
flags page, and the operator's own register calls the date out as stale. The cost of the bump
with the two flags is two lines and a deploy; the cost of leaving it is a permanent
documentation gap on a security boundary.

**Why not bump without the flags?** That would silently give a read-only link gateway a Node.js
surface. The two are separable, so the operator can take either independently — but taking the
date without the flags buys nothing that the date with the flags does not already buy.

---

## 4. Exactly what has to change, in which file

The read gateway's `wrangler.toml` is **generated**, and `ops/environments.json` is the single
source for it. The date therefore lives in the renderer:

- `gateway/read/production/ops/render-environments.py`, the `render()` function, the line that
  currently reads:

      out.append("compatibility_date = \"2025-09-01\"")

  It becomes the deployment date, and the renderer must also emit the flags (it emits **no**
  `compatibility_flags` today, so this is a new line in the rendered output):

      out.append("compatibility_flags = [\"no_nodejs_compat\", \"no_nodejs_compat_v2\"]")

- `gateway/read/production/wrangler.toml` is then **regenerated**, not hand-edited:
  `npm run ops:render` (`python3 ops/render-environments.py`).

- The renderer's `--check` must then pass — `npm run ops:check` — because the renderer refuses
  a `wrangler.toml` that has drifted from `ops/environments.json`, and that check is a CI job
  (`read gateway (typecheck, unit, conformance)`).

- The bundle must still build for every environment: `npm run check:bundle`.

**The write gateway** is not generated: its date is in `gateway/write/wrangler.toml` line 12,
and the same two changes apply. That is **S5's** work.

**The change is a protected-path change** in the sense that it changes what is deployed, and it
must be applied on a branch, reviewed, and merged by the operator.

---

## 5. The proof that has to come with it

A compatibility-date bump is a runtime change, so it is proved like one:

1. the local gate in full — `release/rollout-gate.sh S4`, including `C-READ` (the bundle check
   builds the Worker for every environment);
2. **staging first**: deploy the bumped build to staging, and re-run the deployed probes
   (`release/rollout-gate.sh S4`'s `S4-PROBES`, and the staged conformance run);
3. **only then** production, with the environment's approval;
4. the audit trail of the production run, to show the Worker restarted on the new date and
   still serves.

**The revocation set must be checked across the bump**, because that is the state the bump
must not disturb: a link revoked before the bump must still be refused after it. The deployed
gate covers the *refusal* side; the *revocation-set persistence* side is S4's exit-gate item
"revocation and audit verified remotely (after restart and after key rotation)".

---

## 6. What this review does not decide

- **The date.** The recommendation is "the deployment date". If the operator would rather pin a
  date earlier than the deployment, the same flags apply and the same proof applies.
- **Whether the write gateway takes the same date.** It should — but its Durable Object
  migrations and its audit stream are separate, and it is deployed later, so it is S5's review
  as well as S5's change.
- **Whether R0-008's other half is closed.** It is: the `workers_dev` and `routes` halves were
  closed in Stage 4.3 (read gateway) and Stage 6.1 (write gateway), and the register says so.
  This review covers only the compatibility-date half.

---

## 7. The sources

| What | Where |
|---|---|
| "The Workers runtime will support old compatibility dates forever" | [Compatibility dates · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-dates/) |
| "There is no need to update your `compatibility_date` if you do not want to"; the two costs of an old date | same page |
| Every flag and its "Default as of" date | [Compatibility flags · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) |
| `nodejs_compat` and `nodejs_compat_v2` on by default from 2026-08-04; how to turn them off | [changelog, 2026-08-04](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/) and [Node.js compatibility · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) |
| "Set it to today's date … Periodically updating it … gives you access to new APIs and fixes without changing your code" | [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) |
| The finding this review closes | `docs/release/DEFECT-REGISTER.md`, **R0-008** |
