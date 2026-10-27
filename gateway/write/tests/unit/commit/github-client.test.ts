/**
 * The provider client, on its own.
 *
 * The client is the boundary between the gateway and the outside world, and it has three jobs
 * that are easy to get wrong and expensive to get wrong: it must reach **one** place and no
 * other, it must give up on a provider that does not answer, and it must never let the
 * provider's own words reach the agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { GitHubClient, ProviderError } from "../../../src/commit/github-client.ts";
import { providerCode, isRetryableFailure } from "../../../src/commit/retry.ts";
import { MockGitHub } from "../../helpers/mock-github.ts";

/** A client pointed at the mock. */
function clientFor(github: MockGitHub, timeoutMs = 2000): GitHubClient {
  return new GitHubClient({
    repo: "owner/repo",
    branch: "build-engine",
    token: "test-github-token",
    apiBase: github.baseUrl,
    timeoutMs,
    userAgent: "build-engine-write-gateway",
  });
}

test("the client reaches the configured repository and branch, and nothing else", async () => {
  const github = new MockGitHub();
  await github.start();
  try {
    github.seedBranch("build-engine", { "README.md": "x" });
    const client = clientFor(github);

    const head = await client.getBranchHead();
    assert.equal(head, github.branchHead("build-engine"));

    const paths = github.requests.map((request) => request.path);
    assert.ok(paths.every((path) => path.startsWith("/repos/owner/repo/git/")), paths.join(", "));
  } finally {
    await github.stop();
  }
});

test("the credential is in the header, and never in the URL", async () => {
  const github = new MockGitHub();
  await github.start();
  try {
    github.seedBranch("build-engine", { "README.md": "x" });
    await clientFor(github).getBranchHead();

    const request = github.requests[0]!;
    assert.equal(request.headers.authorization, "Bearer test-github-token");
    assert.ok(!request.path.includes("test-github-token"));
  } finally {
    await github.stop();
  }
});

test("a branch name with a slash keeps its slashes", async () => {
  const github = new MockGitHub();
  await github.start();
  try {
    github.seedBranch("feature/one", { "README.md": "x" });
    const client = new GitHubClient({
      repo: "owner/repo",
      branch: "feature/one",
      token: "t",
      apiBase: github.baseUrl,
      timeoutMs: 2000,
      userAgent: "ua",
    });
    const head = await client.getBranchHead();
    assert.equal(head, github.branchHead("feature/one"));
    assert.equal(github.requests[0]!.path, "/repos/owner/repo/git/ref/heads/feature/one");
  } finally {
    await github.stop();
  }
});

test("a provider that does not answer is a timeout, not a wait", async () => {
  const github = new MockGitHub();
  await github.start();
  try {
    github.seedBranch("build-engine", { "README.md": "x" });
    github.fail("GET", "/repos/owner/repo/git/ref/heads/build-engine", {
      status: 200,
      hang: "before",
      delayMs: 3000,
    });

    const client = clientFor(github, 300);
    const started = Date.now();
    await assert.rejects(
      () => client.getBranchHead(),
      (e: unknown) => {
        assert.ok(e instanceof ProviderError);
        assert.equal(e.kind, "timeout");
        assert.equal(e.status, null);
        return true;
      },
    );
    assert.ok(Date.now() - started < 2500, "the call gave up on the client's timeout, not the server's");
  } finally {
    await github.stop();
  }
});

test("a provider status becomes a ProviderError, and the provider's body is never read", async () => {
  const github = new MockGitHub();
  await github.start();
  try {
    github.seedBranch("build-engine", { "README.md": "x" });
    github.fail("GET", "/repos/owner/repo/git/ref/heads/build-engine", { status: 403 });

    await assert.rejects(
      () => clientFor(github).getBranchHead(),
      (e: unknown) => {
        assert.ok(e instanceof ProviderError);
        assert.equal(e.kind, "status");
        assert.equal(e.status, 403);
        assert.ok(!e.message.includes("scripted failure"), "the provider's body must not be quoted");
        return true;
      },
    );
  } finally {
    await github.stop();
  }
});

test("the provider's failures map onto the gateway's codes", () => {
  const cases: [number, string][] = [
    [401, "provider-credential-invalid"],
    [403, "provider-credential-invalid"],
    [409, "expected-sha-conflict"],
    [422, "expected-sha-conflict"],
    [429, "provider-rate-limited"],
    [500, "provider-unavailable"],
    [502, "provider-unavailable"],
    [503, "provider-unavailable"],
    [400, "provider-rejected"],
    [404, "provider-rejected"],
  ];
  for (const [status, expected] of cases) {
    const error = new ProviderError("status", status, "the provider answered");
    assert.equal(providerCode(error), expected, String(status));
  }
  assert.equal(providerCode(new ProviderError("timeout", null, "timed out")), "provider-unavailable");
  assert.equal(providerCode(new ProviderError("network", null, "failed")), "provider-unavailable");
});

test("only a rate limit and an unavailable service are retryable", () => {
  assert.equal(isRetryableFailure(new ProviderError("status", 429, "slow down")), true);
  assert.equal(isRetryableFailure(new ProviderError("status", 503, "down")), true);
  assert.equal(isRetryableFailure(new ProviderError("timeout", null, "slow")), true);
  assert.equal(isRetryableFailure(new ProviderError("status", 403, "no")), false);
  assert.equal(isRetryableFailure(new ProviderError("status", 422, "no")), false);
  assert.equal(isRetryableFailure(new Error("something else")), false);
});
