/**
 * Soft delete (protocol section 5.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deleteStaged } from "../../../src/staging/delete.ts";
import { scaffold } from "../../../src/staging/scaffold.ts";
import { emptyQuota, addBytes, addFile } from "../../../src/session/quota-accounting.ts";
import type { StagingContext } from "../../../src/types/session.ts";

/** A fresh staging context. */
function context(): StagingContext {
  return { files: {}, chunks: {}, contents: new Map(), quota: emptyQuota() };
}

test("a delete tombstones the file and releases its bytes", () => {
  const ctx = context();
  ctx.quota = addFile(ctx.quota);
  ctx.quota = addBytes(ctx.quota, 50);
  ctx.files["intro.md"] = { path: "intro.md", lastSeq: 2, bytes: 50, hash: "h", content: "present" };
  ctx.contents.set("intro.md", "hello");

  const outcome = deleteStaged(ctx, "intro.md");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.released_bytes, 50);
  assert.equal(ctx.files["intro.md"]?.content, "tombstoned");
  assert.equal(ctx.files["intro.md"]?.bytes, 0);
  assert.equal(ctx.contents.has("intro.md"), false);
  assert.equal(ctx.quota.liveFiles, 0);
  assert.equal(ctx.quota.liveBytes, 0);
  // The bytes the task accepted are still counted as accepted.
  assert.equal(ctx.quota.bytesAcceptedTotal, 50);
});

test("a tombstoned file keeps its place in the inventory", () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  assert.equal(deleteStaged(ctx, "intro.md").ok, true);
  // The entry is still there: a later commit can tell "deleted" from "never existed".
  assert.equal(ctx.files["intro.md"]?.content, "tombstoned");
});

test("deleting a file that is not there is refused", () => {
  const ctx = context();
  const outcome = deleteStaged(ctx, "missing.md");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "file-not-found");
});

test("deleting twice is refused the second time", () => {
  const ctx = context();
  ctx.files["intro.md"] = { path: "intro.md", lastSeq: 1, bytes: 5, hash: "h", content: "present" };
  ctx.contents.set("intro.md", "hello");
  assert.equal(deleteStaged(ctx, "intro.md").ok, true);
  const again = deleteStaged(ctx, "intro.md");
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "file-not-found");
});
