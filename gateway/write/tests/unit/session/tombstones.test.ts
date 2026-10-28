/**
 * The tombstones (plan task 5.5.2: the tombstone module).
 *
 * A soft delete has to do two things at once, and they pull in opposite directions:
 *
 *  - the file must keep its place in the inventory, so that a later commit can tell "deleted"
 *    from "never existed";
 *  - the file must stop counting against the live file count and the live byte budget, so that
 *    an agent that staged the wrong file can recover without asking the operator.
 *
 * The module is where that split is made, and the tests below pin both halves of it: the entry
 * stays, the bytes go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { allFiles, isLive, liveFiles, tombstone } from "../../../src/session/tombstones.ts";
import type { FileEntry } from "../../../src/types/session.ts";

/** A file entry, in each of the three states the inventory can hold. */
function entry(path: string, content: FileEntry["content"], bytes = 0): FileEntry {
  return { path, lastSeq: 1, bytes, hash: bytes === 0 ? null : "b".repeat(64), content };
}

test("a live file is one that is not tombstoned", () => {
  assert.equal(isLive(entry("a.md", "present", 10)), true);
  assert.equal(isLive(entry("a.md", "missing")), true);
  assert.equal(isLive(entry("a.md", "tombstoned")), false);
});

test("a tombstone drops the content and releases the bytes", () => {
  const { entry: dead, releasedBytes } = tombstone(entry("a.md", "present", 42));
  assert.equal(dead.content, "tombstoned");
  assert.equal(dead.bytes, 0);
  assert.equal(dead.hash, null, "the content is dropped, and so is its hash");
  assert.equal(dead.lastSeq, 0, "the file starts again when it is resurrected");
  assert.equal(releasedBytes, 42, "the bytes are released to the quota ledger");
});

test("tombstoning a file that is already tombstoned releases nothing", () => {
  const { entry: dead, releasedBytes } = tombstone(entry("a.md", "tombstoned"));
  assert.equal(dead.content, "tombstoned");
  assert.equal(releasedBytes, 0, "the bytes were released when it was tombstoned");
});

test("a file whose content was lost is still live, because it still holds a slot", () => {
  // A file whose content was lost to an eviction is not deleted: the agent can send the content
  // again, and the slot it holds is still the agent's.
  const { entry: dead, releasedBytes } = tombstone(entry("a.md", "missing"));
  assert.equal(dead.content, "tombstoned");
  assert.equal(releasedBytes, 0, "there were no bytes to release");
});

test("the live files are listed in a stable order", () => {
  const files = {
    "b.md": entry("b.md", "present", 1),
    "a.md": entry("a.md", "present", 2),
    "c.md": entry("c.md", "tombstoned"),
  };
  assert.deepEqual(liveFiles(files).map((file) => file.path), ["a.md", "b.md"]);
  // And the order does not depend on the order the object was built in.
  const reordered = { "c.md": files["c.md"]!, "a.md": files["a.md"]!, "b.md": files["b.md"]! };
  assert.deepEqual(liveFiles(reordered).map((file) => file.path), ["a.md", "b.md"]);
});

test("every file is listed, tombstoned or not", () => {
  const files = {
    "b.md": entry("b.md", "present", 1),
    "a.md": entry("a.md", "tombstoned"),
    "c.md": entry("c.md", "missing"),
  };
  assert.deepEqual(allFiles(files).map((file) => file.path), ["a.md", "b.md", "c.md"]);
});

test("a tombstoned file keeps its place, so a commit can tell deleted from never existed", () => {
  const files: Record<string, FileEntry> = { "a.md": entry("a.md", "present", 5) };
  const { entry: dead, releasedBytes } = tombstone(files["a.md"]!);
  files["a.md"] = dead;

  assert.ok("a.md" in files, "the file is still in the inventory");
  assert.equal(liveFiles(files).length, 0, "but it is not live");
  assert.equal(releasedBytes, 5, "and its bytes are back");
});
