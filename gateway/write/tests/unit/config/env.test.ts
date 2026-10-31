/**
 * The fail-closed environment validation (protocol section 12.2, plan task 5.2.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, ConfigError, type Env } from "../../../src/config/env.ts";
import { TEST_SECRET, TEST_KID } from "../../helpers/mock-worker.ts";

/** A valid environment. */
function env(overrides: Partial<Env> = {}): Env {
  return {
    SIGNING_KEYS: JSON.stringify({ [TEST_KID]: TEST_SECRET }),
    SUBMISSIONS_REPO: "owner/repo",
    SUBMISSIONS_BRANCH: "build-engine",
    SUBMISSIONS_FOLDER_TEMPLATE: "plans/{plan}/submissions/{order}/{task}",
    GITHUB_TOKEN: "github-token",
    OPERATOR_TOKEN: "operator-token",
    TASK_SESSION: {} as unknown as DurableObjectNamespace,
    ...overrides,
  } as Env;
}

/** The message of the configuration error a bad environment produces. */
function failureFor(bad: Partial<Env>): string {
  try {
    loadConfig(env(bad));
  } catch (e) {
    assert.ok(e instanceof ConfigError, `expected a ConfigError, got ${String(e)}`);
    return e.message;
  }
  throw new Error("expected the configuration to be refused");
}

test("a valid environment loads", () => {
  const config = loadConfig(env());
  assert.equal(config.submissionsRepo, "owner/repo");
  assert.equal(config.submissionsBranch, "build-engine");
  assert.equal(config.folderTemplate, "plans/{plan}/submissions/{order}/{task}");
  assert.equal(config.keys.get(TEST_KID), TEST_SECRET);
  assert.equal(config.maxTtlSeconds, 604800);
  assert.equal(config.leaseSeconds, 300);
});

test("a missing setting is refused, and the message names it", () => {
  assert.match(failureFor({ SIGNING_KEYS: "" }), /SIGNING_KEYS/);
  assert.match(failureFor({ SUBMISSIONS_REPO: "" }), /SUBMISSIONS_REPO/);
  assert.match(failureFor({ SUBMISSIONS_BRANCH: "" }), /SUBMISSIONS_BRANCH/);
  assert.match(failureFor({ SUBMISSIONS_FOLDER_TEMPLATE: "" }), /SUBMISSIONS_FOLDER_TEMPLATE/);
  assert.match(failureFor({ GITHUB_TOKEN: "" }), /GITHUB_TOKEN/);
  assert.match(failureFor({ OPERATOR_TOKEN: "" }), /OPERATOR_TOKEN/);
});

test("the message never contains the value of a setting", () => {
  const message = failureFor({ SUBMISSIONS_REPO: "" });
  assert.equal(message.includes(TEST_SECRET), false);
  assert.equal(message.includes("github-token"), false);
});

test("the signing keys must be a JSON object of non-empty secrets", () => {
  assert.match(failureFor({ SIGNING_KEYS: "not json" }), /SIGNING_KEYS/);
  assert.match(failureFor({ SIGNING_KEYS: "[]" }), /SIGNING_KEYS/);
  assert.match(failureFor({ SIGNING_KEYS: "{}" }), /SIGNING_KEYS/);
  assert.match(failureFor({ SIGNING_KEYS: '{"k1":""}' }), /SIGNING_KEYS/);
});

test("the repository must be owner/name and the branch must be a branch name", () => {
  assert.match(failureFor({ SUBMISSIONS_REPO: "not-a-slug" }), /SUBMISSIONS_REPO/);
  assert.match(failureFor({ SUBMISSIONS_BRANCH: "../escape" }), /SUBMISSIONS_BRANCH/);
});

test("the folder template must use each placeholder exactly once and no others", () => {
  assert.match(failureFor({ SUBMISSIONS_FOLDER_TEMPLATE: "plans/{plan}" }), /missing the placeholder/);
  assert.match(failureFor({ SUBMISSIONS_FOLDER_TEMPLATE: "plans/{plan}/{order}/{task}/{other}" }), /unknown placeholder/);
  assert.match(failureFor({ SUBMISSIONS_FOLDER_TEMPLATE: "plans//{plan}/{order}/{task}" }), /empty path component/);
});

test("the optional numbers must be positive integers", () => {
  assert.match(failureFor({ MAX_TTL_SECONDS: "0" }), /MAX_TTL_SECONDS/);
  assert.match(failureFor({ MAX_TTL_SECONDS: "-1" }), /MAX_TTL_SECONDS/);
  assert.match(failureFor({ MAX_TTL_SECONDS: "1.5" }), /MAX_TTL_SECONDS/);
  assert.match(failureFor({ LEASE_SECONDS: "nope" }), /LEASE_SECONDS/);
  assert.equal(loadConfig(env({ MAX_TTL_SECONDS: "60" })).maxTtlSeconds, 60);
});
