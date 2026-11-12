# Operator runbook — the two steps that unblock S6

**For:** the operator. **From:** the agent, 2026-11-12.
**Why this document exists:** S6's entry gate has two conditions and both are unmet. Each one is
yours, and each is a small, bounded piece of work. This is the whole of it, step by step, with
the commands.

**The two steps, and what each is worth:**

| Step | What it closes | Effort |
|---|---|---|
| **1** | approve ADR 0015 (or send it back) | read one file, answer four questions |
| **2** | the deployed Workers' secret names | one command, or one merge and one approval click |

**Neither step needs a credential you do not already have.** Step 2 needs your Cloudflare
credential — and the design keeps it out of my environment (ADR 0013 item 4), so it is never
asked for, never pasted into a chat, and never stored here.

---

# Step 1 — ADR 0015: the transfer design

**What it is:** the design of the submissions-to-consumer transfer path, which S6 implements.
It is on `main` (PR #67, merged 2026-11-12) at
`docs/decisions/0015-submissions-to-consumer-transfer.md`, and it is **drafted, not decided** —
its status line says `open`.

**Why it blocks S6:** the rollout plan's S6 entry gate reads *"`[O]` ADR approving the transfer
design (Q-CB-2 answered) exists on `main`. Without it the agent may write the design as a draft
ADR but may not implement: **BLOCKED-EXTERNAL**."* Q-CB-2 is answered (ADR 0011). The design
itself was written in 2026 (product contract §1.1.5). What does not exist is the record of your
approval — so I drafted it, and the decision is yours.

### 1.1 [YOU] Read it

Open `docs/decisions/0015-submissions-to-consumer-transfer.md` on `main`. The parts that need
your attention are the **Proposed decision** (nine points — what the transfer does) and the
**Open points** (four questions — what I could not decide for you).

If anything in the proposed decision is wrong, say so and I will redraft it. It is a proposal,
not a fait accompli.

### 1.2 [YOU] Answer the four open points

Here they are with my recommendation for each. **Reply with just the letters** (for example
`1a 2a 3a 4a`) if you agree with all four, or write your own answer for any of them.

**Question 1 — which hash is authoritative for the per-file check?**

- **(a) [recommended]** Expose the sealed commit's per-file SHA-256 map on the gateway's
  operator channel (`GET /admin/task-state`). The gateway **already records** those hashes when
  it commits; the operator channel simply does not expose them. This is one read-only addition
  and it is the only gateway change the transfer needs.
- **(b)** Treat the sealed commit's SHA as the whole check. It covers the tree and every blob in
  it, so a tampered file changes it — but it is one fact rather than one per file.

**Question 2 — the consumer-side destination layout.** (The submissions side is fixed by ADR
0014; this is the other side.)

- **(a) [recommended]** The pull request targets the consumer's default branch (`main`); the
  files land at `plans/<plan>/submissions/<order>/<task>/`, mirroring the submissions layout;
  the source branch is `transfer/<order>-<task>`.
- **(b)** Something else — name the branch, the path and the branch-name pattern.

**Question 3 — the token's scope and lifetime.** May the operator-supplied, task-scoped token
create the branch and open the pull request, or only write file contents?

- **(a) [recommended]** It may create the branch and open the pull request for that one work
  order. It may not merge, may not publish, and may not touch any other path.
- **(b)** Contents only — the operator opens the pull request by hand.

**Question 4 — may the transfer ever write straight to the consumer's `main`?**

- **(a) [recommended]** No. The pull request is the surface; the default branch stays
  operator-controlled.
- **(b)** Yes, under a stated condition — say what it is.

### 1.3 [ME] Turn your answers into the decided ADR

You reply → I write the ADR with status `decided`, today's date, your answers written into the
decision, the open points closed, and the index updated → I open a pull request.

### 1.4 [YOU] Review and merge that pull request

The agent never merges (G-12). One click.

### 1.5 [ME] Implement S6

With ADR 0015 `decided` on `main`, S6's implementation is unblocked, and I carry it out: the
fail-closed validation, the single commit and pull request, the no-partial-writes rule, the
audit record, and the four negative tests the stage is accepted by (tampered hash, moved
destination head, unsealed folder, partial-failure injection).

---

# Step 2 — the deployed Workers' secret names

**What it is:** the check that the deployed production Workers hold the three secret *names*
their contract requires — `SIGNING_KEYS`, `OPERATOR_TOKEN`, `GITHUB_TOKEN` — on `ctxgate-read`
and `ctxgate-write`. It reads **names only**; the Cloudflare API never returns a value and
nothing asks it to.

**Why it is yours:** the Cloudflare credential is deliberately not in my environment
(ADR 0013 item 4, and I did not ask for it). It is the last BLOCKED-EXTERNAL condition on both
S4 and S5.

**Two routes. Route A is one command; Route B is one merge and one approval click, and it makes
the check re-provable forever.**

## Route A — run it now, on your machine

### 2A.1 [YOU] Put the credential in your shell

```bash
export CLOUDFLARE_ACCOUNT_ID=<your account id>
export CLOUDFLARE_API_TOKEN=<a token with Account > Workers Scripts > Read>
```

If you do not have a token with that permission, Cloudflare's dashboard: **My Profile → API
Tokens → Create Token → Edit Cloudflare Workers → Account > Workers Scripts: Read**, plus
**Account Settings: Read** (that is what lists the accounts).

Your account id is on the same page, or with `curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts | jq -r '.result[].id'`.

### 2A.2 [YOU] Run the check

```bash
cd <your build-engine checkout>
for stage in S4 S5; do
  ROLLOUT_GATE_ONLY="${stage}-WORKER-SECRETS" bash release/rollout-gate.sh "$stage"
done
```

You are looking for **two `PASS` lines**:

```
  PASS  S4-WORKER-SECRETS  the deployed Workers hold every contract secret name, checked in the 'production' environment (run …)
  PASS  S5-WORKER-SECRETS  …
```

If your checkout is older than PR #67, the check will print *"the deployed Workers' secret
names have never been checked"* instead — pull `main` first and run it again.

### 2A.3 [YOU] Paste the two lines back to me

That is the evidence (G-01: check id, command, exit code, the inspected output). I record it in
`docs/release/GATE-2-SUMMARY.md` and in the S4 and S5 stage reports.

### 2A.4 [ME] Record it and re-run both gates

Done on my side. **Note:** the gate in *my* environment will still say BLOCKED-EXTERNAL for this
one check, because the credential is not here — that is by design, and the recorded evidence is
what closes it. Route B removes even that.

### If Route A fails

| The line says | What it means | What to do |
|---|---|---|
| `code 9106` | the token is wrong, revoked or expired | mint a new one |
| `code 9109` / `10000` | the account id is wrong | `GET /accounts` with the token, take the id from there |
| `code 10001` / `10040` | the token lacks Workers Scripts Read | edit the token's permissions and re-run |
| `MISSING: GITHUB_TOKEN` | the Worker genuinely lacks the secret | set it, then re-run: `cd gateway/write && npx wrangler secret put GITHUB_TOKEN` (the top-level Worker is the production one, `ctxgate-write`), and for the read gateway `cd gateway/read/production && npx wrangler secret put GITHUB_TOKEN --env production` |

## Route B — make the check re-provable, so it never blocks again

A workflow is on the branch `s6/worker-secret-names` in **PR #68** (below): it runs the *same*
check inside the `production` environment, where your Cloudflare credential already lives by
name, and your required reviewer decides every run. The run's conclusion becomes the evidence
the gate reads — so the check stops depending on where it is run from.

### 2B.1 [YOU] Merge PR #68

One click, after a look. It adds one workflow file, one script and one test; the workflow only
ever issues two read-only GETs.

### 2B.2 [ME] Dispatch it

I dispatch `worker-secrets.yml` from `main` with a reason recorded in the summary.

### 2B.3 [YOU] Approve it

**Review deployments → production → Approve and deploy**, as `inscope-xlabs`. Your credential
cannot approve it (`current_user_can_approve: false` for the agent's), and that is the point.

### 2B.4 [ME] Verify and record

I read the run's conclusion through the API, re-run both gates, and the two checks become
`PASS` in **every** environment — including mine — because the evidence is now a recorded run
rather than a live credential.

### Route A **or** Route B?

**Route A is enough to close the condition now.** Route B is what stops it from coming back, and
it costs you one merge and one approval click instead of one command. If you do Route A now,
do Route B whenever you like — they do not conflict, and the recorded evidence stands either way.

---

# Step 3 — after both steps

| | Who | What |
|---|---|---|
| 3.1 | [ME] | With ADR 0015 decided and the secret-name check recorded, **S6's entry gate is met** and I implement BE-6. |
| 3.2 | [YOU] | Review and merge the S6 pull request. |
| 3.3 | [YOU] | At the end of the assignment, revoke the GitHub PAT that was pasted into this chat, and the one used for the rollout. ADR 0013 item 5 records that the operator does this. |
| 3.4 | [YOU] | Optionally: export the platform's Worker logs, metrics, traces and error records. `ops/privacy-scan.py` scans them unchanged, and the scan is already written and proven against a planted token shape. |

---

## The commands, all together

```bash
# Step 2, Route A — on your machine, with your Cloudflare credential:
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
cd <build-engine>
for stage in S4 S5; do
  ROLLOUT_GATE_ONLY="${stage}-WORKER-SECRETS" bash release/rollout-gate.sh "$stage"
done

# Step 2, Route B — from me, once PR #68 is merged:
#   dispatch worker-secrets.yml from main; you approve; I verify.

# Step 1 — from you: read the ADR, reply "1a 2a 3a 4a" (or your own answers).
#   Then I write the decided ADR and open the pull request; you merge it.
```
