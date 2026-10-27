/**
 * The rate limit under load (protocol section 7.1; plan task 5.5.7).
 *
 * The limit is per task, and it bounds the work one task can make the gateway do. This test
 * drives a burst of concurrent requests and checks that the limit holds and that the refusals
 * are the documented ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, testEnv, TEST_NOW, type Capability } from "../helpers/mock-worker.ts";

const BASE = "https://write.example.internal";

test("a burst of concurrent requests is bounded by the rate limit", async () => {
  const { capability } = await signedCapability();
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: String(TEST_NOW) }) as never;
  const path =
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

  const responses = await Promise.all(
    Array.from({ length: 60 }, () => worker.fetch(new Request(`${BASE}${path}/status`), env)),
  );

  const allowed = responses.filter((response) => response.status === 200).length;
  const refused = responses.filter((response) => response.status === 429).length;
  assert.equal(allowed + refused, 60);
  assert.ok(allowed <= 30, `at most thirty requests may be served in the window, got ${allowed}`);
  assert.ok(refused > 0, "the burst must be bounded");

  // Every refusal is the documented one, and it says it is retryable.
  for (const response of responses.filter((r) => r.status === 429)) {
    const body = (await response.json()) as { error: { code: string; retryable: boolean } };
    assert.equal(body.error.code, "rate-limited");
    assert.equal(body.error.retryable, true);
  }
});

test("the rate limit is per task, not global", async () => {
  const first = (await signedCapability({ task: "10008-1-001-01" })).capability;
  const second = (await signedCapability({ task: "10008-1-002-01" })).capability;
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: String(TEST_NOW) }) as never;

  const pathFor = (capability: Capability) =>
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

  // Spend the first task's window.
  for (let i = 0; i < 30; i++) await worker.fetch(new Request(`${BASE}${pathFor(first)}/status`), env);

  // The second task is unaffected: the limit is per task.
  const other = await worker.fetch(new Request(`${BASE}${pathFor(second)}/status`), env);
  assert.equal(other.status, 200);
});
