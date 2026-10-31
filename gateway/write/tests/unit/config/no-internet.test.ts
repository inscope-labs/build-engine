/**
 * The test harness must not be able to reach the internet.
 *
 * The write gateway's provider client points at whatever `GITHUB_API_BASE` says, and a test that
 * forgets to point it at the mock would send a request to the real GitHub — with whatever
 * credential the test environment holds. That is a request the test suite has no business
 * making, and with a token-shaped string in it.
 *
 * The default is therefore a **dead loopback address**: a test that forgets the override fails
 * fast and locally, instead of reaching a third party. This test is the guard that keeps it
 * that way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryNamespace, testEnv } from "../../helpers/mock-worker.ts";
import { loadConfig, type Env } from "../../../src/config/env.ts";

test("the test environment's provider address is a loopback one", () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as unknown as Env;
  const base = String(env.GITHUB_API_BASE ?? "");

  assert.ok(base !== "", "the base URL must be set, or the client would use the real one");
  assert.ok(
    base.startsWith("http://127.0.0.1:") || base.startsWith("http://localhost:"),
    `the test provider address must be a loopback one, found ${base}`,
  );
  assert.ok(!base.includes("github.com"), "the test suite must never reach the real GitHub");
});

test("and the configuration validator would refuse it if it were not a loopback address", () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as unknown as Env;
  // The validator accepts a loopback address over plain HTTP, and nothing else.
  const config = loadConfig(env);
  assert.equal(config.githubApiBase, env.GITHUB_API_BASE);

  const remote = { ...env, GITHUB_API_BASE: "http://github.example.internal" };
  assert.throws(() => loadConfig(remote), /GITHUB_API_BASE/);
});
