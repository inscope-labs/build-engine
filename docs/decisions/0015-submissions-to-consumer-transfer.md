# 0015: the submissions-to-consumer transfer path (R0-011)

Status: **decided** (2026-11-12)

This ADR is what the rollout plan's S6 entry gate asks for: "`[O]` ADR approving the transfer
design (Q-CB-2 answered) exists on `main`." The design itself is not new: it was written in
`docs/release/PHASE-1.1-PRODUCT-CONTRACT.md` section 1.1.5 (2026-10-26), and **Q-CB-2 is
answered** by ADR 0011 (decided 2026-11-08). What did not exist until now was the record of the
operator's *approval* of that design, and without it S6 could not be implemented: the plan says
the agent "may write the design as a draft ADR but may not implement".

The draft was proposed by the agent on 2026-11-12 and approved by the operator the same day,
with the four open points answered. The answers are recorded below, in "Decision", and the
"Open points" section is closed.

## Question

How does an accepted, sealed task folder move from the submissions repository to the consumer
repository, without the write gateway's credential ever reaching the consumer repository, and
without a partial write when something goes wrong halfway?

## Context

1. **The write gateway cannot do it, and that is the point.** Protocol section 12.1: *"The
   gateway holds a credential scoped to the submissions repository only. That credential has no
   access to the private consumer repository."* ADR 0014 item 4 records the same for the pilot:
   the write token reaches `acme-pilot-dev` only, and **not** `acme-pilot`. The operator's own
   scope check proved it against the live token — run 42949381010: the submissions repository
   listed and writable, the consumer repository listed but **not** writable, 29 other
   repositories probed, none writable. So the transfer is necessarily a **different actor**
   with a **different credential**, and no gateway change can make the gateway's own credential
   reach the consumer repository.
2. **The actor is already named.** Product contract section 1.1.5: the transfer is performed by
   the **Supervisor Agent**, an operator-initiated Class A agent whose authority *"is limited to
   the sealed task folder in the submissions repository and the corresponding destination paths
   in the consumer repository; it may not publish, revoke, or alter any other work order."*
   Class A is a deliberate exception: the operator supplies a short-lived, task-scoped token
   during the work-order / transfer request process (product contract section 1.1.2).
3. **The destination surfaces a pull request.** ADR 0014 item 1: *"The public repository is the
   consumer: it surfaces the final task pull request."* A pull request is not a publication: the
   transfer opens one and does not merge it, which is what keeps it inside the authority
   boundary.
4. **The seal is a fact the gateway can already attest.** The write gateway's operator channel
   answers `GET /admin/task-state` with `seal_attested` — true only when the session is sealed,
   a seal record and a commit record both exist, the seal is over that commit, and the commit
   belongs to **both** the task and the work order asked about. It also carries the commit's
   `sha` and its `task_match` / `order_match` facts.
5. **The hash check has a gap in the current contracts.** Section 1.1.5 requires that *"each
   file must carry a matching SHA-256 recorded at seal time"*. The gateway does record them:
   the commit record holds `hashes`, a SHA-256 per selected path. **The operator channel does
   not expose them** — it states that it carries *"no capability, no path, no hash and no
   content"*. So the per-file check either needs a small read-only addition to that channel, or
   it is satisfied by the sealed commit's SHA (which covers the tree and every blob in it).

## Decision

1. **The actor, the credential and the boundary.** The transfer is performed by the Supervisor
   Agent, on the operator's instruction, using a **task-scoped token the operator supplies for
   that transfer**. The token may write the destination paths of that one work order in the
   consumer repository and nothing else. The write gateway's credential is not involved, is not
   extended, and is never given consumer-repository access. The transfer may not publish, merge,
   revoke, or alter any other work order.
2. **Where it lives.** The transfer tool is implemented in **build-engine** (this repository) —
   BE-6 is a build-engine stage — as a separate operator-side path, **not** as a gateway
   operation: it is the operator's path, beside `cbridge upload`, and it runs with the
   operator-supplied token. `cbridge upload` keeps working, unchanged, for the whole of 0.6.0
   (Q-CB-2: `cbridge upload` is retired only after the console's real upload passes OC-8). The
   operator console consumes the **contracts**, not the code.
3. **The validation sequence, and it fails closed.** Every step below is checked *before* any
   write, and any failure aborts with **no partial writes**:

   | # | Check | Where the fact comes from |
   |---|---|---|
   | 1 | the task folder exists, and it is **sealed** | the gateway's operator channel: `seal_attested` is true, for this task **and** this work order |
   | 2 | the sealed commit is the gateway's commit for that task and order | the same response: `commit.sha`, `commit.task_match`, `commit.order_match` |
   | 3 | every file's SHA-256 matches the hash recorded at seal time | the gateway's commit record (`hashes`), read from the operator channel's new read-only field, compared against the files read from the sealed commit |
   | 4 | the **destination head** is the SHA the operator supplied | the consumer repository's target branch: the expected SHA must equal the current tip |
   | 5 | only paths inside the sealed task folder are eligible; content is valid UTF-8 text of an allowed type; the size and file count respect the published quotas | the write gateway's type and quota policy, read from the gateway's published `/healthz` |
   | 6 | the file set is exactly the sealed commit's file set — no additions, no omissions | the sealed commit's tree |

4. **Conflict handling.** If the destination head has moved, the transfer **fails closed** and
   writes nothing. The operator (through the Supervisor Agent) re-inspects and re-issues against
   the new SHA. The transfer never rebases, never merges and never force-pushes.
5. **The write itself.** The transfer copies the sealed files to the consumer repository's
   destination paths, on a **new branch** named for the work order (`transfer/<work-order-id>`),
   and opens a **pull request** against the consumer's **default branch** — the pull request the
   consumer repository exists to surface (ADR 0014 item 1). The destination paths are the ones
   the **work order** specifies, corresponding to the sealed task folder. It does not merge the
   pull request, and it never writes to or merges into the default branch.
6. **No partial writes.** The write is a single commit of the whole file set, and the pull
   request is opened only once that commit exists. If the pull request cannot be opened, the
   branch is removed and the consumer repository is left exactly as it was. A failure after the
   commit but before the pull request is the one case that leaves a branch behind, and it is
   recorded in the audit record as an incomplete transfer rather than being silently forgotten.
7. **The audit record.** Every transfer attempt writes one structured record, under operator
   control: the work order, the task, the sealed commit's SHA, the destination repository,
   branch and expected SHA, the file set with its hashes, the outcome, and — on failure — the
   step that failed and the reason. The record holds no credential, no capability and no
   signature, and it is the same discipline the gateways' audit records follow.
8. **The operator-side revocation and audit workflow, exposed to the console.** The console
   consumes the gateway's existing operator-channel contracts: `GET /admin/task-state` (the
   `seal_attested` fact), `GET /admin/audit` and `POST /admin/revoke`. Both channels already
   refuse an unauthenticated caller with 401, which the deployed probes prove on all four
   gateways. The transfer adds no new gateway route for the console; it consumes what is
   already deployed.
