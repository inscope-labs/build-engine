/**
 * The idempotency store (protocol section 6.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveIdempotencyKey,
  lookupIdempotency,
  recordIdempotency,
  type IdempotencyStore,
} from "../../../src/session/idempotency.ts";
import { commitDigest } from "../../../src/commit/commit-idempotency.ts";

test("an explicit key is used as it is", () => {
  assert.equal(resolveIdempotencyKey("my-key-1234", "digest"), "my-key-1234");
});

test("a missing key is derived from the payload", () => {
  assert.equal(resolveIdempotencyKey(undefined, "digest"), "auto:digest");
  assert.equal(resolveIdempotencyKey("", "digest"), "auto:digest");
});

test("an unknown key is new", () => {
  const store: IdempotencyStore = {};
  assert.deepEqual(lookupIdempotency(store, "k", "digest"), { kind: "new" });
});

test("the same key with the same payload replays the recorded outcome", () => {
  const store = recordIdempotency({}, "k", "digest", { sha: "abc" }, 1000);
  const lookup = lookupIdempotency(store, "k", "digest");
  assert.equal(lookup.kind, "replay");
  if (lookup.kind !== "replay") return;
  assert.deepEqual(lookup.outcome, { sha: "abc" });
});

test("the same key with a different payload is a conflict", () => {
  const store = recordIdempotency({}, "k", "digest", { sha: "abc" }, 1000);
  const lookup = lookupIdempotency(store, "k", "other-digest");
  assert.equal(lookup.kind, "conflict");
});

test("the commit digest depends on the selection and on the content", async () => {
  const one = await commitDigest({ files: ["a.md"], hashes: { "a.md": "h1" } });
  const same = await commitDigest({ files: ["a.md"], hashes: { "a.md": "h1" } });
  const otherContent = await commitDigest({ files: ["a.md"], hashes: { "a.md": "h2" } });
  const otherSelection = await commitDigest({ files: ["b.md"], hashes: { "b.md": "h1" } });
  assert.equal(one, same);
  assert.notEqual(one, otherContent);
  assert.notEqual(one, otherSelection);
});

test("the commit digest does not depend on the order of the selection", async () => {
  const one = await commitDigest({ files: ["a.md", "b.md"], hashes: { "a.md": "h1", "b.md": "h2" } });
  const other = await commitDigest({ files: ["b.md", "a.md"], hashes: { "b.md": "h2", "a.md": "h1" } });
  assert.equal(one, other);
});
