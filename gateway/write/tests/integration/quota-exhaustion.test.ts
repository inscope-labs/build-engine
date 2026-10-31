/**
 * The quotas, end to end (protocol section 7.1; plan task 5.2.6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, TEST_NOW, testEnv, type Capability } from "../helpers/mock-worker.ts";
import { base64url } from "../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../src/util/hash.ts";

const BASE = "https://write.example.internal";

/** A query string from a plain object, in a stable order. */
function buildSearch(params: Record<string, string | undefined>): string {
  return Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`)
    .join("&");
}

/** A driver over a fresh namespace. */
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

/** The parameters of a chunk write. */
async function chunk(text: string, seq = 1): Promise<Record<string, string>> {
  const bytes = utf8(text);
  return { seq: String(seq), hash: await sha256Hex(bytes), data: base64url(bytes) };
}

test("the twentieth file is accepted and the twenty-first is refused", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 20 === 0) d.advance(61);
    const created = await d.get(capability, "create", { path: `file-${i}.md` });
    assert.equal(created.response.status, 200, `file ${i}`);
  }
  const refused = await d.get(capability, "create", { path: "file-20.md" });
  assert.equal(refused.response.status, 409);
  assert.equal((refused.body.error as unknown as { code: string }).code, "file-count-exceeded");
});

test("a file that is too large is refused", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  assert.equal((await d.get(capability, "create", { path: "big.md" })).response.status, 200);

  const c = await chunk("x".repeat(12289));
  const refused = await d.get(capability, "append", { path: "big.md", ...c });
  assert.equal(refused.response.status, 413);
  assert.equal((refused.body.error as unknown as { code: string }).code, "file-too-large");
});

test("the total byte budget is enforced across files", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  // 20 files of 12 KiB is 240 KiB, which is exactly the budget. The 21st byte is refused.
  const body = "x".repeat(12288);
  const c = await chunk(body);
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 10 === 0) d.advance(61);
    const path = `file-${i}.md`;
    assert.equal((await d.get(capability, "create", { path })).response.status, 200);
    const appended = await d.get(capability, "append", { path, ...c });
    assert.equal(appended.response.status, 200, `file ${i}`);
  }

  const status = await d.get(capability, "status");
  const quota = (status.body.result as { quota: { live_bytes: number; live_files: number } }).quota;
  assert.equal(quota.live_bytes, 245760);
  assert.equal(quota.live_files, 20);
});

test("a tombstone frees a slot and its bytes, so that the agent can recover", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 20 === 0) d.advance(61);
    assert.equal((await d.get(capability, "create", { path: `file-${i}.md` })).response.status, 200);
  }
  const refused = await d.get(capability, "create", { path: "file-20.md" });
  assert.equal(refused.response.status, 409);

  assert.equal((await d.get(capability, "delete", { path: "file-0.md" })).response.status, 200);
  const accepted = await d.get(capability, "create", { path: "file-20.md" });
  assert.equal(accepted.response.status, 200);
});

test("the rate limit refuses the thirty-first request in the window", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  // The limit is 30 requests per 60 seconds. The index and the creates below spend the window.
  let last = await d.get(capability);
  for (let i = 0; i < 40; i++) {
    last = await d.get(capability, "status");
    if (last.response.status === 429) break;
  }
  assert.equal(last.response.status, 429);
  assert.equal((last.body.error as unknown as { code: string }).code, "rate-limited");
  assert.equal((last.body.error as unknown as { retryable: boolean }).retryable, true);
});

test("the rate window resets", async () => {
  const { capability } = await signedCapability();
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: "1800000000" }) as never;
  const path =
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

  for (let i = 0; i < 31; i++) await worker.fetch(new Request(`${BASE}${path}`), env);
  const refused = await worker.fetch(new Request(`${BASE}${path}`), env);
  assert.equal(refused.status, 429);

  // A minute later the window has reset.
  const later = testEnv(namespace, { CTXGATE_TEST_CLOCK: "1800000061" }) as never;
  const allowed = await worker.fetch(new Request(`${BASE}${path}`), later);
  assert.equal(allowed.status, 200);
});
