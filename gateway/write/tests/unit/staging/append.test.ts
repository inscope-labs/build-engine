/**
 * Appending and replacing content (protocol section 6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { appendChunk, writeChunk } from "../../../src/staging/append.ts";
import { replaceContent } from "../../../src/staging/replace.ts";
import { readStaged } from "../../../src/staging/read.ts";
import { scaffold } from "../../../src/staging/scaffold.ts";
import { emptyQuota } from "../../../src/session/quota-accounting.ts";
import { base64url, base64urlDecodeText } from "../../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../../src/util/hash.ts";
import { isKnownCode } from "../../../src/http/status-codes.ts";
import type { StagingContext } from "../../../src/types/session.ts";

/** A fresh staging context. */
function context(): StagingContext {
  return { files: {}, chunks: {}, contents: new Map(), quota: emptyQuota() };
}

/** The parameters of a chunk write. */
async function chunk(text: string): Promise<{ seq: number; hash: string; data: string }> {
  const bytes = utf8(text);
  return { seq: 1, hash: await sha256Hex(bytes), data: base64url(bytes) };
}

test("a chunk is appended to an empty file", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const c = await chunk("hello\n");
  const outcome = await appendChunk(ctx, "intro.md", c.seq, c.hash, c.data);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(ctx.contents.get("intro.md"), "hello\n");
  assert.equal(ctx.files["intro.md"]?.lastSeq, 1);
  assert.equal(ctx.files["intro.md"]?.bytes, 6);
  assert.equal(ctx.quota.liveBytes, 6);
  assert.equal(ctx.quota.bytesAcceptedTotal, 6);
});

test("a second chunk is appended after the first", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const one = await chunk("hello\n");
  assert.equal((await appendChunk(ctx, "intro.md", 1, one.hash, one.data)).ok, true);
  const two = await chunk("world\n");
  const outcome = await appendChunk(ctx, "intro.md", 2, two.hash, two.data);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(ctx.contents.get("intro.md"), "hello\nworld\n");
  assert.equal(ctx.files["intro.md"]?.lastSeq, 2);
  assert.equal(ctx.quota.liveBytes, 12);
});

test("a repeated chunk is a replay and changes nothing", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const one = await chunk("hello\n");
  assert.equal((await appendChunk(ctx, "intro.md", 1, one.hash, one.data)).ok, true);
  const replay = await appendChunk(ctx, "intro.md", 1, one.hash, one.data);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.replayed, true);
  assert.equal(ctx.contents.get("intro.md"), "hello\n");
  assert.equal(ctx.quota.bytesAcceptedTotal, 6, "a replay must not accept the bytes twice");
});

test("a different hash at the same sequence number is refused", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const one = await chunk("hello\n");
  assert.equal((await appendChunk(ctx, "intro.md", 1, one.hash, one.data)).ok, true);
  const other = await chunk("goodbye\n");
  const outcome = await appendChunk(ctx, "intro.md", 1, other.hash, other.data);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "sequence-conflict");
});

test("a skipped sequence number is refused", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const one = await chunk("hello\n");
  const outcome = await appendChunk(ctx, "intro.md", 3, one.hash, one.data);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "sequence-gap");
});

test("a hash that does not match the data is refused", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const c = await chunk("hello\n");
  const outcome = await appendChunk(ctx, "intro.md", 1, "f".repeat(64), c.data);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "hash-mismatch");
});

test("data that is not base64url is refused", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const outcome = await appendChunk(ctx, "intro.md", 1, "a".repeat(64), "not base64!!");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "invalid-parameter");
});

test("a write to an unknown path creates the file", async () => {
  const ctx = context();
  const c = await chunk("hello\n");
  const outcome = await appendChunk(ctx, "intro.md", 1, c.hash, c.data);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(ctx.files["intro.md"]?.content, "present");
  assert.equal(ctx.contents.get("intro.md"), "hello\n");
});

test("a write to a file whose content was lost is refused", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  ctx.files["intro.md"] = { ...ctx.files["intro.md"]!, content: "missing" };
  const c = await chunk("hello\n");
  const outcome = await appendChunk(ctx, "intro.md", 1, c.hash, c.data);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "file-not-staged");
});

test("a replace sets the content rather than growing it", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const one = await chunk("hello\n");
  assert.equal((await appendChunk(ctx, "intro.md", 1, one.hash, one.data)).ok, true);
  const two = await chunk("bye\n");
  const outcome = await replaceContent(ctx, "intro.md", 2, two.hash, two.data);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(ctx.contents.get("intro.md"), "bye\n");
  assert.equal(ctx.files["intro.md"]?.bytes, 4);
  assert.equal(ctx.quota.liveBytes, 4);
  // The task accepted 6 bytes and then 4: the cumulative total grows by what was accepted.
  assert.equal(ctx.quota.bytesAcceptedTotal, 10);
});

test("binary content is refused, with a code the catalogue defines", async () => {
  const ctx = context();
  const bytes = new Uint8Array([0x00, 0x01, 0x02]);
  const outcome = await writeChunk(ctx, "intro.md", 1, await sha256Hex(bytes), base64url(bytes), "append");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  // The policy's own reason is "binary". The code the agent is given is "not-text", because
  // "binary" is not a code the contract defines, and an undefined code is a 500 (F0-034).
  assert.equal(outcome.code, "not-text");
  assert.equal(isKnownCode(outcome.code), true);
});

test("reading back returns the content, the hash and the sequence number", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  const c = await chunk("hello\n");
  assert.equal((await appendChunk(ctx, "intro.md", 1, c.hash, c.data)).ok, true);
  const read = await readStaged(ctx, "intro.md");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(base64urlDecodeText(String(read.result.data)), "hello\n");
  assert.equal(read.result.seq, 1);
  assert.equal(read.result.bytes, 6);
});

test("reading a file that is not there is refused", async () => {
  const ctx = context();
  const read = await readStaged(ctx, "missing.md");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "file-not-found");
});

test("reading a file whose content was lost is refused, and says so", async () => {
  const ctx = context();
  assert.equal(scaffold(ctx, "intro.md").ok, true);
  ctx.files["intro.md"] = { ...ctx.files["intro.md"]!, content: "missing" };
  const read = await readStaged(ctx, "intro.md");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "file-not-staged");
});
