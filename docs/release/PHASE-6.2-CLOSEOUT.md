# Phase 6.2 — Closeout: the full Class B workflow

- Stage: **6.2** of `RELEASE-PLAN.md` (Phase 6, "Cross-system integration and real pilot") — *"Execute the full Class B workflow"*.
- Date: 2026-11-03.
- Source commit: `9a96f64` (`main`, the commit this branch was cut from; it contains Stage 6.1, merged as PR #32, and the staging deploy workflow, merged as PR #36).
- Branch: `phase-6/6.2-class-b-pilot`.
- Governing documents: `docs/release/DEFECT-REGISTER.md` (addendum A10), `docs/release/PHASE-6.1-CLOSEOUT.md`.

## 1. Intent and scope

Plan tasks 6.2.1 to 6.2.12, and what was actually done:

| Task | What it asks for | Done? |
|---|---|---|
| 6.2.1 | a plan and task with a pinned source commit and an explicit allowed context file | **yes** |
| 6.2.2 | a work order and a short-lived capability minted for that order | **yes** |
| 6.2.3 | the agent retrieves **only** the authorised file, over a plain HTTPS GET | **yes** |
| 6.2.4 | wrong task, wrong path, expired link, revoked order, invalid signature and unlisted path are denied | **yes** |
| 6.2.5 | text files delivered within the type and quota policy | **yes** |
| 6.2.6 | staged content read back, exact bytes and hashes, before the commit | **yes** |
| 6.2.7 | only the selected files committed to the task submission folder on the approved branch | **yes** |
| 6.2.8 | a duplicate commit retry is a replay, not a second or divergent write | **yes** |
| 6.2.9 | the task is sealed, and every later write is rejected | **yes** |
| 6.2.10 | the operator inspects the submission, then explicitly performs any upstream publish/reconcile | **inspection: yes. Upstream publish: not performed, and it is the operator's action by definition (section 7)** |
| 6.2.11 | the order is closed, and the read and write capabilities are proved unusable | **yes** |
| 6.2.12 | the audit events are inspected, and no secret or content leaked | **yes** |

The workflow was executed end to end, with the shipped tooling (`template/engine/tools/plan_tool.py`, `ctxlink.py`, the write gateway's own `mint-root-url.ts`) and the real provider (GitHub), not against a mock.

## 2. What was built

| What | Where |
|---|---|
| The driver that executes the whole workflow and prints the evidence | `ops/staging-pilot.py` |
| The estate record, with the task folder the plan tooling derives | `ops/staging-estate.json` (`write_gateway.task_folder`) |
| The separation gate, now covering the read gateway as well, and tolerant of Cloudflare's bot rule | `gateway/write/scripts/check-staging-separation.py` (`--kind read`), wired into CI as `write-gateway-staging-separation` |

## 3. The pilot's identifiers

| What | Value |
|---|---|
| plan | `pilot-001` (number `10008`) |
| gate task (operator) | `10008-1-101-01` — stage 1-1 |
| worker task | `10008-1-201-01` — stage 1-2 |
| work order | `10008-S001` |
| context file | `plans/pilot-001/package/brief.md` (inside the read gateway's `plans/*/package/` prefix) |
| task submission folder | `plans/pilot-001/submissions/10008-S001/10008-1-201-01` |
| deliverable | `deliverable.md` |

The identifiers are the shipped tooling's own rules: a task id is `PLAN(5)-PHASE(n)-TASK(3)-SUB(2)`, the hundreds digit of the task number is the stage sub-stage, and the order id is `NNNNN-SNNN`. The order's context item is `{"source": "plan", "path": "brief.md", "role": "read"}`, which the tooling resolves to the repository path `plans/<plan>/package/brief.md` and mints a signed link for **at print time only** — the signed link is never written into the order file.

## 4. Where it ran, and why

Two legs, and the difference between them is stated rather than blurred.

**The signed leg ran on the local Workers runtime** (`wrangler dev`, the same Worker code, the same runtime, the real GitHub provider). It is the full workflow: 42 checks, all passed.

**The deployed staging gateways were probed separately** — 12 checks, all passed — against the two Workers that Stage 6.1 and this stage published:

| Gateway | URL | Version id |
|---|---|---|
| read | `https://ctxgate-read-staging.qnuralink.workers.dev` | `1b709d8c-5d21-477c-8850-3d74d810f1b1` |
| write | `https://ctxgate-write-staging.qnuralink.workers.dev` | `e8d8e2c8-0645-4399-a43d-7fc9b02ecb47` |

The signed leg could **not** be executed against the deployed gateways, and the reason is the operator's secret, not a defect: minting a link for the deployed read gateway needs that gateway's `SIGNING_KEYS`, and minting a write capability needs the write gateway's `SIGNING_KEYS`. Those exist only in the operator's own delivery bundle. Section 8 lists what to hand over to close that gap.

**A second disposition, once the deployed signing keys are available:** the local runtime's Durable Object state is durable by design (a seal and a revocation are meant to survive), so the local pilot clears it before it starts and is repeatable. The deployed gateways keep their state, so a second deployed run has to use a fresh plan number and a re-seeded estate. This is recorded rather than worked around, because a pilot that silently reuses a revoked order would prove nothing.

## 5. The evidence

### 5.1 The signed leg — 42 checks, all passed

```
== 6.2.1  the plan, the task and the pinned context file ==
   ok   the plan passes the engine's own check
   ok   the worker task is eligible to be ordered (['10008-1-201-01'])

== 6.2.2  the work order and the signed links ==
   ok   the work order was written: 10008-S001
   the task folder the gateway will commit into: plans/pilot-001/submissions/10008-S001/10008-1-201-01
   ok   the order names the context file plans/pilot-001/package/brief.md
   ok   the shipped engine minted a signed read link
   the link binds order 10008-S001 and the pinned commit ce7790636376

== 6.2.3  the agent retrieves the authorised file, and only that file ==
   ok   the authorised file was served (200) # Pilot brief
   283 bytes

== 6.2.4  the refusals ==
   ok   a file outside the allowed prefixes is refused (403)
   ok   a forged signature is refused (403 forbidden (link invalid, expired or revoked))
   ok   an expired link is refused (403)
   ok   a link with a bad signature is refused (403)
   ok   a link for an order that was never issued is refused (403)

== the agent delivers a file through the write gateway ==
   ok   a write capability was minted for the order
   ok   the write capability is bound to the pilot's task and order (10008-1-201-01/10008-S001)
   ok   the task folder is derived from the capability (plans/pilot-001/submissions/10008-S001/10008-1-201-01)
   ok   the file was scaffolded (200)
   ok   the chunk was staged (200)
   ok   a denied file type is refused (type-not-allowed, 400)
   ok   a path outside the task folder is refused (malformed-path, 400)
   ok   a file over the size limit is refused (file-too-large)
   ok   the staged content reads back byte for byte
   ok   the commit landed: dba07f0a24340434d29d2bd5c2e0c7e3f16a3edf
   ok   the retry was a replay, not a second commit
   ok   the branch head is the commit (dba07f0a2434)
   ok   the task is sealed
   ok   a write after the seal is refused (task-sealed)

== 6.2.10  the submission, as the operator inspects it ==
   branch: staging/submissions -> dba07f0a2434
   commit: dba07f0a24340434d29d2bd5c2e0c7e3f16a3edf
   folder: plans/pilot-001/submissions/10008-S001/10008-1-201-01
   file:   deliverable.md

== 6.2.11  the operator revokes the work order ==
   ok   the read gateway revoked the order (200)
   ok   the read capability no longer works (403)
   ok   the write gateway revoked the task (200)
   ok   the sealed task's capability no longer works (410 task-sealed)
   ok   the second task's capability works before the revocation (200)
   ok   the second task was revoked (200)
   ok   the revoked task's capability no longer works (410 task-revoked)

== 6.2.12  the audit records, and what must not be in them ==
   read audit: 1394 bytes, write audit: 2962 bytes
   ok   the read signing secret is not in the audit records
   ok   the write signing secret is not in the audit records
   ok   the read operator token is not in the audit records
   ok   the write operator token is not in the audit records
   ok   the deliverable's content is not in the audit records
   ok   the provider credential is not in the audit records
   ok   the read link's signature is not in the audit records
   ok   the write capability's signature is not in the audit records
   ok   the read audit channel refuses an unauthenticated caller (401)
   ok   the write audit channel refuses an unauthenticated caller (401)

== the result ==
THE PILOT PASSED (42 checks)
```

Two details in that transcript are worth naming, because both are contract behaviour rather than accident:

- The **revocation and the seal are different closures**. The pilot seals the task first, and the sealed task's capability then answers `410 task-sealed`; a second task, never sealed, is revoked and answers `410 task-revoked`. The contract keeps the three closures apart on purpose, and the pilot proves each one by name.
- The **signature is not the authorisation**. A correctly signed link for an order the gateway never issued is refused (403), because the order is what the link is authorised against.

### 5.2 The deployed leg — 12 checks, all passed

```
== the deployed gateways ==
   ok   the read gateway answers (200)      scheme ctxgate-v1, key ids ['s1']
   ok   the write gateway answers (200)     scheme ctxwrite-v1

== the deployed gateways are the staging ones ==
   ok   the separation gate passes for the write gateway
   ok   the separation gate passes for the read gateway

== the deployed gateways refuse what they must ==
   ok   a link with a bad signature is refused (403)
   ok   a link with an unknown order is refused (403)
   ok   the read audit channel refuses an unauthenticated caller (401)
   ok   the write audit channel refuses an unauthenticated caller (401)
   ok   the read revocation channel refuses an unauthenticated caller (401)
   ok   the write revocation channel refuses an unauthenticated caller (401)

== the result ==
THE PROBES PASSED (12 checks)
```

## 6. The findings

Two findings came out of the pilot. Both were found by execution, and both are closed in this stage. They are recorded in the register as **F0-073** and **F0-074** (addendum A10).

| Finding | One line |
|---|---|
| F0-073 | Cloudflare's managed rules refuse Python's default `User-Agent` with error 1010, so every script in this repository that called a deployed gateway without naming itself got a 403 that looked like a credential problem |
| F0-074 | The disposable estate's seeded task folder was a guess (`plans/pilot-001/submissions/wo-10008/10008-1-001-01`) and did not match the folder the plan tooling and the write gateway derive (`plans/{plan}/submissions/{order}/{task}`), so the pilot's first commit attempt failed with `task-folder-missing` |

F0-073 also explains a Stage 6.1 observation that was recorded as unexplained at the time: the staging deployment's own post-publish check answered 403 on `/healthz` from the GitHub Actions runner. It was Cloudflare's bot rule, not a bad deployment and not a missing credential.

## 7. What is not proved, and why

| Not proved | Why | What closes it |
|---|---|---|
| The signed workflow against the **deployed** gateways | Minting a link or a capability needs that environment's `SIGNING_KEYS`, which are the operator's secret | The operator hands over the four staging secrets (section 8); then `ops/staging-pilot.py --target deployed` runs the same 42 checks against the deployed Workers |
| The **upstream publish/reconcile** step of 6.2.10 | The submissions-to-consumer transfer path is register entry **R0-011**, and it is not designed. Inventing it here would be inventing a delivery path | R0-011. For staging the submission's home is the disposable branch, and disposing of the estate is what removes it |
| The **production** gateways | Stage 6.1 established that the production environments have no Cloudflare secrets set at all, so every deploy-to-production run fails | The operator sets the production secrets, and a production pilot is a separate stage |
| The pilot against a **moving** source branch | A capability always pins a commit, by contract | Nothing: the pin is the behaviour being proved |

## 8. What the operator has to do

1. **Hand over the four staging secrets**, to close the deployed signed leg:
   - `SIGNING_KEYS` for `ctxgate-read-staging` (key id `s1`) and for `ctxgate-write-staging` (key id `sk1`);
   - `OPERATOR_TOKEN` for `ctxgate-read-staging` and for `ctxgate-write-staging`.

   They are in the operator's own `bundle.json` from the `staging-init` delivery artefact. They can be rotated with `staging-init --replace yes`; the pilot does not need the same values twice, because it mints its own links with whatever the gateway holds.

2. **Delete the three empty repositories** that Stage 6.1's probing created and that the credential cannot see or delete: `inscope-labs/build-engine-staging-source`, `inscope-labs/build-engine-staging-submissions`, `inscope-labs/be-staging-probe2` (public).

3. **Dispose of the estate** when the pilot is finished with it (`ops/staging-estate.py dispose`), and apply the production branch protection recorded as R0-004.

## 9. How to run it

```bash
# the full signed workflow, against the local runtime and the real provider
GITHUB_TOKEN=<a credential that can write to the disposable branches> \
  python3 ops/staging-pilot.py --target local

# the deployed gateways, without any secret
python3 ops/staging-pilot.py --probes-only \
  --read-base https://ctxgate-read-staging.qnuralink.workers.dev \
  --write-base https://ctxgate-write-staging.qnuralink.workers.dev

# the full signed workflow, against the deployed gateways
CTXGATE_SECRET=<read signing key> CTXGATE_OPERATOR_TOKEN=<read operator token> \
CTXGATE_WRITE_SECRET=<write signing key> CTXGATE_WRITE_OPERATOR_TOKEN=<write operator token> \
  python3 ops/staging-pilot.py --target deployed \
    --read-base https://ctxgate-read-staging.qnuralink.workers.dev \
    --write-base https://ctxgate-write-staging.qnuralink.workers.dev
```

The script writes nothing into the repository: the plan, the task and the work order live in a disposable consumer checkout under `/tmp`, and the only repository it writes to is the disposable estate's `staging/submissions` branch, through the gateway.

## 10. Honest limits of this closeout

- The **local** leg is the shipped code in the shipped runtime, but it is not the deployed edge. The deployed leg is the deployed edge, but only the part that needs no secret. The two together are not the same thing as "the deployed signed workflow", and this document does not claim that it is.
- The pilot's **agent side** is the shipped engine's tooling, driven by a script rather than by a live model. What is proved is the gateway contract, the tooling and the file movement; what is not proved is any agent's behaviour.
- The **estate** is a single repository with two disposable branches, so the pilot does not exercise a real consumer repository, a real submission repository, or a real transfer between them (R0-011 again).
- The pilot's plan, task and order are **synthetic** — a real Class B task would come from the operator's own planning. The tooling, the gateway and the refusal behaviour are the real ones.
