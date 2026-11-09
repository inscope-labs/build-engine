# Link lifecycle: coverage and contract (read gateway)

**Status:** the contract in section 3 is **implemented and tested** in this repository. Section 4 lists what was
**not** verified. The plan (`V0.6.0-BUILD-PLAN.md` BE-4, item 16 and 17) asks for the console's link lifecycle:
*select exact files, bind to an immutable commit and work order, issue signed links, expiry, re-mint, revoke,
status, audit retrieval*, with the API shape landing in BE-0 and consumed by OC-6. No BE-0 document defined that
shape; this one does.

**One fact shapes everything below.** The read gateway **verifies and serves**. It never mints. Selecting, binding and
issuing are done by whoever holds the signing secret (today `template/engine/tools/ctxlink.py`; for the console,
operator-console's minter). The gateway's own lifecycle operations are the ones on its operator channel.

## 1. Coverage

Verdicts: **present** (specified, implemented, tested), **present but undocumented**, **documented but missing**,
**missing**, **added at S2**.

| # | Operation | Specified in | Implemented in | Tested by | Verdict |
|---|---|---|---|---|---|
| 1 | **Select exact files** | `conformance/SCHEME.md` §2 (one file per link), §5 (paths) | `template/engine/tools/ctxlink.py` (`mint` takes explicit paths and refuses unsafe ones); the gateway's own allow and deny rules, `gateway/read/production/src/policy.ts`, `deny.ts` | `gateway/read/production/test/unit/scheme.test.ts` "the path rules accept what Python accepts"; cases `B7-out-of-prefix`, `B7-denied-by-name`, `B8-dotdot-component` | present |
| 2 | **Bind to an immutable commit and a work order** | `conformance/SCHEME.md` §3 (the signed message holds `order` and `ref`), §4.4 | `ctxlink.py mint --order --ref`; `src/rules.ts` serves the file at the named commit only | cases `B1-content-is-pinned-to-the-named-commit`, `B4-tamper-ref`, `B4-tamper-order` | present |
| 3 | **Issue signed links** | `conformance/SCHEME.md` §3, §11 (the signer contract) | `ctxlink.py mint`; `scheme.ts` (`mint`) | `scheme.test.ts` "every valid vector is reproduced byte for byte", "mint reproduces the URL form of the vectors"; `conformance/signing-vectors.json` | present |
| 4 | **Expiry** | `SCHEME.md` §4.2; `docs/decisions/0003` | `src/policy.ts` (`MAX_TTL`, `CLOCK_SKEW_TOLERANCE`), `src/rules.ts` | cases `B3-valid-at-expiry`, `B3-refused-one-past-expiry`, `B5-ttl-too-long`, `B5-ttl-at-limit` | present |
| 5 | **Re-mint** | not specified before this document (section 2) | stateless: minting again issues a new link; nothing in the gateway changes | the vectors (a new `exp` gives a new signature) | present, **was undocumented**; documented in section 2 |
| 6 | **Revoke** | `ops/runbook.md` "Revoke an order"; `SCHEME.md` §7 check 8 | `src/index.ts` `POST /admin/revoke`, `src/state.ts` | cases `B6-revoked-order-refused`, `B6-other-order-unaffected`; `test/run-staging-checks.py` "a revoked order is refused ... inside the 2s bound", "still revoked after the Worker restarts"; `test/unit/state-client.test.ts` | present |
| 7 | **Status** | none | none: only a revoked-order **count** (`/admin/metrics`) existed; no way to ask about one order | `test/unit/replay.test.ts` (four order-status tests); `test/run-abuse-controls.py` "the status of one order reports its links and its cooldown" | **missing, added at S2**: `GET /admin/status?order=` |
| 8 | **Audit retrieval** | `ops/runbook.md` "Read the audit trail"; `SCHEME.md` §10 | `src/index.ts` `GET /admin/audit[?order=]`, `src/state.ts` | cases `B10-one-record-per-request`; `test/run-abuse-controls.py` (audit trail without leaks) | present (bounded ring; see section 4) |
| 9 | Replay visibility (not in the plan's list, added by ADR 0010) | `docs/release/CAPABILITY-CONFORMANCE.md` §5 | `GET /admin/replay`, `/admin/metrics` | `test/unit/replay.test.ts`; `test/run-abuse-controls.py` | added at S2 |

## 2. Re-mint

A link is a signature over `(kid, exp, order, ref, path)`. There is nothing to "renew": to re-issue a link, mint it
again with a new `exp`. The old link stays valid until **its own** expiry, unless the order is revoked. Three
consequences the console must respect:

- **Revocation is by order.** A revoked order stays revoked, so after a revoke the console must mint under a **new
  order id**. Re-minting under the same order produces a link the gateway refuses with `403 revoked`.
- **Re-minting does not shorten the old link's life.** To stop an old link working before it expires, revoke the
  order.
- **Re-minting is how a lost link is recovered.** It is also why a link is reusable until expiry (GAP R-1, accepted in
  ADR 0010); a retry presents the same link, and a re-mint presents a new one.

## 3. The contract: the gateway's operator channel

Base: the gateway's host. Every route below needs `Authorization: Bearer <OPERATOR_TOKEN>`, a credential separate
from the signing keys: holding a signing key grants none of these routes, and holding the operator token mints
nothing. A missing or wrong token is `401 unauthorised`. Responses are `Cache-Control: no-store`.

| Operation | Request | Success | Refusals |
|---|---|---|---|
| Revoke | `POST /admin/revoke`, JSON `{"order": "<order>"}` | `200 {"revoked": "<order>"}` | `400` no order; `503` the state store did not accept it (the revoke is never reported as done unless it was) |
| Status | `GET /admin/status?order=<order>` | `200` `{order, revoked, cooldown: {active, until}, links_tracked, links_repeated, most_presented, last_presented}` | `400` order id not `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; `503` state unavailable |
| Audit | `GET /admin/audit[?order=<order>]` | `200` NDJSON, one record per line, in the schema of `conformance/SCHEME.md` §10 | `503` state unavailable |
| Replay report | `GET /admin/replay` | `200` `{threshold, links_tracked, links_repeated, exceeded: [{order, ref, path, presentations, first, last}]}` | `503` |
| Metrics | `GET /admin/metrics` | `200` counters only | `503` |
| Health | `GET /healthz` (no token) | `200` the effective limits and key ids; never a secret | `503` misconfigured |

The status response carries **counts and flags only**: no path, no commit, no signature. `cooldown.until` is the unix
second the order's cooldown ends, or `null`. `last_presented` is the unix second of the most recent served
presentation of any of the order's links, or `null`.

Minting (steps 1 to 3 in section 1) is done outside the gateway: `ctxlink.py mint --base <host> --order <order> --ref
<40-hex commit> --ttl <seconds> <path>...` prints one URL per path, with `CTXGATE_SECRET` in the environment. A
signer that is not `ctxlink.py` follows the JSON-lines contract in `conformance/SCHEME.md` §11 and must reproduce
`conformance/signing-vectors.json` exactly.

## 4. What this document did not verify

- **The console's minter.** The operator-console documents read for this stage do not describe how the console issues
  **read** links (`docs/gateway-contract.md` covers Gateway A's routes, not the read gateway's link format). Whether
  OC-6 mints read links, and with which signer, is operator-console's work and is **unverified** from here. The
  contract above is what it must call and what it must reproduce.
- **Audit retention.** The audit trail is a bounded ring (`AUDIT_RETENTION`, default 500 records). Audit retrieval
  returns what the ring still holds; export it before it wraps (`ops/runbook.md`).
- **Revocation latency and restart behaviour** are covered by the staging checks against a local worker runtime; the
  deployed-gateway evidence is stage S4's gate, not this one.
