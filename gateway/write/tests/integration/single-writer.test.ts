/**
 * The single-writer rule (protocol section 2.5; plan task 5.2.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, TEST_NOW, testEnv, type Capability } from "../helpers/mock-worker.ts";

const BASE = "https://write.example.internal";

/** A query string from a plain object, in a stable order. */
function buildSearch(params: Record<string, string | undefined>): string {
  return Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`)
    .join("&");
}

/** A driver over a shared namespace, so that two capabilities hit the same task. */
function driver() {
  const namespace = new MemoryNamespace();
  // The clock is mutable so that a test can step over the rate window when it needs more than
  // thirty requests.
  let clock = TEST_NOW;
  const env = testEnv(namespace) as never;
  return {
    namespace,
    env,
    get clock() {
      return clock;
    },
    advance(seconds: number) {
      clock += seconds;
    },
    async get(capability: Capability, operation?: string, query?: Record<string, string | undefined>) {
      const path =
        `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
        `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;
      const suffix = operation === undefined ? "" : `/${operation}`;
      const search = query === undefined ? "" : `?${buildSearch(query)}`;
      const response = await worker.fetch(new Request(`${BASE}${path}${suffix}${search}`), testEnv(namespace, { CTXGATE_TEST_CLOCK: String(clock) }) as never);
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

test("a second writer for the same task is refused with 409", async () => {
  const first = await signedCapability({ writer: "agent-7" });
  const second = await signedCapability({ writer: "agent-8" });
  const d = driver();

  // The first writer claims the lease.
  assert.equal((await d.get(first.capability)).response.status, 200);

  const refused = await d.get(second.capability);
  assert.equal(refused.response.status, 409);
  assert.equal((refused.body.error as unknown as { code: string }).code, "writer-conflict");
  assert.equal((refused.body.error as unknown as { retryable: boolean }).retryable, false);
});

test("the same writer continues", async () => {
  const { capability } = await signedCapability({ writer: "agent-7" });
  const d = driver();
  assert.equal((await d.get(capability)).response.status, 200);
  assert.equal((await d.get(capability, "status")).response.status, 200);
  assert.equal((await d.get(capability, "create", { path: "intro.md" })).response.status, 200);
});

test("a writer conflict does not change the session", async () => {
  const first = await signedCapability({ writer: "agent-7" });
  const second = await signedCapability({ writer: "agent-8" });
  const d = driver();

  await d.get(first.capability, "create", { path: "intro.md" });
  const refused = await d.get(second.capability, "create", { path: "other.md" });
  assert.equal(refused.response.status, 409);

  const status = await d.get(first.capability, "status");
  const files = (status.body.result as { files: { path: string }[] }).files;
  assert.deepEqual(files.map((file) => file.path), ["intro.md"]);
});

test("the lease is released when it expires, so that a crashed writer does not deadlock the task", async () => {
  const first = await signedCapability({ writer: "agent-7" });
  const second = await signedCapability({ writer: "agent-8" });
  const d = driver();

  assert.equal((await d.get(first.capability)).response.status, 200);
  assert.equal((await d.get(second.capability)).response.status, 409);

  // The lease lasts LEASE_SECONDS (300) from the pinned clock. Move the clock past it.
  const later = testEnv(d.namespace, { CTXGATE_TEST_CLOCK: "1800000300" }) as never;
  const path =
    `/w1/${second.capability.kid}/${second.capability.exp}/${second.capability.order}/${second.capability.plan}` +
    `/${second.capability.task}/${second.capability.writer}/${second.capability.head}/${second.capability.sig}`;
  const response = await worker.fetch(new Request(`${BASE}${path}`), later);
  assert.equal(response.status, 200);
});
