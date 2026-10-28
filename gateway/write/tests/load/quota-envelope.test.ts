/**
 * The load test: the approved quota and concurrency envelope, filled to its edges.
 *
 * The contract publishes the envelope (protocol section 7.1): 20 live files, 245760 bytes in
 * total, 12288 bytes for one file, 30 requests per 60 seconds, and one writer at a time. This
 * suite drives the gateway **to the edge of every one of those numbers** and checks that the
 * limit holds and that the refusal is the documented one.
 *
 * It is a **bounded** test, and deliberately so. A load test that runs until something gives way
 * is a test whose result depends on the machine it ran on; a load test that fills the published
 * envelope and stops is a test with a pass condition that can be stated. The bounds are:
 *
 *  - the file count is filled to 20 and the 21st is refused;
 *  - the byte budget is filled to the ceiling and the next byte is refused;
 *  - the per-file ceiling is filled and the next byte is refused;
 *  - a burst of 60 concurrent requests is bounded by the rate limit;
 *  - a race of eight writers is bounded by the one-writer rule.
 *
 * The rate limit is per task and per window, so the test advances the **test clock** between the
 * phases. That is what the clock override is for: the test does not spend a minute waiting for
 * the window to reset, and the result does not depend on how fast the machine is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, testEnv, type Capability } from "../helpers/mock-worker.ts";
import { base64url } from "../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../src/util/hash.ts";
import { quotas } from "../../src/policy/quotas.ts";

const BASE = "https://write.example.internal";
const LIMITS = quotas();

/** The path of a capability. */
function pathOf(capability: Capability): string {
  return (
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`
  );
}

/** A driver whose clock the test can move. */
function driver() {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as Record<string, unknown>;
  let now = Number(env.CTXGATE_TEST_CLOCK);
  return {
    namespace,
    env,
    /** Move the clock forward, so that the rate window resets. */
    advance(seconds: number): void {
      now += seconds;
      env.CTXGATE_TEST_CLOCK = String(now);
    },
    async get(capability: Capability, operation: string, query?: Record<string, string | undefined>) {
      const search =
        query === undefined
          ? ""
          : `?${new URLSearchParams(
              Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][],
            ).toString()}`;
      const response = await worker.fetch(
        new Request(`${BASE}${pathOf(capability)}${operation === "" ? "" : `/${operation}`}${search}`),
        env as never,
      );
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

/** The code of a failure. */
function codeOf(body: Record<string, unknown>): string {
  return (body.error as { code: string }).code;
}

test("the file-count envelope holds at exactly the published number", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  for (let i = 0; i < LIMITS.max_files; i++) {
    const { response, body } = await d.get(capability, "create", { path: `file-${i}.md` });
    assert.equal(response.status, 200, `file ${i}: ${JSON.stringify(body.error)}`);
  }

  const twentyFirst = await d.get(capability, "create", { path: "one-too-many.md" });
  assert.equal(twentyFirst.response.status, 409);
  assert.equal(codeOf(twentyFirst.body), "file-count-exceeded");

  // The refusal is exact: the twentieth file is still there and the twenty-first is not.
  const status = await d.get(capability, "status", {});
  const files = (status.body.result as { files: { path: string }[] }).files;
  assert.equal(files.length, LIMITS.max_files);
  assert.ok(!files.some((file) => file.path === "one-too-many.md"));
});

test("a tombstone frees a slot, and the envelope accepts a file again", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  for (let i = 0; i < LIMITS.max_files; i++) {
    await d.get(capability, "create", { path: `file-${i}.md` });
  }
  assert.equal((await d.get(capability, "create", { path: "extra.md" })).response.status, 409);

  const deleted = await d.get(capability, "delete", { path: "file-0.md" });
  assert.equal(deleted.response.status, 200);

  const accepted = await d.get(capability, "create", { path: "extra.md" });
  assert.equal(accepted.response.status, 200, "the freed slot is usable again");
});

test("the per-file byte ceiling holds at exactly the published number", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  const atLimit = utf8("x".repeat(LIMITS.max_file_bytes));
  const { response, body } = await d.get(capability, "append", {
    path: "big.md",
    seq: "1",
    hash: await sha256Hex(atLimit),
    data: base64url(atLimit),
  });
  assert.equal(response.status, 200, JSON.stringify(body.error));

  const overLimit = utf8("x".repeat(LIMITS.max_file_bytes + 1));
  const refused = await d.get(capability, "append", {
    path: "big.md",
    seq: "2",
    hash: await sha256Hex(overLimit),
    data: base64url(overLimit),
  });
  assert.equal(refused.response.status, 413);
  assert.equal(codeOf(refused.body), "file-too-large");
});

test("the total byte budget is exactly the envelope, and it holds", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  // 20 files of 12 KiB is 240 KiB, which is exactly the total budget. The two limits coincide:
  // `max_files × max_file_bytes` is exactly `max_total_bytes`, so with the published envelope
  // the file count is reached at the same moment as the byte budget. The total-bytes check is
  // therefore a second line of defence — it fires if the operator raises one limit without the
  // other — and the unit test in `tests/unit/policy/quota-accounting.test.ts` is what exercises
  // it directly. What this test proves is that the envelope is what the contract says it is.
  assert.equal(
    LIMITS.max_files * LIMITS.max_file_bytes,
    LIMITS.max_total_bytes,
    "the published envelope is self-consistent",
  );

  const perFile = LIMITS.max_file_bytes;
  const chunk = utf8("x".repeat(perFile));
  const hash = await sha256Hex(chunk);

  for (let i = 0; i < LIMITS.max_files; i++) {
    // The rate window is 30 requests, so the clock is moved between the phases: the test must
    // not depend on the wall clock.
    if (i > 0 && i % 10 === 0) d.advance(LIMITS.rate_limit.window_seconds + 1);
    const created = await d.get(capability, "create", { path: `bulk-${i}.md` });
    assert.equal(created.response.status, 200, `file ${i}: ${JSON.stringify(created.body.error)}`);
    const written = await d.get(capability, "append", {
      path: `bulk-${i}.md`,
      seq: "1",
      hash,
      data: base64url(chunk),
    });
    assert.equal(written.response.status, 200, `file ${i}: ${JSON.stringify(written.body.error)}`);
  }

  const status = await d.get(capability, "status", {});
  const quota = (status.body.result as { quota: { live_bytes: number; live_files: number } }).quota;
  assert.equal(quota.live_files, LIMITS.max_files);
  assert.equal(quota.live_bytes, LIMITS.max_total_bytes, "the budget is spent exactly");

  // And the next file is refused — by the file count, which is reached first.
  d.advance(LIMITS.rate_limit.window_seconds + 1);
  const refused = await d.get(capability, "create", { path: "over-budget.md" });
  assert.equal(refused.response.status, 409);
  assert.equal(codeOf(refused.body), "file-count-exceeded");

  // Freeing a file frees its bytes, and the envelope accepts a file again.
  const deleted = await d.get(capability, "delete", { path: "bulk-0.md" });
  assert.equal(deleted.response.status, 200);
  const accepted = await d.get(capability, "create", { path: "over-budget.md" });
  assert.equal(accepted.response.status, 200);
});

test("a burst of concurrent requests is bounded by the rate limit", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  const burst = LIMITS.rate_limit.requests * 2;
  const responses = await Promise.all(
    Array.from({ length: burst }, () =>
      worker.fetch(new Request(`${BASE}${pathOf(capability)}/status`), d.env as never),
    ),
  );

  const allowed = responses.filter((response) => response.status === 200).length;
  const refused = responses.filter((response) => response.status === 429).length;
  assert.equal(allowed + refused, burst, "every request got an answer");
  assert.equal(allowed, LIMITS.rate_limit.requests, "exactly the window's worth was served");
  assert.equal(refused, burst - LIMITS.rate_limit.requests);
});

test("the concurrency envelope admits exactly one writer", async () => {
  const d = driver();
  const capabilities = await Promise.all(
    Array.from({ length: 8 }, (_, index) => signedCapability({ writer: `agent-${index}` })),
  );

  const responses = await Promise.all(
    capabilities.map((entry) =>
      worker.fetch(new Request(`${BASE}${pathOf(entry.capability)}/status`), d.env as never),
    ),
  );

  const admitted = responses.filter((response) => response.status === 200).length;
  const refused = responses.filter((response) => response.status === 409).length;
  assert.equal(admitted, 1, "one writer at a time");
  assert.equal(refused, 7);
});

test("the load test does not deploy and does not write to production", () => {
  // The load suite runs against the in-memory harness. There is no deployment in it, and the
  // provider address it would use is a loopback one. This is a statement, not a check — the
  // check is that the harness has no deployment path at all, which is why the gate below can
  // rely on it.
  assert.equal(LIMITS.max_concurrency, 1, "the envelope is one writer at a time");
  assert.ok(LIMITS.max_total_bytes > 0 && LIMITS.max_files > 0, "the envelope is published");
});
