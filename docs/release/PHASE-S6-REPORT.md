# Stage S6: the submissions-to-consumer transfer (BE-6, R0-011 for Standard)

**Stage:** S6 of `docs/release/V0.6.0-ROLLOUT-PLAN.md` (BE-6).
**Baseline:** `main` at `61fc9e2`. `VERSION` = `0.5.0`.
**Branch:** `s6/transfer-implementation`, on top of `s6/adr-0015-decided` (**pull request #69**,
the ADR's own decision). **Pull request:** #70 — see section 8.
**Scope:** `template/operator/cbridge`, `gateway/write/src/operator/task-state.ts`,
`gateway/write/docs/protocol.md`, `conformance/cases/task-state-transition.json`,
`tests/test_transfer.sh`, `release/`, `docs/release/`.
**No merge, no tag, no publication, and no approval was given by the agent.**

---

## 1. The entry gate

> **Entry gate:** S5 PASS. `[O]` ADR approving the transfer design (Q-CB-2 answered) exists on
> `main`. Without it the agent may write the design as a draft ADR but may not implement:
> **BLOCKED-EXTERNAL**.

**Both conditions are met.**

| Condition | How it is met |
|---|---|
| **S5 PASS** | `release/rollout-gate.sh S5`: **30 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** — the one condition is `S5-WORKER-SECRETS`, the deployed Workers' secret names, which the operator checks by hand or by the approved workflow. S4 stands at **7 PASS, 0 FAIL, 1 BLOCKED-EXTERNAL** on the same condition. |
| **the `[O]` ADR** | **ADR 0015**, decided 2026-11-12. The operator reviewed the draft and approved it: *"The proposed design is sound: it preserves the credential boundary, fails closed on partial writes, and keeps the transfer inside the Supervisor Agent's authority."* Q-CB-2 was already answered by ADR 0011. |

**The operator's four answers, as recorded in ADR 0015:**

1. **The gateway's own record is authoritative.** `GET /admin/task-state` gains a read-only
   field carrying the sealed commit's per-file SHA-256 map.
2. **The destination layout.** The pull request targets the consumer's **default branch**; the
   files land at **the destination paths corresponding to the sealed task folder, as specified
   in the work order**; the source branch is **scoped to the work order**
   (`transfer/<work-order-id>`) and is **recorded in the audit record**.
3. **The token's scope.** The operator-supplied, task-scoped token **may create the branch and
   open the pull request**, in addition to writing file contents. It stays short-lived and
   limited to the destination paths of the one work order.
4. **The default branch is never written to.** The transfer only opens a pull request.

---

## 2. The gateway side: the record of what was sealed

The transfer has to verify the sealed folder against something. The gateway has always
recorded the per-file content hashes when it commits (`CommitRecord.hashes`); the **operator
channel hid them** — its response said it carried *"no capability, no path, no hash and no
content"*. That was a deliberate rule (ADR 0004's hygiene), and the operator's answer to open
point 1 changes it in exactly one place.

**What changed:**

- `GET /admin/task-state` answers `commit.hashes`: the per-file SHA-256 map, keyed by the path
  **relative to the task folder**.
- It is present **only when the commit belongs to the task and the work order asked about**. A
  commit recorded against another task brings **no paths and no hashes** — the rule that
  protected the response is kept, and the transfer's own check (`seal_attested`, which already
  requires both matches) is what it reads.
- The response still carries **no capability, no signature, no writer id and no content**.

**The contract moved with it:** the protocol's task-state table (§10.4.1) and the sentence that
followed it, the 18 shared conformance vectors (`conformance/cases/task-state-transition.json`,
which the gateway's unit test, the read-side suite and the operator console's reference
implementation all read), the unit tests and the integration test.

**No protocol version bump.** The protocol's §16 requires one for a change to §3 (capability and
signature), §4 (routes and envelope) or §5.2 (the state machine). This is none of those: it is
an additive, read-only field in the **operator channel**, which §10.4 says *"is not part of the
agent protocol"* and §14.2's conformance does not cover. The protocol document is updated
because it is normative, and it says so in the same pull request.

---

## 3. The transfer

`cbridge transfer <plan> <order> <task> --expect-head SHA --dest-root PATH [--title T]
[--body-file F] [-y]`

