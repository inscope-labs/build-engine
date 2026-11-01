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

// ---------------------------------------------------------------------------
// The receiver of `fetch` (F0-072)
// ---------------------------------------------------------------------------

test("the provider's fetch is called with the global scope as its receiver", async () => {
  // The Workers runtime refuses to run `fetch` when it is called with the wrong receiver:
  //
  //     TypeError: Illegal invocation: function called with incorrect `this` reference.
  //
  // A client that stored `globalThis.fetch` on itself and called `this.fetchImpl(...)` would
  // make that call a method call on the client, and every provider request would fail with a
  // TypeError that the client turns into "the provider call failed". The gateway would never
  // have spoken to GitHub, and the failure would have looked like a provider outage.
  //
  // The mock provider cannot catch this: a mock does not care who calls it. So the rule of the
  // runtime is reproduced here instead: this fetch throws if it is called with a receiver that
  // is neither the global scope nor undefined.
  const original = globalThis.fetch;
  const seen: unknown[] = [];
  globalThis.fetch = function strictFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    seen.push(this);
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    }
    return original(input as RequestInfo, init);
  } as typeof fetch;

  try {
    const github = new MockGitHub();
    await github.start();
    try {
      github.seedBranch("build-engine", { "README.md": "x" });
      // No fetchImpl: this is the path a deployed gateway takes.
      const client = new GitHubClient({
        repo: "owner/repo",
        branch: "build-engine",
        token: "test-github-token",
        apiBase: github.baseUrl,
        timeoutMs: 2000,
        userAgent: "build-engine-write-gateway",
      });
      const head = await client.getBranchHead();
      assert.equal(head, github.branchHead("build-engine"));
      assert.ok(seen.length > 0, "the provider was called");
      for (const receiver of seen) {
        assert.ok(
          receiver === globalThis || receiver === undefined,
          "fetch is called with the global scope as its receiver",
        );
      }
    } finally {
      await github.stop();
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("a provider failure caused by a bad receiver is not mistaken for an outage", async () => {
  // The mapping matters as much as the bug: a TypeError became `provider-unavailable`, which is
  // a RETRYABLE code, so the agent would have retried a call that could never succeed.
  const original = globalThis.fetch;
  globalThis.fetch = function strictFetch(this: unknown): Promise<Response> {
    throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
  } as typeof fetch;

  try {
    const client = new GitHubClient({
      repo: "owner/repo",
      branch: "build-engine",
      token: "test-github-token",
      apiBase: "http://127.0.0.1:1",
      timeoutMs: 200,
      userAgent: "build-engine-write-gateway",
    });
    await assert.rejects(() => client.getBranchHead(), (e: unknown) => e instanceof ProviderError);
    const error = await client.getBranchHead().then(
      () => null,
      (e: unknown) => e as ProviderError,
    );
    assert.ok(error !== null, "the call failed");
    assert.equal(error.kind, "network");
    // The kind is "network", so the failure is retryable - and a TypeError is not something a
    // retry can fix. The client cannot tell the two apart, which is why the receiver is bound
    // rather than left to chance.
    assert.equal(isRetryableFailure(error), true);
  } finally {
    globalThis.fetch = original;
  }
});
