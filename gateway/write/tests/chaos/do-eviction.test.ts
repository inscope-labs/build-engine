/**
 * Chaos: the Durable Object is evicted.
 *
 * This is the eviction the contract promises an exact behaviour for, and it is the one the
 * platform does on its own: the platform reclaims the object's memory, and the staged **content**
 * goes with it. The **inventory** is the platform's storage and it stays.
 *
 * The consequence is the split the whole design rests on: after the eviction the task's file list
 * is intact and the bytes are gone. The session has to say so — the agent's only way to find out
 * is to ask — and the agent has to be able to recover by sending the content again.
 *
 * The properties under test:
 *
 *  - the inventory survives: the file is still listed, and it is listed as *missing*;
 *  - the loss is **reported**, not hidden: the quota's `bytes_lost` grows;
 *  - the ledger is reconciled: the live bytes are back in line with the inventory;
 *  - a read says `file-not-staged`, which is the code that means "send it again";
 *  - re-creating and re-sending works, and the file is whole again;
 *  - the **commit record survives**, so a commit that already landed is not made a second time;
 *  - the **seal survives**, so a task that was sealed is still sealed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

test("the inventory survives an eviction and the content does not", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("notes.md", "hello\n");

    const before = await d.get("status");
    assert.equal(before.response.status, 200);
    const beforeBody = before.body.result as { files: { path: string; bytes: number }[]; quota: { live_bytes: number } };
    assert.equal(beforeBody.files[0]?.bytes, 6);
    assert.equal(beforeBody.quota.live_bytes, 6);

    // The eviction. The instance is recycled; the storage is the platform's and stays.
    d.namespace.restart(d.capability.task);

    const after = await d.get("status");
    assert.equal(after.response.status, 200);
    const afterBody = after.body.result as {
      files: { path: string; bytes: number; content: string }[];
      quota: { live_bytes: number; bytes_accepted_total: number; bytes_lost: number };
    };

    // The file is still in the inventory, and it is marked as having no content.
    assert.equal(afterBody.files.length, 1, "the inventory is durable");
    assert.equal(afterBody.files[0]?.path, "notes.md");
    assert.equal(afterBody.files[0]?.content, "missing", "the content is gone and the session says so");
    assert.equal(afterBody.files[0]?.bytes, 0);

    // The loss is reported, and the ledger is back in line.
    assert.equal(afterBody.quota.live_bytes, 0, "the live bytes follow the inventory");
    assert.equal(afterBody.quota.bytes_accepted_total, 6, "the bytes that were accepted are still counted");
    assert.equal(afterBody.quota.bytes_lost, 6, "the loss is reported, not hidden");
  } finally {
    await github.stop();
  }
});

test("a read after an eviction says the content must be sent again", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("notes.md", "hello\n");
    d.namespace.restart(d.capability.task);

    const read = await d.get("read", { path: "notes.md" });
    assert.equal(read.response.status, 409);
    assert.equal((read.body.error as { code: string }).code, "file-not-staged");

    // And an append to it is refused the same way: the file has to be created again first.
    const { sha256Hex, utf8 } = await import("../../src/util/hash.ts");
    const { base64url } = await import("../../src/util/base64.ts");
    const bytes = utf8("hello\n");
    const append = await d.get("append", {
      path: "notes.md",
      seq: "1",
      hash: await sha256Hex(bytes),
      data: base64url(bytes),
    });
    assert.equal(append.response.status, 409);
    assert.equal((append.body.error as { code: string }).code, "file-not-staged");
  } finally {
    await github.stop();
  }
});

test("the agent recovers by creating the file again and sending the content", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("notes.md", "hello\n");
    d.namespace.restart(d.capability.task);

    const created = await d.get("create", { path: "notes.md" });
    assert.equal(created.response.status, 200);
    assert.equal((created.body.result as { resurrected: boolean }).resurrected, true);

    // The content goes in again, from sequence 1, because the file starts again.
    const { sha256Hex, utf8 } = await import("../../src/util/hash.ts");
    const { base64url } = await import("../../src/util/base64.ts");
    const bytes = utf8("hello again\n");
    const written = await d.get("append", {
      path: "notes.md",
      seq: "1",
      hash: await sha256Hex(bytes),
      data: base64url(bytes),
    });
    assert.equal(written.response.status, 200, JSON.stringify(written.body.error));

    const read = await d.get("read", { path: "notes.md" });
    assert.equal(read.response.status, 200);
    const data = (read.body.result as { data: string }).data;
    const { base64urlDecode } = await import("../../src/util/base64.ts");
    assert.equal(new TextDecoder().decode(base64urlDecode(data)!), "hello again\n");
  } finally {
    await github.stop();
  }
});

test("a commit that already landed is not landed again after an eviction", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    const first = await d.get("commit", { files: "intro.md" });
    assert.equal(first.response.status, 200, JSON.stringify(first.body.error));
    assert.equal(github.commitCount, 2, "the seed commit and one delivery");

    // The Durable Object is recycled. The commit record and the idempotency store are in the
    // platform's storage, so they survive; the content does not.
    d.namespace.restart(d.capability.task);

    const again = await d.get("commit", { files: "intro.md" });
    assert.equal(again.response.status, 200, JSON.stringify(again.body.error));
    assert.equal((again.body.result as { replayed: boolean }).replayed, true, "the commit is a replay");
    assert.equal((again.body.result as { commit: string }).commit, (first.body.result as { commit: string }).commit);
    assert.equal(github.commitCount, 2, "the branch was not moved a second time");
  } finally {
    await github.stop();
  }
});

test("a seal survives an eviction, and the task is still frozen", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const commit = await d.get("commit", { files: "intro.md" });
    assert.equal(commit.response.status, 200);
    const seal = await d.get("seal");
    assert.equal(seal.response.status, 200);

    d.namespace.restart(d.capability.task);

    // The seal is durable, so the task is still sealed. The state is in the envelope, not in
    // the result: the result is the index's own description of the session.
    const index = await d.get("index");
    assert.equal(index.response.status, 200);
    assert.equal((index.body as { state: string }).state, "sealed");

    const write = await d.get("create", { path: "another.md" });
    assert.equal(write.response.status, 410);
    assert.equal((write.body.error as { code: string }).code, "task-sealed");
  } finally {
    await github.stop();
  }
});
