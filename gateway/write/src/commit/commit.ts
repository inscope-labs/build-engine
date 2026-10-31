// src/commit/commit.ts: GET …/commit?files=…
//
// **Stage 5.3.** The GitHub commit and delivery.
//
// Stage 5.2 implements the session half of the commit: the route, the parameter validation, the
// selection parsing, the idempotency store and the durable commit record. The half that is
// missing is the delivery: the fixed-destination GitHub client, the expected-SHA precondition
// against the live branch head, the commit itself, and the mapping of GitHub's failures onto the
// gateway's error codes.
//
// Until Stage 5.3 lands, the `commit` route answers `501 not-implemented`, which is a documented
// code in the error catalogue and not a protocol error. The seal precondition therefore cannot
// be satisfied through the agent route either: a task can only be sealed once a commit has
// succeeded, and no commit can succeed until Stage 5.3. The seal transition itself is
// implemented and is exercised by the tests, which record a commit through the session's own
// interface — the same interface Stage 5.3 will use.
//
// What Stage 5.3 will implement here, in the order of the plan's tasks:
//   5.3.1  a fixed-destination GitHub client with bounded timeouts and safe error mapping;
//   5.3.2  selection validation against staged, non-deleted, policy-compliant files;
//   5.3.3  commit idempotency for the same selection and content;
//   5.3.4  rate limits, 5xx retries, timeout-after-success, partial failure, SHA conflicts;
//   5.3.5  the commit goes only into the designated task folder on the approved branch;
//   5.3.6  the commit SHA, paths, hashes, binding, result and timestamp are recorded;
//   5.3.7  seal happens only after a successful commit.
//
// The contract for all of that is `gateway/write/docs/protocol.md` section 8.
export {};
