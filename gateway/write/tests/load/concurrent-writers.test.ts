/**
 * Concurrent writers (protocol section 2.5; plan tasks 5.2.3 and 5.5.7).
 *
 * The single-writer rule has to hold under concurrency, not just in sequence. The Durable Object
 * serialises the requests that touch one task, so the lease is consistent; these tests check that
 * the observable behaviour matches: exactly one writer is admitted, and the rest are refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, testEnv, TEST_NOW, type Capability } from "../helpers/mock-worker.ts";
import { base64url } from "../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../src/util/hash.ts";

const BASE = "https://write.example.internal";

/** The path of a capability. */
function pathOf(capability: Capability): string {
  return (
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`
  );
}

test("when several writers race, exactly one is admitted", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: String(TEST_NOW) }) as never;

  // Three different capabilities for the same task, so three different writers.
  const capabilities = await Promise.all([
    signedCapability({ writer: "agent-1" }),
    signedCapability({ writer: "agent-2" }),
    signedCapability({ writer: "agent-3" }),
  ]);

  const responses = await Promise.all(
    capabilities.map((entry) => worker.fetch(new Request(`${BASE}${pathOf(entry.capability)}/status`), env)),
  );

  const admitted = responses.filter((response) => response.status === 200).length;
  const refused = responses.filter((response) => response.status === 409).length;
  assert.equal(admitted, 1, "exactly one writer may hold the lease");
  assert.equal(refused, 2);
});

test("concurrent writes from the admitted writer are all applied, in sequence", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: String(TEST_NOW) }) as never;
  const { capability } = await signedCapability();

  // Take the lease first, so that the writes below are not racing for it.
  assert.equal((await worker.fetch(new Request(`${BASE}${pathOf(capability)}`), env)).status, 200);

  const bytes = utf8("chunk\n");
  const hash = await sha256Hex(bytes);
  const query = `?path=out.txt&seq=1&hash=${hash}&data=${base64url(bytes)}`;
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => worker.fetch(new Request(`${BASE}${pathOf(capability)}/append${query}`), env)),
  );

  // Every response is a success or a documented replay: the chunk is applied exactly once.
  for (const response of responses) {
    assert.equal(response.status, 200, `unexpected status ${response.status}`);
  }
  const status = await worker.fetch(new Request(`${BASE}${pathOf(capability)}/status`), env);
  const body = (await status.json()) as { result: { files: { path: string; bytes: number }[]; quota: { live_bytes: number } } };
  const file = body.result.files.find((entry) => entry.path === "out.txt");
  assert.equal(file?.bytes, 6, "the chunk is applied once, not eight times");
  assert.equal(body.result.quota.live_bytes, 6, "the bytes are accepted once");
});

test("a second writer cannot change the session while the first holds the lease", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { CTXGATE_TEST_CLOCK: String(TEST_NOW) }) as never;
  const first = await signedCapability({ writer: "agent-1" });
  const second = await signedCapability({ writer: "agent-2" });

  await worker.fetch(new Request(`${BASE}${pathOf(first.capability)}/create?path=a.md`), env);
  const refused = await worker.fetch(new Request(`${BASE}${pathOf(second.capability)}/create?path=b.md`), env);
  assert.equal(refused.status, 409);

  const status = await worker.fetch(new Request(`${BASE}${pathOf(first.capability)}/status`), env);
  const body = (await status.json()) as { result: { files: { path: string }[] } };
  assert.deepEqual(body.result.files.map((entry) => entry.path), ["a.md"]);
});
