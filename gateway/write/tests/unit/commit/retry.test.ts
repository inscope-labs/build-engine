/**
 * The retry policy (plan task 5.5.2: the error mapping).
 *
 * The policy answers two questions, and they are kept in one module because they are one
 * decision:
 *
 *  - **which** provider failures can be retried unchanged;
 *  - **what** the agent is told when one cannot be.
 *
 * The table the module documents is the contract's promise about what an agent is told, and this
 * test walks every row of it. The rows are exercised here at the level of the decision functions
 * — the same functions the commit path calls — so that a change in the mapping fails here rather
 * than in a delivery.
 *
 * The one that matters most is the last: a 4xx is **definite**. The provider refused, and
 * refused means refused, so repeating the request unchanged will fail the same way. A 5xx, a
 * timeout and a network failure are **indeterminate**: the provider may have acted before it
 * failed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isRetryableFailure,
  providerCode,
  providerMessage,
  withRetry,
  type RetryPolicy,
} from "../../../src/commit/retry.ts";
import { ProviderError } from "../../../src/commit/github-client.ts";
import { errorSpec, isKnownCode } from "../../../src/http/status-codes.ts";

/** The policy the gateway uses. */
const POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4000 };

test("a 4xx is definite and is not retried", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const error = new ProviderError("status", status, `the provider answered ${status}`);
    assert.equal(isRetryableFailure(error), false, `a ${status} is not retried`);
  }
});

test("a 429 and a 5xx can be retried", () => {
  assert.equal(isRetryableFailure(new ProviderError("status", 429, "x")), true);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isRetryableFailure(new ProviderError("status", status, "x")), true, `a ${status} is retried`);
  }
});

test("a timeout and a network failure can be retried", () => {
  assert.equal(isRetryableFailure(new ProviderError("timeout", null, "x")), true);
  assert.equal(isRetryableFailure(new ProviderError("network", null, "x")), true);
});

test("something that is not a provider failure is not retried", () => {
  assert.equal(isRetryableFailure(new Error("boom")), false);
  assert.equal(isRetryableFailure("boom"), false);
  assert.equal(isRetryableFailure(null), false);
});

test("each provider status becomes the gateway's code", () => {
  const table: [number, string][] = [
    [401, "provider-credential-invalid"],
    [403, "provider-credential-invalid"],
    [404, "provider-rejected"],
    [409, "expected-sha-conflict"],
    [422, "expected-sha-conflict"],
    [429, "provider-rate-limited"],
    [500, "provider-unavailable"],
    [502, "provider-unavailable"],
    [503, "provider-unavailable"],
  ];
  for (const [status, code] of table) {
    const error = new ProviderError("status", status, "x");
    assert.equal(providerCode(error), code, `a ${status} becomes ${code}`);
  }
  assert.equal(providerCode(new ProviderError("timeout", null, "x")), "provider-unavailable");
  assert.equal(providerCode(new ProviderError("network", null, "x")), "provider-unavailable");
  assert.equal(providerCode(new Error("boom")), "provider-unavailable");
});

test("a call site may override the code, because a status means different things to different calls", () => {
  // A 404 on the branch read means the configured branch is not there, which is the operator's
  // fault; a 404 on the branch move means the provider refused the request.
  const error = new ProviderError("status", 404, "x");
  assert.equal(providerCode(error, "gateway-misconfigured"), "gateway-misconfigured");
  assert.equal(providerCode(error, "task-folder-missing"), "task-folder-missing");
});

test("every code the provider can produce is in the catalogue", () => {
  for (const status of [401, 403, 404, 409, 422, 429, 500, 502, 503]) {
    const code = providerCode(new ProviderError("status", status, "x"));
    assert.ok(isKnownCode(code), `${code} is in the catalogue`);
    assert.equal(providerMessage(code).length > 0, true, `${code} has a message`);
  }
});

test("a message never quotes the provider", () => {
  for (const code of [
    "provider-rate-limited",
    "provider-unavailable",
    "provider-credential-invalid",
    "provider-rejected",
    "expected-sha-conflict",
    "task-folder-missing",
    "gateway-misconfigured",
  ]) {
    const message = providerMessage(code);
    assert.ok(!/https?:|gh[pousr]_|\/repos\//.test(message), `${code}: ${message}`);
  }
});

test("a retryable failure is retried, and the operation then succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError("status", 503, "x");
      return "delivered";
    },
    POLICY,
    async () => undefined,
  );
  assert.equal(result, "delivered");
  assert.equal(attempts, 3);
});

test("a definite failure is not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new ProviderError("status", 403, "x");
      },
      POLICY,
      async () => undefined,
    ),
  );
  assert.equal(attempts, 1, "the request was not repeated");
});

test("the attempts are bounded, and the failure is the last one", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new ProviderError("status", 500, "x");
      },
      POLICY,
      async () => undefined,
    ),
  );
  assert.equal(attempts, POLICY.maxAttempts, "the attempts are bounded");
});

test("the delay grows between the attempts, and is capped", async () => {
  const delays: number[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        throw new ProviderError("status", 500, "x");
      },
      { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 250 },
      async (ms) => {
        delays.push(ms);
      },
    ),
  );
  assert.deepEqual(delays, [100, 200, 250, 250], "the delay doubles and is capped");
});

test("a policy with no attempts still runs the operation once", async () => {
  // A policy of zero would mean the gateway never tries, and a commit that never tries is a
  // commit that never lands.
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new ProviderError("status", 500, "x");
      },
      { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 1 },
      async () => undefined,
    ),
  );
  assert.equal(attempts, 1);
});

test("the codes the provider produces are the ones the contract's catalogue defines", () => {
  // The catalogue and the mapping must agree, or an agent is told a code the gateway does not
  // define — and an undefined code is a 500.
  for (const status of [401, 403, 404, 409, 422, 429, 500, 502, 503]) {
    const code = providerCode(new ProviderError("status", status, "x"));
    assert.ok(isKnownCode(code), `${code} is defined`);
    assert.notEqual(errorSpec(code).status, 500, `${code} is not an unknown code`);
  }
});