9. **The negative tests the stage is accepted by.** Each is named in the report: a tampered
   hash, a moved destination head, an unsealed folder, and a partial-failure injection (the
   destination unchanged after each). The credential-boundary test: the submissions credential
   cannot reach the consumer repository.

## Open points — answered by the operator (2026-11-12)

1. **Which hash is authoritative for check 3? — The gateway's own record, exposed.**
   Expose the sealed commit's per-file SHA-256 map on the operator channel: a read-only field on
   `GET /admin/task-state` carrying the per-file hashes. The gateway already records them when
   it commits, and this is the only gateway change the transfer needs; it closes the gap the
   draft identified.
2. **The destination layout.** The pull request targets the consumer repository's **default
   branch** (`main`). The files land at **the destination paths corresponding to the sealed task
   folder, as specified in the work order**. The source branch is **a name scoped to the task
   or work order** (for example `transfer/<work-order-id>`), and it is **recorded in the audit
   record**.
3. **The token's scope and lifetime.** The operator-supplied, task-scoped token **may create the
   branch and open the pull request**, in addition to writing file contents — *"a transfer that
   cannot open its own pull request cannot complete its stated purpose"*. The token remains
   short-lived and limited to the destination paths of the one work order.
4. **Whether the transfer ever runs against the consumer's default branch directly. — No.** The
   transfer only opens a pull request; it never writes to or merges into the default branch. The
   default branch remains operator-controlled.

---

## Consequences

- **S6's entry gate is met when this ADR is decided.** The plan requires "`[O]` ADR approving
  the transfer design (Q-CB-2 answered) exists on `main`". Q-CB-2 is answered (ADR 0011); this
  ADR is the approval of the design, and the open points are what the approval has to settle.
- **The credential boundary is unchanged and is proved, not asserted.** The write gateway's
  credential still reaches `acme-pilot-dev` only; the transfer's token is a separate, operator-
  supplied, task-scoped credential; the transfer is a Class A path that does not weaken the
  Class B controls (product contract section 1.1.2).
- **The gateway's contract changes, once, and it is a read-only addition.** `GET
  /admin/task-state` gains the sealed commit's per-file SHA-256 map (open point 1). It is a
  protocol change under section 16's change control, and the protocol is updated with it: the
  operator channel's response no longer carries *no hash* — it carries the hashes, and still no
  content, no path and no capability.
- **`cbridge upload` is unaffected**, and the sequencing constraint is recorded: both routes are
  supported in 0.6.0, and `cbridge upload` is retired only after OC-8 passes (Q-CB-2, ADR 0011).
- **The pilot's disposable estate is unaffected.** The transfer's negative tests run against a
  disposable consumer repository, and the estate's disposal is what removes it.

## Records

- **Proposed by:** the agent (`inscope-labs`), 2026-11-12, from the design in product contract
  section 1.1.5 (2026-10-26) and the decisions ADR 0005, 0008, 0011, 0013 and 0014.
- **Approver:** John Wendell, operator and lead architect, inscope-labs — **2026-11-12**, from
  the operator's review of the draft: *"I have reviewed the draft ADR for the submissions-to-
  consumer transfer path. The proposed design is sound: it preserves the credential boundary,
  fails closed on partial writes, and keeps the transfer inside the Supervisor Agent's
  authority. I approve the decision with the following answers to the open points."*
- **Sources:** `docs/release/PHASE-1.1-PRODUCT-CONTRACT.md` §1.1.2 and §1.1.5;
  `gateway/write/docs/protocol.md` §8, §11 and §12; `docs/decisions/0011`, `0013`, `0014`;
  `docs/release/DEFECT-REGISTER.md` R0-011; `docs/release/CBRIDGE-COVERAGE-MATRIX.md` Q-CB-2.
