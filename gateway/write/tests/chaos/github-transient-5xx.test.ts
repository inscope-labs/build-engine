/**
 * Chaos: the provider misbehaves while the gateway is mid-commit.
 *
 * The cases here are the ones that turn a delivery into a duplicate commit, and they are the
 * reason the commit is made in two steps. Every one of them has to end with **one** commit on
 * the branch, or with none, and never with two.
 *
 * The suite is slow on purpose. A commit that takes a second is a commit that an agent waits
 * for; a commit that takes ten is a commit an agent gives up on and retries into a duplicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

const BLOBS = "/repos/owner/repo/git/blobs";
const TREES = "/repos/owner/repo/git/trees";
const COMMITS = "/repos/owner/repo/git/commits";
const REFS = "/repos/owner/repo/git/refs/heads/build-engine";

test("a provider that fails intermittently still delivers exactly one commit", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.stage("notes.md", "notes\n");

    // Every third provider call fails, in a different place each time.
    let calls = 0;
    for (const path of [BLOBS, TREES, COMMITS, REFS]) {
      github.fail("POST", path, { status: 500 });
      github.fail("POST", path, { status: 502 });
      calls += 1;
    }

    const { response, body } = await d.get("commit", { files: "intro.md,notes.md" });
    assert.equal(response.status, 200, JSON.stringify(body.error));
    assert.equal(github.commitCount, 2, "the seed commit and one delivery");
    assert.equal(github.branchCommit("build-engine")!.parents.length, 1);
  } finally {
    await github.stop();
  }
});

test("a provider that fails on every attempt delivers nothing and says so", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    for (const path of [BLOBS, TREES, COMMITS, REFS]) {
      github.fail("POST", path, { status: 500, persistent: true });
    }

    const { response, body } = await d.get("commit", { files: "intro.md" });
    assert.equal(response.status, 503);
    assert.equal((body.error as { code: string }).code, "provider-unavailable");
    assert.equal(github.branchHead("build-engine"), head, "nothing was delivered");
    assert.equal(github.commitCount, 1, "the seed commit and nothing else");
  } finally {
    await github.stop();
  }
});

test("a provider that answers after the gateway gave up does not produce a second commit", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // The provider applies the change and then stops talking. The gateway's timeout is 2000ms.
    github.fail("PATCH", REFS, { status: 200, hang: "after", delayMs: 2500 });
    const { response } = await d.get("commit", { files: "intro.md" });
    assert.equal(response.status, 200);

    // And the agent retries anyway, because it never saw the answer.
    const retry = await d.get("commit", { files: "intro.md" });
    assert.equal(retry.response.status, 200);
    assert.equal((retry.body.result as { replayed: boolean }).replayed, true);
    assert.equal(github.commitCount, 2, "the seed commit and one delivery — not two");
  } finally {
    await github.stop();
  }
});

test("a commit whose outcome is unknown is never guessed at", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // The provider is slow, and while it is slow the branch moves underneath the gateway.
    github.fail("PATCH", REFS, { status: 503, delayMs: 2500 });
    const slow = d.get("commit", { files: "intro.md" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const other = github.seedBranch("build-engine", { "README.md": "# somebody else\n" }, "somebody else");

    const { response, body } = await slow;
    assert.equal(response.status, 409);
    assert.equal((body.error as { code: string }).code, "reconcile-required");
    assert.equal(github.branchHead("build-engine"), other, "the gateway did not move the branch");
    // The gateway did create a commit *object* before the branch was touched. It is unreferenced
    // — garbage that the provider collects — and it is not a commit on the branch. The count is
    // the seed, the gateway's orphan, and somebody else's.
    assert.equal(github.commitCount, 3);
  } finally {
    await github.stop();
  }
});
