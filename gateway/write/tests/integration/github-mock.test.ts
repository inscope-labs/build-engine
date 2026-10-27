/**
 * The commit, end to end, against a mock provider over real HTTP.
 *
 * The Worker's `fetch`, the router, the Durable Object, the staging operations, the commit and
 * the provider client are all the shipped ones. Only the provider is a mock, and it is a mock
 * that speaks HTTP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo, TEST_FOLDER } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

test("a commit writes the selected files into the task folder and nothing else", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.stage("notes.md", "notes\n");

    const { response, body } = await d.get("commit", { files: "intro.md,notes.md" });

    assert.equal(response.status, 200);
    assert.equal(body.error, null);
    const result = body.result as { commit: string; files: string[]; count: number; replayed: boolean };
    assert.match(result.commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(result.files, ["intro.md", "notes.md"]);
    assert.equal(result.count, 2);
    assert.equal(result.replayed, false);

    // The branch moved, and it moved by exactly one commit.
    const head = github.branchHead("build-engine")!;
    assert.notEqual(head, d.capability.head);
    const commit = github.branchCommit("build-engine")!;
    assert.equal(commit.parents.length, 1);
    assert.equal(commit.parents[0], d.capability.head);

    // The files are in the task folder, and the rest of the repository is untouched.
    const files = github.branchFiles("build-engine");
    assert.ok(files.includes(`${TEST_FOLDER}/intro.md`));
    assert.ok(files.includes(`${TEST_FOLDER}/notes.md`));
    assert.ok(files.includes(`${TEST_FOLDER}/.keep`), "the placeholder must survive the commit");
    assert.ok(files.includes("README.md"), "the rest of the repository must survive the commit");
    assert.equal(github.fileContent("build-engine", `${TEST_FOLDER}/intro.md`), "hello\n");
    assert.equal(github.fileContent("build-engine", `${TEST_FOLDER}/notes.md`), "notes\n");
  } finally {
    await github.stop();
  }
});

test("the commit message is the contract's, and the request cannot influence it", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.get("commit", { files: "intro.md" });

    const commit = github.branchCommit("build-engine")!;
    assert.equal(
      commit.message,
      `ctxwrite-v1: ${d.capability.task} (${d.capability.order})\n\nintro.md\n`,
    );
  } finally {
    await github.stop();
  }
});

test("the commit goes to the configured branch and no other", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.get("commit", { files: "intro.md" });

    // The only branch the mock knows is the configured one, and the client has no way to name
    // another: the writes are all under /repos/owner/repo/git/...
    for (const request of github.requests) {
      assert.ok(
        request.path.startsWith("/repos/owner/repo/git/"),
        `the client wrote outside the configured repository: ${request.path}`,
      );
    }
    const refs = github.requestsTo("PATCH", "/repos/owner/repo/git/refs/heads/build-engine");
    assert.equal(refs.length, 1);
  } finally {
    await github.stop();
  }
});

test("the client sends the credential, and never in the query", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    await d.get("commit", { files: "intro.md" });

    assert.ok(github.requests.length > 0);
    for (const request of github.requests) {
      assert.equal(request.headers.authorization, "Bearer test-github-token");
      assert.ok(!request.path.includes("test-github-token"));
      assert.equal(request.headers.accept, "application/vnd.github+json");
    }
  } finally {
    await github.stop();
  }
});

test("the commit records the sha, the selection and the binding in the session", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const { body } = await d.get("commit", { files: "intro.md" });
    const sha = (body.result as { commit: string }).commit;

    const { body: status } = await d.get("status");
    const committed = (status.result as { committed: { sha: string; paths: string[]; actor: string; task: string } }).committed;
    assert.equal(committed.sha, sha);
    assert.deepEqual(committed.paths, ["intro.md"]);
    assert.equal(committed.actor, d.capability.writer);
    assert.equal(committed.task, d.capability.task);
  } finally {
    await github.stop();
  }
});

test("a selection with a file that was never staged is refused, and nothing is committed", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    const { response, body } = await d.get("commit", { files: "intro.md,nowhere.md" });
    assert.equal(response.status, 409);
    assert.equal((body.error as { code: string }).code, "file-not-staged");
    assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
  } finally {
    await github.stop();
  }
});

test("a task folder that does not exist is refused, and the branch is not touched", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    // A task the operator never created a folder for.
    const { capability } = await import("../helpers/sign-root.ts").then(async (m) =>
      m.signedCapability({ task: "10008-1-001-99", head: github.branchHead("build-engine")! }),
    );
    // The file is staged in that task's own session, so that the folder is the only thing wrong.
    await d.stageWith(capability, "intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    const { response, body } = await d.getWith(capability, "commit", { files: "intro.md" });
    assert.equal(response.status, 404);
    assert.equal((body.error as { code: string }).code, "task-folder-missing");
    assert.equal(github.branchHead("build-engine"), head);
  } finally {
    await github.stop();
  }
});

test("a selection that tries to choose the destination is refused", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const { response, body } = await d.get("commit", { files: "intro.md", branch: "main" });
    assert.equal(response.status, 400);
    assert.equal((body.error as { code: string }).code, "destination-not-selectable");
  } finally {
    await github.stop();
  }
});
