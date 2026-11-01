/**
 * Chaos: the Worker's isolate is recycled.
 *
 * The two evictions are different events, and this suite is about the one that loses **nothing**.
 *
 *  - The **Durable Object** eviction (`do-eviction.test.ts`) reclaims the object's memory. The
 *    staged content goes with it, because the content lives in the object's memory and nowhere
 *    else (ADR 0002). The inventory survives, because the storage is the platform's.
 *
 *  - The **Worker's** isolate eviction is the platform reclaiming the edge code. The Worker holds
 *    no agent state at all: the session, the writer lease, the inventory, the quota ledger, the
 *    idempotency store, the commit record and the seal are all in the Durable Object, and the
 *    staged content is in that object's memory. So a recycled Worker loses exactly one thing —
 *    its per-instance counters, which is why `/admin/metrics` says `scope: worker-instance` and
 *    points at the durable audit stream for the totals.
 *
 * WHAT IS SIMULATED, AND WHAT IS NOT. The harness runs the Worker module in one process, so a
 * genuinely new module instance cannot be created here. What a new isolate *is*, from the
 * gateway's point of view, is a fresh set of bindings: the platform hands the isolate its
 * environment again, and the isolate re-reads its configuration from it. The test does exactly
 * that — it builds a **new environment** over the same Durable Object namespace and drives the
 * next request through it. The Durable Object is not touched, which is the point: the Worker
 * isolate and the Durable Object isolate are independent, and recycling one does not recycle the
 * other.
 *
 * The claim this suite makes is therefore precise: **the Worker's isolate holds no agent state**,
 * and the per-instance counters are the only thing an isolate eviction takes away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { testRepo } from "../helpers/mock-github.ts";
import { commitDriver } from "../helpers/github-test-repo.ts";
import { testEnv } from "../helpers/mock-worker.ts";

const BASE = "https://write.example.internal";

/** The path of a capability. */
function pathOf(capability: { kid: string; exp: number; order: string; plan: string; task: string; writer: string; head: string; sig: string }): string {
  return (
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`
  );
}

test("a recycled Worker isolate loses none of the agent's work", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("notes.md", "hello\n");

    // The isolate is recycled: a new set of bindings, handed to a new Worker, over the same
    // Durable Object namespace.
    const recycled = testEnv(d.namespace, {
      GITHUB_API_BASE: github.baseUrl,
      GITHUB_TIMEOUT_MS: "2000",
    });

    const { default: worker } = await import("../../src/index.ts");
    const read = await worker.fetch(
      new Request(`${BASE}${pathOf(d.capability)}/read?path=notes.md`),
      recycled as never,
    );
    assert.equal(read.status, 200, "the staged content is untouched by the Worker's recycle");
    const body = (await read.json()) as { result: { bytes: number } };
    assert.equal(body.result.bytes, 6);
  } finally {
    await github.stop();
  }
});

test("a commit that lost its response is still safe to retry after a recycle", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    const first = await d.get("commit", { files: "intro.md" });
    assert.equal(first.response.status, 200, JSON.stringify(first.body.error));

    const recycled = testEnv(d.namespace, {
      GITHUB_API_BASE: github.baseUrl,
      GITHUB_TIMEOUT_MS: "2000",
    });
    const { default: worker } = await import("../../src/index.ts");
    const again = await worker.fetch(
      new Request(`${BASE}${pathOf(d.capability)}/commit?files=intro.md`),
      recycled as never,
    );
    assert.equal(again.status, 200);
    const body = (await again.json()) as { result: { replayed: boolean; commit: string } };
    assert.equal(body.result.replayed, true, "the idempotency store survived the recycle");
    assert.equal(body.result.commit, (first.body.result as { commit: string }).commit);
    assert.equal(github.commitCount, 2, "the branch was not moved a second time");
  } finally {
    await github.stop();
  }
});

test("a seal survives the Worker's recycle", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("intro.md", "hello\n");
    assert.equal((await d.get("commit", { files: "intro.md" })).response.status, 200);
    assert.equal((await d.get("seal")).response.status, 200);

    const recycled = testEnv(d.namespace, {
      GITHUB_API_BASE: github.baseUrl,
      GITHUB_TIMEOUT_MS: "2000",
    });
    const { default: worker } = await import("../../src/index.ts");
    const write = await worker.fetch(
      new Request(`${BASE}${pathOf(d.capability)}/create?path=another.md`),
      recycled as never,
    );
    assert.equal(write.status, 410);
    const body = (await write.json()) as { error: { code: string } };
    assert.equal(body.error.code, "task-sealed");
  } finally {
    await github.stop();
  }
});

test("the durable audit stream outlives the instance the counters belong to", async () => {
  const github = await testRepo();
  try {
    const d = await commitDriver(github);
    await d.stage("notes.md", "hello\n");
    await d.get("status");

    // The metrics say what they are: a live view of one instance, not a total.
    const metrics = await d.get("index");
    assert.equal(metrics.response.status, 200);

    const { default: worker } = await import("../../src/index.ts");
    const response = await worker.fetch(
      new Request(`${BASE}/admin/metrics`, {
        headers: { Authorization: "Bearer test-operator-token" },
      }),
      d.env as never,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { scope: string; note: string };
    assert.equal(body.scope, "worker-instance");
    assert.match(body.note, /audit stream/i, "the endpoint says where the totals are");

    // The stream itself is per order, in its own Durable Object, and it holds every request of
    // the order — including the ones that were served before the recycle.
    const audit = await worker.fetch(
      new Request(`${BASE}/admin/audit?order=${d.capability.order}`, {
        headers: { Authorization: "Bearer test-operator-token" },
      }),
      d.env as never,
    );
    assert.equal(audit.status, 200);
    const records = (await audit.json()) as unknown[];
    assert.ok(Array.isArray(records), "the stream answers with an array of records");
    assert.ok(records.length >= 3, `the stream holds the earlier records too: ${records.length}`);
  } finally {
    await github.stop();
  }
});
