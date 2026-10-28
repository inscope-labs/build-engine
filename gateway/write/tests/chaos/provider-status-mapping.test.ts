/**
 * Chaos: the provider answers with a status, and the gateway maps it.
 *
 * The mapping is written down in `src/commit/retry.ts` as a table, and the table is the
 * contract's promise about what an agent is told when the far side misbehaves. A table that is
 * only written down is not a promise, so this suite drives **every row of it** through the real
 * Worker, the real Durable Object and the real client, against the mock provider.
 *
 * The two call sites are different, and the difference matters:
 *
 *  - the **head read** (`GET …/git/ref/heads/…`) answers "where is the branch?". A 404 there
 *    means the configured branch does not exist, which is an **operator fault** — the gateway is
 *    pointed at a branch that is not there — and not the agent's problem;
 *  - the **branch move** (`PATCH …/git/refs/heads/…`) answers "make this the branch". A 404
 *    there means the provider refused the request, which is a **provider fault**, and the agent
 *    is told so.
 *
 * The same status therefore means different things at different call sites, and the test proves
 * that the difference is there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";

/** The read of the branch head. */
const REF = "/repos/owner/repo/git/ref/heads/build-engine";
/** The move of the branch. */
const REFS = "/repos/owner/repo/git/refs/heads/build-engine";

/** One row of the mapping. */
interface Row {
  /** The status the provider answers. */
  status: number;
  /** The code the agent is given. */
  code: string;
  /** The HTTP status the agent is given. */
  http: number;
  /** Whether the agent is told it may retry. */
  retryable: boolean;
}

/** What the provider says when the gateway reads the branch. */
const HEAD_ROWS: Row[] = [
  { status: 401, code: "provider-credential-invalid", http: 502, retryable: false },
  { status: 403, code: "provider-credential-invalid", http: 502, retryable: false },
  { status: 404, code: "gateway-misconfigured", http: 503, retryable: false },
  { status: 409, code: "expected-sha-conflict", http: 409, retryable: false },
  { status: 422, code: "expected-sha-conflict", http: 409, retryable: false },
  { status: 429, code: "provider-rate-limited", http: 429, retryable: true },
  { status: 500, code: "provider-unavailable", http: 503, retryable: true },
  { status: 502, code: "provider-unavailable", http: 503, retryable: true },
  { status: 503, code: "provider-unavailable", http: 503, retryable: true },
];

/** What the provider says when the gateway moves the branch. */
const MOVE_ROWS: Row[] = [
  { status: 401, code: "provider-credential-invalid", http: 502, retryable: false },
  { status: 403, code: "provider-credential-invalid", http: 502, retryable: false },
  { status: 404, code: "provider-rejected", http: 502, retryable: false },
  { status: 409, code: "expected-sha-conflict", http: 409, retryable: false },
  { status: 422, code: "expected-sha-conflict", http: 409, retryable: false },
  { status: 429, code: "provider-rate-limited", http: 429, retryable: true },
];

test("the provider's status becomes the gateway's code, at the head read", async () => {
  for (const row of HEAD_ROWS) {
    const github = await testRepo();
    try {
      const d = await commitDriver(github);
      await d.stage("intro.md", "hello\n");
      const head = github.branchHead("build-engine");

      github.fail("GET", REF, { status: row.status, persistent: true });
      const { response, body } = await d.get("commit", { files: "intro.md" });

      assert.equal(
        response.status,
        row.http,
        `a ${row.status} at the head read: ${JSON.stringify(body.error)}`,
      );
      assert.equal((body.error as { code: string }).code, row.code, `a ${row.status} at the head read`);
      assert.equal((body.error as { retryable: boolean }).retryable, row.retryable);
      assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
    } finally {
      await github.stop();
    }
  }
});

test("the provider's status becomes the gateway's code, at the branch move", async () => {
  for (const row of MOVE_ROWS) {
    const github = await testRepo();
    try {
      const d = await commitDriver(github);
      await d.stage("intro.md", "hello\n");
      const head = github.branchHead("build-engine");

      github.fail("PATCH", REFS, { status: row.status, persistent: true });
      const { response, body } = await d.get("commit", { files: "intro.md" });

      assert.equal(
        response.status,
        row.http,
        `a ${row.status} at the branch move: ${JSON.stringify(body.error)}`,
      );
      assert.equal((body.error as { code: string }).code, row.code, `a ${row.status} at the branch move`);
      assert.equal((body.error as { retryable: boolean }).retryable, row.retryable);
      assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
    } finally {
      await github.stop();
    }
  }
});

test("a 5xx at the branch move is an unknown outcome, and the gateway does not guess", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    // A 5xx at the branch move is **indeterminate**: the provider may have acted before it
    // failed. The gateway looks at the branch, sees that it did not move, tries once more, and
    // still cannot tell — so it asks for a human rather than issuing a second commit.
    github.fail("PATCH", REFS, { status: 500, persistent: true });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 409);
    assert.equal((body.error as { code: string }).code, "reconcile-required");
    assert.equal(github.branchHead("build-engine"), head, "the branch must not have moved");
  } finally {
    await github.stop();
  }
});

test("the provider's answer never reaches the agent", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");

    // The provider's body quotes the request, and the request quotes the agent's content. The
    // gateway must not pass either on.
    github.fail("GET", REF, { status: 403, persistent: true });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 502);
    const text = JSON.stringify(body);
    assert.ok(!text.includes("scripted failure"), "the provider's body is not in the answer");
    assert.ok(!text.toLowerCase().includes("github"), "the provider is not named in the answer");
    assert.equal((body.error as { code: string }).code, "provider-credential-invalid");
  } finally {
    await github.stop();
  }
});

test("a provider that recovers delivers exactly one commit", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const head = github.branchHead("build-engine");

    // The provider refuses once and then behaves. The gateway retries, and the branch moves
    // exactly once.
    github.fail("POST", "/repos/owner/repo/git/blobs", { status: 503 });
    const { response, body } = await d.get("commit", { files: "intro.md" });

    assert.equal(response.status, 200, JSON.stringify(body.error));
    const sha = (body.result as { commit: string }).commit;
    assert.equal(github.branchHead("build-engine"), sha);
    assert.equal(github.branchCommit("build-engine")!.parents[0], head);
    assert.equal(github.commitCount, 2, "the seed commit and one delivery");
  } finally {
    await github.stop();
  }
});
