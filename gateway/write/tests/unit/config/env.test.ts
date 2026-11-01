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
    DEPLOY_ENV: "production",
    SIGNING_KEY_IDS: TEST_KID,
    TASK_SESSION: {} as unknown as DurableObjectNamespace,
    AUDIT_STREAM: {} as unknown as DurableObjectNamespace,
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

test("the provider's base URL must be https, unless it is a loopback address", () => {
  // The credential is in every request. An unencrypted hop to a remote host would hand it over,
  // and the only plain-HTTP exception is a loopback address, which is what lets the test suite
  // run the real client against a real local server.
  const config = loadConfig(env({ GITHUB_API_BASE: "https://github.example.internal/api/v3" }));
  assert.equal(config.githubApiBase, "https://github.example.internal/api/v3");

  const loopback = loadConfig(env({ GITHUB_API_BASE: "http://127.0.0.1:8080" }));
  assert.equal(loopback.githubApiBase, "http://127.0.0.1:8080");

  assert.match(failureFor({ GITHUB_API_BASE: "http://github.example.internal" }), /GITHUB_API_BASE/);
  assert.match(failureFor({ GITHUB_API_BASE: "ftp://github.example.internal" }), /GITHUB_API_BASE/);
  assert.match(failureFor({ GITHUB_API_BASE: "not a url" }), /GITHUB_API_BASE/);
});

test("the provider's timeout is bounded", () => {
  assert.equal(loadConfig(env()).githubTimeoutMs, 10000);
  assert.equal(loadConfig(env({ GITHUB_TIMEOUT_MS: "2500" })).githubTimeoutMs, 2500);
  assert.match(failureFor({ GITHUB_TIMEOUT_MS: "0" }), /GITHUB_TIMEOUT_MS/);
  assert.match(failureFor({ GITHUB_TIMEOUT_MS: "999999" }), /GITHUB_TIMEOUT_MS/);
});

test("the commit's author identity is configuration, and it is validated", () => {
  const config = loadConfig(env({ GITHUB_COMMIT_AUTHOR: "A Bot <bot@example.invalid>" }));
  assert.equal(config.commitAuthorName, "A Bot");
  assert.equal(config.commitAuthorEmail, "bot@example.invalid");

  const fallback = loadConfig(env());
  assert.match(fallback.commitAuthorName, /write gateway/);
  assert.match(fallback.commitAuthorEmail, /@/);

  assert.match(failureFor({ GITHUB_COMMIT_AUTHOR: "no angle brackets" }), /GITHUB_COMMIT_AUTHOR/);
});

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

// ---------------------------------------------------------------------------
// The environment name and the key ids (Stage 6.1, plan tasks 6.1.2 and 6.1.3)
// ---------------------------------------------------------------------------

test("the deployment has to say which environment it is", () => {
  assert.equal(loadConfig(env({ DEPLOY_ENV: "staging", PRODUCTION_SUBMISSIONS_REPO: "owner/production" })).deployEnv, "staging");
  assert.equal(loadConfig(env()).deployEnv, "production");

  // A gateway that does not say which environment it is cannot be told apart from the other
  // one, and a pilot that cannot tell them apart is not a pilot.
  assert.match(failureFor({ DEPLOY_ENV: "" }), /DEPLOY_ENV/);
  assert.match(failureFor({ DEPLOY_ENV: "preprod" }), /DEPLOY_ENV/);
});

test("the declared key ids must cover the ones the secret has", () => {
  assert.deepEqual(loadConfig(env({ SIGNING_KEY_IDS: TEST_KID })).signingKeyIds, [TEST_KID]);
  // A declaration that names more key ids than the secret holds is a rotation in progress: the
  // declaration is deployed first and the new secret follows.
  assert.deepEqual(loadConfig(env({ SIGNING_KEY_IDS: `${TEST_KID},k2` })).signingKeyIds, [TEST_KID, "k2"]);

  // A key id the declaration does not name belongs to another environment, and a deployment that
  // serves it can answer that environment's capabilities.
  assert.match(failureFor({ SIGNING_KEY_IDS: "other" }), /SIGNING_KEY_IDS/);
  assert.match(failureFor({ SIGNING_KEY_IDS: "" }), /SIGNING_KEY_IDS/);
  assert.match(failureFor({ SIGNING_KEY_IDS: "not a kid" }), /SIGNING_KEY_IDS/);
  assert.match(failureFor({ SIGNING_KEY_IDS: `${TEST_KID},${TEST_KID}` }), /SIGNING_KEY_IDS/);
});

test("a staging deployment may not be pointed at the production repository", () => {
  // The rule that makes "staging data can never be mistaken for a production submission" a
  // property of the configuration rather than a matter of care.
  const message = failureFor({
    DEPLOY_ENV: "staging",
    PRODUCTION_SUBMISSIONS_REPO: "owner/repo",
    SUBMISSIONS_REPO: "owner/repo",
  });
  assert.match(message, /SUBMISSIONS_REPO/);
  assert.match(message, /production/);
});

test("a staging deployment without its guard does not start", () => {
  // Without the declaration there is nothing to refuse, and a staging deployment that has been
  // pointed at production by mistake would otherwise serve perfectly well.
  assert.match(failureFor({ DEPLOY_ENV: "staging" }), /PRODUCTION_SUBMISSIONS_REPO/);
  assert.match(
    failureFor({ DEPLOY_ENV: "staging", PRODUCTION_SUBMISSIONS_REPO: "", SUBMISSIONS_REPO: "owner/other" }),
    /PRODUCTION_SUBMISSIONS_REPO/,
  );
});

test("the production deployment does not declare the staging guard", () => {
  // One setting, one meaning. A production deployment that named its own repository in the
  // staging guard would be saying nothing.
  assert.match(failureFor({ PRODUCTION_SUBMISSIONS_REPO: "owner/repo" }), /PRODUCTION_SUBMISSIONS_REPO/);
});
