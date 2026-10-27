/**
 * The commit's idempotency, end to end (protocol section 13.3).
 *
 * The table the contract states is the specification for this file:
 *
 * | Situation | What the agent sees |
 * |---|---|
 * | committed, response lost | the retry with the same key returns the same success, `replayed = true` |
 * | same key, different content | `409 idempotency-conflict` |
 * | outcome indeterminate | `409 reconcile-required` |
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

test("a retry with the same key returns the same success, and does not commit twice", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    const first = await d.get("commit", { files: "intro.md", idem: "retry-key-0001" });
    assert.equal(first.response.status, 200);
    const sha = (first.body.result as { commit: string }).commit;
    assert.equal((first.body.result as { replayed: boolean }).replayed, false);

    const second = await d.get("commit", { files: "intro.md", idem: "retry-key-0001" });
    assert.equal(second.response.status, 200);
    assert.equal((second.body.result as { commit: string }).commit, sha);
    assert.equal((second.body.result as { replayed: boolean }).replayed, true);

    // One commit on the branch, and one commit object in the repository.
    assert.equal(github.commitCount, 2, "the seed commit and the one the gateway made");
    assert.equal(github.branchCommit("build-engine")!.parents.length, 1);
  } finally {
    await github.stop();
  }
});

test("a plain retry with no key is idempotent too, because the key is derived", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    const first = await d.get("commit", { files: "intro.md" });
    const second = await d.get("commit", { files: "intro.md" });
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal((second.body.result as { replayed: boolean }).replayed, true);
    assert.equal(
      (first.body.result as { commit: string }).commit,
      (second.body.result as { commit: string }).commit,
    );
    assert.equal(github.commitCount, 2);
  } finally {
    await github.stop();
  }
});

test("the same key with different content is a conflict, and nothing is committed", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.stage("notes.md", "notes\n");

    const first = await d.get("commit", { files: "intro.md", idem: "conflict-key-01" });
    assert.equal(first.response.status, 200);
    const head = github.branchHead("build-engine");

    const second = await d.get("commit", { files: "notes.md", idem: "conflict-key-01" });
    assert.equal(second.response.status, 409);
    assert.equal((second.body.error as { code: string }).code, "idempotency-conflict");
    assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
  } finally {
    await github.stop();
  }
});

test("a seal is refused when there is no commit, and accepted after one", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    const refused = await d.get("seal");
    assert.equal(refused.response.status, 409);
    assert.equal((refused.body.error as { code: string }).code, "seal-requires-commit");

    await d.get("commit", { files: "intro.md" });
    const sealed = await d.get("seal");
    assert.equal(sealed.response.status, 200);
    assert.equal((sealed.body.result as { sealed: boolean }).sealed, true);
    assert.equal((sealed.body.state as string), "sealed");
  } finally {
    await github.stop();
  }
});

test("a repeated seal returns the recorded outcome and is not an error", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.get("commit", { files: "intro.md" });

    const first = await d.get("seal");
    const second = await d.get("seal");
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200, "a repeated seal must not be an error");
    assert.equal((second.body.result as { replayed: boolean }).replayed, true);
    assert.equal(
      (first.body.result as { at: number }).at,
      (second.body.result as { at: number }).at,
      "the recorded outcome must be the same one",
    );
    assert.equal((second.body.state as string), "sealed");
  } finally {
    await github.stop();
  }
});

test("after a seal the task is closed, and every write is refused", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.get("commit", { files: "intro.md" });
    await d.get("seal");

    const write = await d.get("create", { path: "later.md" });
    assert.equal(write.response.status, 410);
    assert.equal((write.body.error as { code: string }).code, "task-sealed");

    // The index still answers, so that the agent can learn why it stopped.
    const index = await d.get("index");
    assert.equal(index.response.status, 200);
    assert.equal((index.body.state as string), "sealed");
  } finally {
    await github.stop();
  }
});

test("two commits at once produce one commit, and the loser is told the branch moved", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    const [a, b] = await Promise.all([
      d.get("commit", { files: "intro.md", idem: "race-key-00001" }),
      d.get("commit", { files: "intro.md", idem: "race-key-00002" }),
    ]);

    const statuses = [a.response.status, b.response.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = a.response.status === 409 ? a : b;
    assert.equal((loser.body.error as { code: string }).code, "expected-sha-conflict");
    assert.equal(github.commitCount, 2, "the seed commit and one delivery");
  } finally {
    await github.stop();
  }
});
