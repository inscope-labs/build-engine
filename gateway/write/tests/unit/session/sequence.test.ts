/**
 * Sequence numbers and chunk hashes (protocol section 6.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decideSequence, pushIdentity } from "../../../src/session/sequence.ts";
import { REPLAY_WINDOW } from "../../../src/config/constants.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("the next sequence number is accepted", () => {
  assert.deepEqual(decideSequence(0, [], 1, HASH_A), { ok: true, mode: "accepted" });
  assert.deepEqual(decideSequence(3, [], 4, HASH_A), { ok: true, mode: "accepted" });
});

test("a repeated chunk with the same hash is a replay", () => {
  const window = pushIdentity([], { seq: 1, hash: HASH_A });
  assert.deepEqual(decideSequence(1, window, 1, HASH_A), { ok: true, mode: "replay" });
});

test("a different hash at an old sequence number is a conflict", () => {
  const window = pushIdentity([], { seq: 1, hash: HASH_A });
  const decision = decideSequence(1, window, 1, HASH_B);
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.code, "sequence-conflict");
});

test("a replay that has fallen out of the window is a conflict, not a replay", () => {
  // The window is bounded, so the gateway cannot prove an old chunk is a replay. It fails closed.
  const window = pushIdentity([], { seq: 1, hash: HASH_A });
  const decision = decideSequence(1, window, 1, HASH_B);
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.code, "sequence-conflict");
});

test("a sequence number that skips one is a gap", () => {
  const decision = decideSequence(1, [], 3, HASH_A);
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.equal(decision.code, "sequence-gap");
});

test("the replay window is bounded", () => {
  let window: { seq: number; hash: string }[] = [];
  for (let seq = 1; seq <= 100; seq++) window = pushIdentity(window, { seq, hash: HASH_A });
  assert.equal(window.length, REPLAY_WINDOW);
  assert.equal(window[window.length - 1]?.seq, 100);
  assert.equal(window[0]?.seq, 100 - REPLAY_WINDOW + 1);
});

test("pushing the same sequence number replaces it rather than duplicating it", () => {
  let window = pushIdentity([], { seq: 1, hash: HASH_A });
  window = pushIdentity(window, { seq: 1, hash: HASH_B });
  assert.equal(window.length, 1);
  assert.equal(window[0]?.hash, HASH_B);
});