It is the **operator's path**, beside `cbridge upload`, and it runs with the **operator's**
token. **The write gateway's credential is never used**: that credential is scoped to the
submissions repository and cannot reach the consumer repository (ADR 0014 item 4 — and the
operator's own scope check, run 42949381010, proved it against the live token).

**Every check happens before any write, and any failure refuses with no partial writes.**

| # | Check | Where the fact comes from |
|---|---|---|
| 1 | the task folder is **sealed**, under this work order | the gateway's operator channel: `seal_attested` |
| 2 | the sealed folder, read **at the sealed commit** — never at the branch head | the submissions repository |
| 3 | every file's SHA-256 matches the hash the gateway recorded; the file set is **exactly** the sealed commit's — no additions, no omissions | the gateway's `commit.hashes` |
| 4 | the **destination head** is the SHA the operator inspected | the consumer repository's default branch |
| 5 | the files onto the work order's branch, under the operator's existing guards (the secret-pattern scan, the `DENY_TEXT` check on the message and on the pull request) | the operator's configuration |
| 6 | **one commit, one pull request** against the consumer's default branch — and if the pull request cannot be opened, **the branch is removed** and the consumer repository is left exactly as it was | |

The operator's `.keep` placeholder is never transferred (the gateway never commits it ✓), and
the default branch is never written to and never merged into ✓.

**The audit record** — one JSON file per attempt, under the operator's control
(`$WORKDIR/transfer-audit/`) — names the work order, the task, the plan, the sealed commit, the
destination (repository, branch, expected SHA, source branch, root), the file set with its
hashes, the outcome, the step that failed and the reason. **No credential, no signature, no
content.** The tests assert that.

---

## 4. The tests

`tests/test_transfer.sh` — **19 checks**, against local bare repositories and a stand-in for
the gateway's operator channel. No network, no real credentials, no real gateway.

| The case | What it proves |
|---|---|
| the happy path | the branch exists in the consumer repository, the file landed at the destination path, the placeholder was not transferred, the default branch was not written to, the audit record was written and carries no credential and names the sealed commit |
| **a tampered hash** | refused — *"do not match the hash the gateway recorded at seal time"* — and **nothing was written** |
| **a moved destination head** | refused — *"the destination head moved"* — and **nothing was written** |
| **an unsealed folder** | refused — *"the task folder is not sealed under this work order"* — and **nothing was written** |
| **a partial-failure injection** | the pull request cannot be opened → refused, **the branch is removed**, and the destination is unchanged |

Those four are the negative tests the exit gate names, each leaving the consumer repository
**exactly as it was**.

**`cbridge upload` still works:** `tests/test_cbridge.sh` — **36 passed, 0 failed**. That is
Q-CB-2's requirement, and the console-upload sequencing constraint is recorded in ADR 0015:
**both routes are supported in 0.6.0, and `cbridge upload` is retired only after the console's
real upload passes OC-8.**

---

## 5. The credential boundary

The exit gate asks for a credential-boundary test: *the submissions credentials cannot reach
the consumer repository*. Two things establish it:

- **The operator's own check**, run inside the `production` environment under their approval:
  run **42949381010** — the submissions repository listed and **writable**, the consumer
  repository listed and **not** writable, 29 other repositories probed, none writable. The gate
  reads that run's conclusion (`S6-CREDENTIAL-BOUNDARY` ✓).
- **The transfer never uses that credential.** It authenticates to the gateway's operator
  channel with the operator token (read-only, and the operator channel is not an agent
  credential ✓), and it pushes to the consumer repository with the operator's git credential
  ✓. The transfer's own code holds no credential, and the audit record it writes holds none ✓.

---

## 6. The artifact: the transfer ships, and the release machinery covers it

The exit gate: *"Transfer is outside the consumer artifact unless the design says it ships
(`C-ISO`); if it ships, it is in the allowlist and covered by `release/test-release.sh`."*

**The design says it ships** — ADR 0015 places the transfer in build-engine as the operator's
path, beside `cbridge upload`, and `cbridge upload` itself ships. So:

- The **allowlist** already covers it: `release/manifest.txt` lists `managed operator`, and the
  transfer is part of `template/operator/cbridge` ✓ — **no allowlist change was needed**, and
  the gate checks that (`S6-RELEASE-COVERAGE` ✓).
- **`release/test-release.sh` now runs both suites** — the transfer's own (19 ✓) and
  `tests/test_cbridge.sh` (36 ✓) — so a release cannot ship a transfer that does not pass ✓.

---

## 7. The gate

`release/rollout-gate.sh S6` now implements the stage's own checks, and the stage stands at:

```
  PASS 29   FAIL 0   BLOCKED-EXTERNAL 0
  RESULT: PASS (stage S6)
```

| Check | What it holds the stage to |
|---|---|
| `S6-ADR-0015` | the ADR that approves the transfer design exists and is **decided** |
| `S6-TRANSFER-TESTS` | the transfer's suite passes — the happy path and the four negative tests |
| `S6-CBRIDGE` | `cbridge upload` still works (36 checks) |
| `S6-CREDENTIAL-BOUNDARY` | the submissions credential cannot reach the consumer repository (the operator's recorded run) |
| `S6-RELEASE-COVERAGE` | the transfer ships and the release machinery covers it |

**Two defects the gate found, both fixed:**

- **A check run that has not finished was read as a red build.** The `worker-secrets` workflow
  sits at the `production` environment's approval prompt and reports no conclusion; `C-CI`
  counted that as a failure. It now judges only the runs that have **completed**, and says how
  many are still running ✓.
- **The approval checks reported *"the production gateway has not been deployed yet"* when the
  truth was that they could not look.** A missing GitHub credential is an external input, not a
  finding about the deployment; those checks now say so ✓.

---

## 8. The pull requests

| PR | What | Merged |
|---|---|---|
| **#69** | ADR 0015 decided, with the operator's four answers and the approver record | waiting on the operator |
| **#70** | this stage: the gateway's record of what it sealed, the transfer, the tests, the gate | on top of #69 |

**The operator merges both** (G-12); the agent never merges. #70 is stacked on #69: merge #69
first and #70's diff becomes exactly the implementation.

---

## 9. What is not done

- **The deployed gateways still carry the old code.** The operator channel's per-file hashes
  reach the **staging** write gateway with the staging deploy this stage dispatched (run
  **43256388710**); the **production** write gateway needs a production deploy, and that waits
  at the environment's approval prompt. Until then, a transfer against the deployed production
  gateway cannot read the hashes — and refuses, with *"the seal names no commit"* or an empty
  hash map, rather than proceeding ✓.
- **The transfer has not been run against the pilot's real repositories.** The tests use local
  bare repositories and a stand-in gateway ✓. A real transfer — the pilot's sealed task folder
  into `inscope-labs/acme-pilot` — is the operator's, with their token ✓.
- **The operator's own transfer of the pilot's work has not been performed** ✓. That is the
  point of the stage: the path exists and is proven against local fixtures; the real run is
  theirs.
