/**
 * Scaffolding and soft delete (protocol section 5.3, 13.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { scaffold, releaseFile } from "../../../src/staging/scaffold.ts";
import { deleteStaged } from "../../../src/staging/delete.ts";
import { emptyQuota, addBytes } from "../../../src/session/quota-accounting.ts";
import type { StagingContext } from "../../../src/types/session.ts";

/** A fresh staging context. */
function context(): StagingContext {
  return { files: {}, chunks: {}, contents: new Map(), quota: emptyQuota() };
}

test("a scaffold creates an empty file and takes a slot", () => {
  const ctx = context();
  const outcome = scaffold(ctx, "intro.md");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.created, true);
  assert.equal(outcome.result.resurrected, false);
  assert.equal(ctx.files["intro.md"]?.content, "present");
  assert.equal(ctx.files["intro.md"]?.lastSeq, 0);
  assert.equal(ctx.files["intro.md"]?.bytes, 0);
  assert.equal(ctx.quota.liveFiles, 1);
  assert.equal(ctx.contents.get("intro.md"), "");
});

test("scaffolding a file that already has content is refused", () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const again = scaffold(ctx, "intro.md");
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "path-exists");
});

test("a file whose content was lost is resurrected by a scaffold", () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  // The content is gone, as it would be after an isolate eviction.
  ctx.contents.delete("intro.md");
  ctx.files["intro.md"] = { ...ctx.files["intro.md"]!, content: "missing", bytes: 0 };

  const outcome = scaffold(ctx, "intro.md");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.resurrected, true);
  assert.equal(ctx.files["intro.md"]?.content, "present");
  assert.equal(ctx.files["intro.md"]?.lastSeq, 0);
});

test("a tombstoned file is resurrected by a scaffold, and takes a slot again", () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  ctx.quota = addBytes(ctx.quota, 50);
  ctx.files["intro.md"] = { ...ctx.files["intro.md"]!, bytes: 50 };

  const deleted = deleteStaged(ctx, "intro.md");
  assert.equal(deleted.ok, true);
  assert.equal(ctx.quota.liveFiles, 0);
  assert.equal(ctx.quota.liveBytes, 0);

  const outcome = scaffold(ctx, "intro.md");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.resurrected, true);
  assert.equal(ctx.quota.liveFiles, 1);
});

test("releasing a file that is not there releases nothing", () => {
  const ctx = context();
  assert.equal(releaseFile(ctx, "missing.md"), 0);
});
