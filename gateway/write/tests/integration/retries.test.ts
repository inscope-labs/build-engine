/**
 * The provider's failures, and what the agent is told about them (plan task 5.3.4).
 *
 * The cases here are the ones the contract names: rate limits, 5xx, a timeout after the provider
 * acted, a partial failure, an expected-SHA conflict, and concurrent commits. Each of them has
 * to end with **one** commit on the branch, or with none, and never with two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

/** The paths the client uses. */
const REF = "/repos/owner/repo/git/ref/heads/build-engine";
const REFS = "/repos/owner/repo/git/refs/heads/build-engine";
const BLOBS = "/repos/owner/repo/git/blobs";
const TREES = "/repos/owner/repo/git/trees";

test("a transient 5xx is retried, and the commit succeeds", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    github.fail("POST", BLOBS, { status: 500 });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 200);
    assert.ok((body.result as { commit: string }).commit);
    assert.equal(github.requestsTo("POST", BLOBS).length, 2, "the blob call was retried once");
    assert.equal(github.commitCount, 2);
  } finally {
    await github.stop();
  }
});

test("a 5xx that never stops ends in provider-unavailable, and nothing is committed", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    github.fail("POST", BLOBS, { status: 503, persistent: true });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 503);
    assert.equal((body.error as { code: string }).code, "provider-unavailable");
    assert.equal((body.error as { retryable: boolean }).retryable, true);
    assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
  } finally {
    await github.stop();
  }
});

test("a rate limit is retried, and the commit succeeds", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    github.fail("POST", BLOBS, { status: 429 });
    const { response } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 200);
    assert.equal(github.requestsTo("POST", BLOBS).length, 2);
  } finally {
    await github.stop();
  }
});

test("a rate limit that never stops ends in provider-rate-limited", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    github.fail("POST", BLOBS, { status: 429, persistent: true });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 429);
    assert.equal((body.error as { code: string }).code, "provider-rate-limited");
  } finally {
    await github.stop();
  }
});

test("a refused credential is an operator fault, and is not retryable", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    github.fail("GET", REF, { status: 401 });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 502);
    assert.equal((body.error as { code: string }).code, "provider-credential-invalid");
    assert.equal((body.error as { retryable: boolean }).retryable, false);
  } finally {
    await github.stop();
  }
});

test("a provider failure while the gateway is looking for the task folder is not a missing folder", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    // The tree walk fails. That is the provider's problem, not the operator's: answering
    // `404 task-folder-missing` here would send the agent to the operator for something a retry
    // fixes.
    github.fail("GET", "/repos/owner/repo/git/trees/*", { status: 500, persistent: true });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 503);
    assert.equal((body.error as { code: string }).code, "provider-unavailable");
    assert.equal(github.branchHead("build-engine"), head);
  } finally {
    await github.stop();
  }
});

test("a branch that moved is an expected-sha-conflict, and nothing is committed", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // Somebody else moved the branch after the capability was minted.
    const other = github.seedBranch("build-engine", { "README.md": "# someone else\n" }, "somebody else");
    assert.notEqual(other, d.capability.head);

    const { response, body } = await d.get("commit", { files: "intro.md" });
    assert.equal(response.status, 409);
    assert.equal((body.error as { code: string }).code, "expected-sha-conflict");
    assert.equal(github.branchHead("build-engine"), other);
  } finally {
    await github.stop();
  }
});

test("a partial failure leaves nothing on the branch, and the next attempt delivers once", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    // The tree cannot be created, so the commit object is never made and the branch never moves.
    github.fail("POST", TREES, { status: 500, persistent: true });
    const failed = await d.get("commit", { files: "intro.md" });
    assert.equal(failed.response.status, 503);
    assert.equal(github.branchHead("build-engine"), head);

    // The provider recovers. The retry delivers, and the branch has exactly one new commit.
    // The failed attempt left a blob behind, which is an unreferenced object: garbage, not a
    // commit, and the branch never saw it.
    github.clearFailures();
    const retried = await d.get("commit", { files: "intro.md" });
    assert.equal(retried.response.status, 200);
    assert.equal(github.commitCount, 2, "the seed commit and one delivery");
    assert.equal(github.branchCommit("build-engine")!.parents[0], head);
  } finally {
    await github.stop();
  }
});

test("a timeout after the provider acted is resolved by looking, not by committing again", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // The provider applies the change and then stops talking. The client's timeout is 2000ms, so
    // the answer arrives after the gateway has already given up on it.
    github.fail("PATCH", REFS, { status: 200, hang: "after", delayMs: 2500 });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 200, "the gateway goes and looks at the branch");
    const sha = (body.result as { commit: string }).commit;
    assert.equal(github.branchHead("build-engine"), sha, "the branch is at the commit the gateway made");
    assert.equal(github.commitCount, 2, "the seed commit and one delivery — not two");
  } finally {
    await github.stop();
  }
});

test("a timeout before the provider acted is retried, and still delivers once", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    // The provider is too slow to do anything, and the answer never arrives in time.
    github.fail("PATCH", REFS, { status: 503, delayMs: 2500 });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 200);
    const sha = (body.result as { commit: string }).commit;
    assert.equal(github.branchHead("build-engine"), sha);
    assert.equal(github.branchCommit("build-engine")!.parents[0], head);
    assert.equal(github.commitCount, 2);
  } finally {
    await github.stop();
  }
});

test("a commit that cannot be told apart from a failure asks for a human", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // The provider is slow, and while it is slow somebody else moves the branch. The gateway
    // cannot tell whether its own commit landed, and it must not guess.
    github.fail("PATCH", REFS, { status: 503, delayMs: 2500 });
    const slow = d.get("commit", { files: "intro.md" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const other = github.seedBranch("build-engine", { "README.md": "# somebody else\n" }, "somebody else");
    assert.notEqual(other, d.capability.head);

    const { response, body } = await slow;
    assert.equal(response.status, 409);
    assert.equal((body.error as { code: string }).code, "reconcile-required");
    assert.equal(github.branchHead("build-engine"), other, "the gateway did not commit anything");
  } finally {
    await github.stop();
  }
});
