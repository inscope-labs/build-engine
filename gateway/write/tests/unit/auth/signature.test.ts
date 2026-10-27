/**
 * The capability signature (protocol section 3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalMessage,
  sign,
  verifySignature,
  isKid,
  isExp,
  isOrder,
  isPlan,
  isTask,
  isWriter,
  isHead,
  isSignature,
} from "../../../src/auth/signature.ts";
import { capabilityFields, TEST_SECRET, TEST_KID } from "../../helpers/mock-worker.ts";

const fields = capabilityFields();

test("the canonical message is the eight fields, LF separated, with no trailing separator", () => {
  const message = new TextDecoder().decode(canonicalMessage(fields));
  assert.equal(
    message,
    `ctxwrite-v1\n${fields.kid}\n${fields.exp}\n${fields.order}\n${fields.plan}\n${fields.task}\n${fields.writer}\n${fields.head}`,
  );
  assert.equal(message.endsWith("\n"), false);
  assert.equal(message.split("\n").length, 8);
});

test("the signature verifies", async () => {
  const sig = await sign(TEST_SECRET, fields);
  assert.equal(sig.length, 43);
  assert.equal(await verifySignature(TEST_SECRET, fields, sig), true);
});

test("a tampered field never verifies", async () => {
  const sig = await sign(TEST_SECRET, fields);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, exp: fields.exp + 1 }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, order: "10008-S002" }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, plan: "other-plan" }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, task: "10008-1-001-02" }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, writer: "agent-8" }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, head: "b".repeat(40) }, sig), false);
  assert.equal(await verifySignature(TEST_SECRET, { ...fields, kid: "k2" }, sig), false);
});

test("another secret never verifies", async () => {
  const sig = await sign(TEST_SECRET, fields);
  assert.equal(await verifySignature("another-secret", fields, sig), false);
});

test("a malformed signature never verifies", async () => {
  assert.equal(await verifySignature(TEST_SECRET, fields, "A".repeat(43)), false);
  assert.equal(await verifySignature(TEST_SECRET, fields, "too-short"), false);
  assert.equal(await verifySignature(TEST_SECRET, fields, `${"A".repeat(42)}+`), false);
});

test("the domain separator keeps a read-side signature from verifying here", async () => {
  // The read scheme's message is "ctxgate-v1\nkid\nexp\norder\nref\npath" and its domain
  // separator is ctxgate-v1. A signature over that message must not verify against a write
  // capability, and the write signature must not verify over a read message.
  const readMessage = `ctxgate-v1\n${fields.kid}\n${fields.exp}\n${fields.order}\n${"a".repeat(40)}\namk/spec.md`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(readMessage));
  let binary = "";
  for (const b of new Uint8Array(mac)) binary += String.fromCharCode(b);
  const readSig = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(await verifySignature(TEST_SECRET, fields, readSig), false);
});

test("the field rules hold", () => {
  assert.equal(isKid(TEST_KID), true);
  assert.equal(isKid(""), false);
  assert.equal(isKid("k".repeat(17)), false);
  assert.equal(isKid("k1\n"), false);

  assert.equal(isExp("2000000000"), true);
  assert.equal(isExp("0"), true);
  assert.equal(isExp("00"), false);
  assert.equal(isExp("-1"), false);
  assert.equal(isExp("1.5"), false);

  assert.equal(isOrder("10008-S001"), true);
  assert.equal(isOrder("-leading"), false);
  assert.equal(isOrder(""), false);

  assert.equal(isPlan("castiel-dev"), true);
  assert.equal(isPlan("Castiel"), false);

  assert.equal(isTask("10008-1-001-01"), true);
  assert.equal(isTask("10008-0-001-01"), false);
  assert.equal(isTask("task-1"), false);

  assert.equal(isWriter("agent-7"), true);
  assert.equal(isWriter(""), false);

  assert.equal(isHead("a".repeat(40)), true);
  assert.equal(isHead("A".repeat(40)), false);
  assert.equal(isHead("a".repeat(39)), false);

  assert.equal(isSignature("A".repeat(43)), true);
  assert.equal(isSignature("A".repeat(42)), false);
});
