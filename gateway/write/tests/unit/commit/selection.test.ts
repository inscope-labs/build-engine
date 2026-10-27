/**
 * The selection rules (protocol section 8.2).
 *
 * The selection is the agent's statement of what it wants committed, and the gateway's job is to
 * refuse anything it cannot honour exactly. A commit with fewer files than were asked for is a
 * surprising commit, and a surprising commit is worse than a refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateSelection, resolveInside } from "../../../src/commit/selection.ts";
import { scaffold } from "../../../src/staging/scaffold.ts";
import { appendChunk } from "../../../src/staging/append.ts";
import { deleteStaged } from "../../../src/staging/delete.ts";
import { emptyQuota } from "../../../src/session/quota-accounting.ts";
import { base64url } from "../../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../../src/util/hash.ts";
import { isKnownCode } from "../../../src/http/status-codes.ts";
import type { StagingContext } from "../../../src/types/session.ts";

const FOLDER = "plans/castiel-dev/submissions/10008-S001/10008-1-001-01";

/** A session with one staged file. */
async function context(path = "intro.md", content = "hello\n"): Promise<StagingContext> {
  const ctx: StagingContext = {
    files: {},
    chunks: {},
    contents: new Map(),
    quota: emptyQuota(),
  };
  scaffold(ctx, path);
  const bytes = utf8(content);
  await appendChunk(ctx, path, 1, await sha256Hex(bytes), base64url(bytes));
  return ctx;
}

test("a live staged file is selected", async () => {
  const ctx = await context();
  const result = validateSelection(["intro.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]!.path, "intro.md");
  assert.equal(result.files[0]!.content, "hello\n");
  assert.equal(result.files[0]!.repositoryPath, `${FOLDER}/intro.md`);
  assert.equal(result.hashes["intro.md"], result.files[0]!.hash);
});

test("an empty selection is refused", async () => {
  const ctx = await context();
  const result = validateSelection([], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "empty-selection");
});

test("a repeated path is refused rather than deduplicated", async () => {
  const ctx = await context();
  const result = validateSelection(["intro.md", "intro.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "repeated-parameter");
});

test("a path that was never staged is refused", async () => {
  const ctx = await context();
  const result = validateSelection(["nowhere.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "file-not-staged");
});

test("a tombstoned path is refused, and is not silently dropped", async () => {
  const ctx = await context();
  deleteStaged(ctx, "intro.md");
  const result = validateSelection(["intro.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "file-not-staged");
});

test("a file whose content was lost is refused", async () => {
  const ctx = await context();
  // The inventory still lists the file; the memory does not have it. That is an eviction.
  ctx.contents.delete("intro.md");
  const result = validateSelection(["intro.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "file-not-staged");
});

test("the placeholder is never committable", async () => {
  const ctx = await context();
  const result = validateSelection([".keep"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "malformed-path");
});

test("a path that escapes the task folder is refused", async () => {
  const ctx = await context();
  const result = validateSelection(["../escape.md"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "malformed-path");
});

test("a path with a type the policy does not allow is refused", async () => {
  const ctx = await context("notes.bin", "x");
  const result = validateSelection(["notes.bin"], ctx.files, ctx.contents, FOLDER);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "type-not-allowed");
  assert.equal(isKnownCode(result.code), true);
});

test("every refusal uses a code the catalogue defines", async () => {
  const ctx = await context();
  const attempts = [
    [],
    ["intro.md", "intro.md"],
    ["nowhere.md"],
    ["../escape.md"],
    [".keep"],
  ];
  for (const attempt of attempts) {
    const result = validateSelection(attempt, ctx.files, ctx.contents, FOLDER);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(isKnownCode(result.code), true, result.code);
  }
});

test("a path that resolves inside the folder is kept inside it", () => {
  assert.equal(resolveInside(FOLDER, "intro.md"), `${FOLDER}/intro.md`);
  assert.equal(resolveInside(FOLDER, "notes/intro.md"), `${FOLDER}/notes/intro.md`);
});

test("a path that resolves outside the folder is refused", () => {
  assert.equal(resolveInside(FOLDER, "../escape.md"), null);
  assert.equal(resolveInside(FOLDER, "notes/../../escape.md"), null);
  assert.equal(resolveInside(FOLDER, ""), null);
});
