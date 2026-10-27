BUILD ENGINE — STAGE 5.1 CLOSEOUT (write-gateway protocol and security contract)
Repository: https://github.com/inscope-labs/build-engine
Branch: phase-5/5.1-protocol-contract
Baseline: main @ 240e328aad09d93773ce411b89f08ef5e8ca7178
Date: 2026-10-27
Version: 0.5.0 (unreleased)
Plan stage: RELEASE-PLAN.md Phase 5, Stage 5.1 (protocol and security contract)

STATUS: STAGE 5.1 IS COMPLETE AS A CONTRACT STAGE. The write gateway's protocol is specified as
`ctxwrite-v1` in `gateway/write/docs/protocol.md`, with an error catalogue, a published quota and type
policy, a design document, a security checklist, and a stable agent-facing anchor set. The
implementation is NOT in this branch: the Worker still answers 501 to every request, 46 of 48 source
files and all 32 test files are still stubs. Nothing in this document claims a running service, and no
route described in the contract has been implemented.

WHAT STAGE 5.1 ASKED FOR, AND WHAT EXISTS NOW

  5.1.1  Convert all approved ADRs into one canonical protocol contract: routes, query parameters,
         schemas, errors, links, quotas, session state, and lifecycle.
         DONE. `gateway/write/docs/protocol.md` is the canonical contract, 16 sections, and it is the
         single authoritative definition of the write protocol (G-11). It carries: the route table and
         every parameter's rules; the request/response schema (one envelope for success and failure);
         the error catalogue by reference, with `gateway/write/docs/error-catalog.md` as its authority
         (39 codes); the link rules; the quota and type policy by reference, with
         `src/config/quotas.json` and `src/config/type-policy.json` as the authorities; the session
         state machine; and the operation lifecycle. The four ADRs are folded in: the durable/ephemeral
         split (ADR 0001) into section 13, in-memory-only content (ADR 0002) into sections 7.2 and 18,
         GET side effects (ADR 0003) into section 10, and log hygiene (ADR 0004) into sections 10.3
         and 11. The Stage 1.4 decisions are folded in the same way: transport, quotas, types, the
         commit/seal/revoke semantics, and the amended Stage 1.4.6 credential decision.
         A section 0.1 table states the one authority per concern, so that no field, limit, error
         semantic or version string has two definitions.

  5.1.2  Replace example.com links in the agent prompt with a versioned canonical contract URL or
         generated links; do not require agents to construct endpoints from memory.
         DONE. `gateway/write/docs/proposal/agent-tool-prompt.md` no longer contains any example host
         (verified: `grep -rn "example\.com\|https://example/" gateway/write/` returns nothing). It now
         points at the versioned canonical contract URL
         `{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#<anchor>`, where the token is substituted by the
         operator's minting tool at mint time. In parallel the contract makes the links *generated*:
         every response carries `links.contract` (the absolute contract URL) and `links.next` (the legal
         next steps), so an agent never needs the substituted value and never constructs an endpoint.
         A prompt that still shows `{{` is detectable, and the contract says so.

  5.1.3  Define the root capability format, signature verification, expiry, task/work-order binding,
         key rotation, revocation, and authorization checks for every operation.
         DONE. Section 2 defines the capability; section 3 defines the canonical message
         (`ctxwrite-v1\nkid\nexp\norder\nplan\ntask\nwriter\nhead`), the signature
         (base64url-nopad HMAC-SHA256, constant-time compared) and every field's rule; section 14.3
         defines the verification order, with the signature verified before expiry, lifetime, revocation
         and policy. Key rotation is the `kid` selector: several keys are served at once, a retired key
         stops being accepted, and minting under a new key needs no outage. Revocation is operator-only
         and is checked in the Worker, before the Durable Object is touched, and again inside it, so a
         torn-down task still refuses a well-formed capability. Expiry is inclusive at the boundary and
         the gateway enforces its own maximum TTL regardless of the minter.

  5.1.4  Ensure each operation is bound to one task folder and one authorized writer; no request may
         choose an arbitrary repository, branch, or path.
         DONE. The task folder is *derived*, never supplied: the signed `plan`, `order` and `task`
         segments plus the configured `SUBMISSIONS_FOLDER_TEMPLATE` (section 2.4, 12.2). No request
         parameter, header or body can influence the repository, the branch or the folder, and a
         request that tries is refused with `destination-not-selectable`. The `path` parameter is always
         relative to the task folder and is validated by the path rules of section 5.1. The writer is
         bound into the signature and enforced by a durable single-writer lease: a different writer for
         the same task gets `409 writer-conflict` (section 2.5).

  5.1.5  Specify how a GET-only transport avoids accidental caching/prefetch and how residual URL/query
         leakage is handled. A secret root URL is a bearer capability; treat it accordingly.
         DONE. Section 2.2 states that the root URL is the secret, that the `writer` segment is an
         identity and not a second factor, and what follows from that. Section 10.1 gives the header
         set (`no-store` on the response and on the CDN, no redirects, `nosniff`, `no-referrer`,
         `noindex`), says why a response body that echoes the capability is a liability, and section 10.3
         lists the fields that must never appear in a body. The links in every envelope are
         root-relative and never carry the capability (section 4.4, rule 3). Section 10.1 also states
         the residual risk that the contract does *not* remove — an intermediary or the platform's own
         log will see the full request URL, and the payload is in the query string — and section 12.5
         requires the deployment to exclude the capability prefix from the platform's log retention and
         the operator to accept the risk in writing at deployment time.

  5.1.6  Define the submission repository/branch and credential boundary. Prefer isolated submissions
         storage or branch; restrict server code to a fixed destination and exact task folder. Document
         residual risk of a repository-scoped token.
         DONE. Section 12 implements the amended Stage 1.4.6 decision: a dedicated, isolated
         submissions repository and branch, named entirely by configuration, with the gateway never
         creating a repository, a branch or a folder. Section 12.4 states the residual risk plainly: the
         credential is repository-scoped and NOT path-scoped, so a leak could modify any task's
         submissions in that repository and nothing else — it cannot reach the private consumer
         repository, which is the point of the isolated repository. The documentation does not describe
         the credential as path-scoped. Section 12.3 defines the placeholder-file handling that Stage
         1.4.6 left to this stage: the placeholder is `.keep`, is never staged, committed, read or
         listed, is never deleted by the gateway, and a missing task folder at commit time is
         `404 task-folder-missing`. Section 12.5 pins the deployment defaults that R0-008 asks for:
         `workers_dev = false`, explicit routes, a deliberately reviewed `compatibility_date`, and no
         deployment credential in a pull-request job.

  5.1.7  Define staged-state recovery honestly. If staging is ephemeral, every response and runbook
         must state what can be lost; if delivery must survive restart, implement durable coordination/
         metadata and a recoverable content strategy without third-party content storage.
         DONE. Section 13 states the split in a table — durable: the lease, the session state, the
         idempotency keys and their outcomes, the sequence metadata, the quota ledger, the tombstone set
         and the commit record; ephemeral: the file contents — and then states the consequence
         explicitly: *the inventory of a task is durable and the content of a task is not*. Section 13.2
         defines what the agent sees (`content: present | missing | tombstoned`, `bytes_lost`,
         `bytes_accepted_total`) and the exact recovery path (status → create, which resets a file whose
         content was lost → re-append from seq=1). Section 13.3 gives the five commit outcomes, including
         `409 reconcile-required` for the indeterminate case, which is the state a human resolves and
         which the gateway must not guess at. No content is stored in any third-party content store: the
         staged bytes live in memory only, per ADR 0002.

