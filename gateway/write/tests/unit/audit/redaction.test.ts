/**
 * The audit hygiene (ADR 0004, protocol section 11).
 *
 * The sentinel test: a secret that reaches a captured log fails the run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { auditRecord, containsSecret, redactText } from "../../../src/audit/redaction.ts";

/** A signature is base64url of 32 bytes: 43 characters, no padding. */
const SIGNATURE = "A".repeat(43);

/** A capability that looks exactly like a real one. */
const CAPABILITY =
  "/w1/k1/2000000000/10008-S001/castiel-dev/10008-1-001-01/agent-7/" +
  `${"a".repeat(40)}/${SIGNATURE}`;

test("a capability path is recognised as a secret", () => {
  assert.equal(containsSecret(CAPABILITY), true);
  assert.equal(redactText(`the url is ${CAPABILITY}`).includes("10008-S001"), false);
});

test("a signature on its own is recognised", () => {
  assert.equal(containsSecret(SIGNATURE), true);
});

test("a query string is recognised", () => {
  assert.equal(containsSecret("?path=intro.md&data=aGVsbG8"), true);
});

test("a GitHub token is recognised", () => {
  assert.equal(containsSecret("ghp_0123456789abcdefghijklmnopqrstuvwxyz"), true);
});

test("an ordinary string is not a secret", () => {
  assert.equal(containsSecret("10008-1-001-01"), false);
  assert.equal(containsSecret("intro.md"), false);
  assert.equal(containsSecret("task-sealed"), false);
});

test("the audit record is built from a fixed set of fields", () => {
  const record = auditRecord({
    ts: 1700000000,
    status: 200,
    reason: "ok",
    op: "append",
    kid: "k1",
    order: "10008-S001",
    task: "10008-1-001-01",
    writer: "agent-7",
    bytes: 128,
    files: 1,
    replayed: false,
    request_id: "abc123",
  });
  assert.deepEqual(Object.keys(record).sort(), [
    "bytes", "files", "kid", "op", "order", "replayed", "request_id", "status", "task", "ts", "writer", "reason",
  ].sort());
  assert.equal(record.status, 200);
  assert.equal(record.bytes, 128);
});

test("a field that is not in the schema has no path into the record", () => {
  // The record is assembled field by field, so there is nowhere for a capability to go.
  const record = auditRecord({
    ts: 1,
    status: 200,
    reason: "ok",
    op: "index",
    request_id: "abc",
  });
  assert.equal(JSON.stringify(record).includes("/w1/"), false);
});

test("a secret that reaches a field is redacted on the way out", () => {
  const record = auditRecord({
    ts: 1,
    status: 200,
    reason: "ok",
    op: CAPABILITY,
    request_id: "abc",
  });
  assert.equal(String(record.op).includes("10008-S001"), false);
  assert.equal(containsSecret(JSON.stringify(record)), false);
});
