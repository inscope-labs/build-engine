/**
 * The commit's idempotency (protocol section 6.3, 8.1).
 *
 * The digest is what makes "the same key with different content" detectable, and the store is
 * what makes "the same key with the same content" a replay instead of a second commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { commitDigest } from "../../../src/commit/commit-idempotency.ts";
import {
  lookupIdempotency,
  recordIdempotency,
  resolveIdempotencyKey,
  type IdempotencyStore,
} from "../../../src/session/idempotency.ts";

test("the same selection and the same content give the same digest", async () => {
  const a = await commitDigest({ files: ["a.md", "b.md"], hashes: { "a.md": "aa", "b.md": "bb" } });
  const b = await commitDigest({ files: ["b.md", "a.md"], hashes: { "b.md": "bb", "a.md": "aa" } });
  assert.equal(a, b, "the order of the selection must not change the digest");
});

test("a different selection gives a different digest", async () => {
  const a = await commitDigest({ files: ["a.md"], hashes: { "a.md": "aa" } });
  const b = await commitDigest({ files: ["b.md"], hashes: { "b.md": "aa" } });
  assert.notEqual(a, b);
});

test("the same selection with different content gives a different digest", async () => {
  const a = await commitDigest({ files: ["a.md"], hashes: { "a.md": "aa" } });
  const b = await commitDigest({ files: ["a.md"], hashes: { "a.md": "ab" } });
  assert.notEqual(a, b);
});

test("an explicit key is used as it is", () => {
  assert.equal(resolveIdempotencyKey("client-key-1234", "digest"), "client-key-1234");
});

test("without a key the digest becomes the key, so a plain retry is idempotent", () => {
  const derived = resolveIdempotencyKey(undefined, "digest");
  assert.equal(derived, "auto:digest");
  assert.equal(resolveIdempotencyKey("", "digest"), derived);
});

test("a key that is not in the store is new", () => {
  const store: IdempotencyStore = {};
  assert.equal(lookupIdempotency(store, "k", "d").kind, "new");
});

test("the same key with the same digest replays the recorded outcome", () => {
  const store = recordIdempotency({}, "k", "d", { commit: "abc" }, 100);
  const lookup = lookupIdempotency(store, "k", "d");
  assert.equal(lookup.kind, "replay");
  if (lookup.kind !== "replay") return;
  assert.deepEqual(lookup.outcome, { commit: "abc" });
});

test("the same key with a different digest is a conflict, and the outcome is not returned", () => {
  const store = recordIdempotency({}, "k", "d", { commit: "abc" }, 100);
  const lookup = lookupIdempotency(store, "k", "other");
  assert.equal(lookup.kind, "conflict");
});