THE EVIDENCE

  Every number below is the output of the command as written, run in this repository on this branch.

  python3 -m unittest discover -s template/engine/tools
      Ran 79 tests in 4.118s — OK

  python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'
      Ran 15 tests in 1.425s — OK

  release/test-release.sh
      22 passed, 0 failed

  bash tests/test_update.sh
      22 passed, 0 failed

  release/package.sh dist
      dist/build-engine-v0.5.0.tar.gz

  release/verify.sh dist/build-engine-v0.5.0.tar.gz
      verify: OK (build-engine-v0.5.0.tar.gz: 41 files, version 0.5.0)

  (cd gateway/write && npm ci && npm run typecheck && npm run check:bundle)
      tsc --noEmit: clean
      wrangler deploy --dry-run: "Total Upload: 0.75 KiB / gzip: 0.41 KiB",
      binding env.TASK_SESSION (TaskSession) Durable Object

  python3 gateway/write/scripts/check-contract-consistency.py
      OK: the contract documents agree  (exit 0)
      14 section anchors defined, 19 references resolve, 39 error codes anchor-linkable,
      the published quota block equals src/config/quotas.json,
      all 19 published types equal src/config/type-policy.json,
      no example host in the agent prompt

  The last command is a script this stage added, `gateway/write/scripts/check-contract-consistency.py`.
  It is the reproducibility requirement of G-06 made executable: it checks that the contract
  documents still agree with each other and with the two JSON authorities. Stage 5.5.8 wires it into CI.

  grep -rn "example\.com\|https://example/" gateway/write/
      (no output)

  GitHub Actions, run 40477006352 on this branch's head:
      ci: completed / success
        test:                              completed / success
        write gateway (typecheck + bundle): completed / success

WHAT THIS STAGE DELIBERATELY DID NOT DO

  - It did not implement a route. The Worker still answers 501. Every "DONE" above means *specified*,
    not *built*. The exit gate for Phase 5 forbids stubs in any feature claimed as supported, and no
    write-gateway feature is claimed as supported in this branch.
  - It did not write the operator runbook's procedures. `docs/operator-runbook.md` says so and lists
    what Stage 5.1 specified and which stage writes the procedure: the runbook is Stage 5.4.4.
  - It did not write the Phase 6 security sign-off. `docs/security-checklist.md` collects the
    contract's security requirements with the stage that checks each one, and is explicit that the
    sign-off needs a deployed gateway.
  - It did not replace the test stubs or pin a test runner. That is Stage 5.5.1.
  - It did not touch `wrangler.toml` or `.dev.vars.example`. The placeholders are Stage 5.2.2 and
    5.4.6, as the Stage 1.4.6 closeout recorded; this stage defines what they must become.
  - It did not edit `RELEASE-PLAN.md`. Progress is recorded in this closeout, per the repo's
    convention.

