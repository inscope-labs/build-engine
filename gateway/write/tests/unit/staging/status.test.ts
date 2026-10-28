/**
 * The status view (plan task 5.5.2: the staging modules).
 *
 * `status` is what an agent calls when it is unsure, so it has to answer the one question that
 * matters: **is my file still there?**
 *
 * The answer is the `content` field, and the three values are three different situations:
 *
 *  - `present` — the file is staged and its content is here;
 *  - `missing` — the file was staged and its content was **lost to an isolate eviction**. The
 *    agent has to send the content again;
 *  - `tombstoned` — the file was deleted, softly. It is not deliverable.
 *
 * The quota view is reported alongside, in the units the contract publishes, and the live
 * figures are the ones the limits apply to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { quotaView, selectableFiles, snapshot } from "../../../src/staging/status.ts";
import { emptyQuota } from "../../../src/session/quota-accounting.ts";
import type { FileEntry, StagingContext } from "../../../src/types/session.ts";

/** A staging context with three files in the three states. */
function context(): StagingContext {
  const files: Record<string, FileEntry> = {
    "b.md": { path: "b.md", lastSeq: 2, bytes: 10, hash: "b".repeat(64), content: "present" },
    "a.md": { path: "a.md", lastSeq: 1, bytes: 5, hash: "a".repeat(64), content: "present" },
    "c.md": { path: "c.md", lastSeq: 0, bytes: 0, hash: null, content: "missing" },
    "d.md": { path: "d.md", lastSeq: 0, bytes: 0, hash: null, content: "tombstoned" },
  };
  return {
    files,
    chunks: {},
    contents: new Map([
      ["a.md", "hello\n"],
      ["b.md", "world\n"],
    ]),
    quota: { ...emptyQuota(), liveFiles: 2, liveBytes: 15, bytesAcceptedTotal: 20, bytesLost: 5 },
  };
}

test("the snapshot lists every file, in a stable order, with its state", () => {
  const view = snapshot(context(), "open", { writer: "agent-7", claimedAt: 1, expiresAt: 2 }, null);

  assert.deepEqual(view.files.map((file) => file.path), ["a.md", "b.md", "c.md", "d.md"]);
  assert.deepEqual(view.files.map((file) => file.content), ["present", "present", "missing", "tombstoned"]);
  assert.deepEqual(view.files.map((file) => file.tombstoned), [false, false, false, true]);
  assert.equal(view.files[0]?.last_seq, 1);
  assert.equal(view.files[0]?.bytes, 5);
});

test("the snapshot reports the writer and the lease", () => {
  const withLease = snapshot(context(), "open", { writer: "agent-7", claimedAt: 1, expiresAt: 2 }, null);
  assert.equal(withLease.writer, "agent-7");
  assert.equal(withLease.leaseExpiresAt, 2);

  const without = snapshot(context(), "open", null, null);
  assert.equal(without.writer, null);
  assert.equal(without.leaseExpiresAt, null);
});

test("the snapshot reports the session state and the commit", () => {
  const view = snapshot(context(), "sealed", null, {
    sha: "c".repeat(40),
    paths: ["a.md"],
    hashes: {},
    actor: "agent-7",
    task: "10008-1-001-01",
    order: "10008-S001",
    at: 1_800_000_000,
  });
  assert.equal(view.state, "sealed");
  assert.equal(view.committed?.sha, "c".repeat(40));
});

test("the quota view is in the units the contract publishes", () => {
  const view = quotaView({
    liveFiles: 2,
    liveBytes: 15,
    bytesAcceptedTotal: 20,
    bytesLost: 5,
  });
  assert.deepEqual(view, {
    live_files: 2,
    live_bytes: 15,
    bytes_accepted_total: 20,
    bytes_lost: 5,
  });
});

test("the selectable files are the ones that are not tombstoned", () => {
  // A file whose content was lost is still in the inventory, and the agent may re-send the
  // content — so it is not tombstoned and it is listed. What refuses it is the **selection**
  // (src/commit/selection.ts), because a file with no content has nothing to commit. The two
  // modules answer two different questions and they are allowed to disagree here.
  assert.deepEqual(selectableFiles(context()), ["a.md", "b.md", "c.md"]);
});