CONTRACT DECISIONS THIS STAGE MADE, FOR THE OPERATOR TO REVIEW

  These are within Stage 5.1's remit ("convert the approved ADRs into one canonical contract"), but
  they are choices, not derivations, so they are named here.

  1. The capability is a fixed-arity path, `…/w1/{kid}/{exp}/{order}/{plan}/{task}/{writer}/{head}/{sig}`,
     with the operation as the segment after it. The read scheme's principle — everything that
     authenticates is in the path, so a query-stripping proxy still works — was applied to the write
     side, and the read scheme's `ref` was replaced by `head` (the expected branch head, which is what
     makes a commit safe against a concurrent writer) and `writer`.
  2. The domain separator is `ctxwrite-v1`, not `ctxgate-v1`. A read signature can therefore never be
     replayed as a write capability. The two gateways must still use separate keys.
  3. `401` means "no valid capability was presented" and `403` means "your capability is valid and you
     may not proceed". This is the standard HTTP meaning and it *differs* from the read scheme, which
     answers 403 to everything pre-authentication. The reason: the write protocol must tell an agent
     why it stopped, and that information is only given to a caller who has already proved possession.
  4. Quotas count LIVE state, not cumulative history: a tombstone frees a slot and its bytes, so an
     agent that staged the wrong file can recover. Content lost to eviction also frees its bytes,
     because the bytes are gone — but the loss is reported (`bytes_lost`), not hidden.
  5. `seal` requires a prior successful commit, per plan task 5.3.7. A task with no deliverables is
     closed by the operator, not sealed by the agent.
  6. The placeholder file is named `.keep`.
  7. The task folder is a configured template (`SUBMISSIONS_FOLDER_TEMPLATE`) over the signed
     `plan`/`order`/`task`, not a hard-coded path.
  8. Envelope links are root-relative and never echo the capability, because a body that carries the
     capability is a body that gets logged.
  9. The contract is served by the gateway itself at `{base}/contract/ctxwrite-v1`, with the error
     catalogue and the published quota policy at sibling paths.

RISKS AND RESIDUAL RISK

  - R0-005 (GET-based mutation) remains ACCEPTED, not solved. The contract states the residual risk in
    section 10.1 and requires the operator to accept it in writing at deployment time, and the
    deployment to exclude the capability prefix from platform log retention. It cannot be engineered
    away while the transport is GET-only, and the transport is GET-only because the agent is GET-only.
  - R0-006 (the credential is not path-scoped) is unchanged in substance and is now documented
    honestly in section 12.4. The mitigation is the isolated repository plus operator review before
    transfer, not credential granularity, which GitHub does not offer.
  - R0-007 (ambiguous commit outcomes) is answered by the section 13.3 outcome table, including the
    `reconcile-required` state.
  - R0-011 (the submissions-to-consumer transfer path and the pre-creation tooling) is NOT closed by
    this stage. The contract defines the boundary the transfer has to respect; the transfer itself and
    the operator tooling remain undefined and outside the plan. The operator decision is still needed.
  - R0-008 (deployment defaults) is specified in section 12.5 but not applied to `wrangler.toml`,
    which is Stage 5.4.6.
  - New, and worth the operator's attention: the contract defines a `head` precondition on the commit,
    which means a task whose branch moves mid-flight must be re-minted. That is a deliberate
    trade — a race-free commit against a capability that has to be re-issued — and the operator may
    prefer the looser alternative.

UNRESOLVED QUESTIONS (also in protocol.md section 15)

  1. The submissions-to-consumer transfer path and the pre-creation tooling (R0-011): operator
     decision needed on whether they are added to the plan.
  2. `SUBMISSIONS_FOLDER_TEMPLATE` must be fixed against a real submissions repository before the
     pilot (Stage 6.1).
  3. The write-side conformance suite does not exist. The contract is written to be the thing a suite
     is derived from; the suite is Stage 5.5.
  4. The gateway's name is still open (`ctxgate` names the read gateway too). The protocol version
     `ctxwrite-v1` does not depend on it.
  5. The per-type JSON Schemas are unspecified. The mechanism exists; no schema is defined.
  6. The default maximum TTL of 7 days is carried over from the read side. A write capability is worth
     more than a read one and may deserve a shorter default.
  7. The writer-lease duration is unspecified. It must outlast a slow agent and not deadlock a task.

NEXT

  Phase 5, Stage 5.2: implement the core request and session lifecycle against `ctxwrite-v1` — the
  501 Worker entry becomes validated routing (5.2.1), root URL parsing and canonical signature
  verification (5.2.2), the Durable Object single-writer coordination (5.2.3), sequence numbers, chunk
  hashes and idempotent replay (5.2.4), the staging operations (5.2.5), atomic quota accounting
  (5.2.6), path/type/size enforcement (5.2.7), hypermedia links (5.2.8), and seal (5.2.9). The contract
  and the module map in `docs/architecture.md` are the assignment.
