/**
 * The happy path, end to end, through the real Worker and the real Durable Object.
 *
 * The test drives the Worker's `fetch` with a mock environment whose Durable Object namespace
 * runs the **real** `TaskSession` class over an in-memory storage. Nothing here re-implements
 * the code under test: the signature, the router, the session and the staging operations are
 * the shipped ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, capabilityFields, signedCapability, testEnv, TEST_NOW, type Capability } from "../helpers/mock-worker.ts";
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

/** A driver: it holds the namespace and the environment, and it makes requests. */
function driver() {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  return {
    namespace,
    async get(capability: Capability, operation?: string, query?: Record<string, string | undefined>) {
      const parts = [
        `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}`,
        `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`,
      ].join("");
      const suffix = operation === undefined ? "" : `/${operation}`;
      const search = query === undefined ? "" : `?${buildSearch(query)}`;
      const response = await worker.fetch(new Request(`${BASE}${parts}${suffix}${search}`), env);
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

test("the index is the first thing an agent sees, and it describes the session", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const { response, body } = await d.get(capability);

  assert.equal(response.status, 200);
  assert.equal(body.protocol, "ctxwrite-v1");
  assert.equal(body.op, "index");
  assert.equal(body.state, "open");
  assert.equal(body.error, null);
  assert.equal((body.result as { writer: string }).writer, capability.writer);
  assert.equal(
    (body.result as { folder: string }).folder,
    "plans/castiel-dev/submissions/10008-S001/10008-1-001-01",
  );
  assert.equal((body.result as { quotas: { max_files: number } }).quotas.max_files, 20);
  assert.ok(Array.isArray((body.links as { next: unknown[] }).next));
  assert.equal((body.links as { contract: string }).contract, `${BASE}/contract/ctxwrite-v1`);
});

test("every response carries the no-store headers", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const { response } = await d.get(capability);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.ok(response.headers.get("X-Request-Id"));
});

test("a file is scaffolded, written, read back and listed", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  const created = await d.get(capability, "create", { path: "intro.md" });
  assert.equal(created.response.status, 200);
  assert.equal((created.body.result as unknown as { created: boolean }).created, true);

  const text = "hello world\n";
  const bytes = utf8(text);
  const hash = await sha256Hex(bytes);
  const appended = await d.get(capability, "append", {
    path: "intro.md",
    seq: "1",
    hash,
    data: base64url(bytes),
  });
  assert.equal(appended.response.status, 200);
  assert.equal((appended.body.result as unknown as { bytes: number }).bytes, 12);

  const read = await d.get(capability, "read", { path: "intro.md" });
  assert.equal(read.response.status, 200);
  assert.equal((read.body.result as unknown as { data: string }).data, base64url(bytes));

  const status = await d.get(capability, "status");
  assert.equal(status.response.status, 200);
  const files = (status.body.result as { files: { path: string; content: string; bytes: number }[] }).files;
  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, "intro.md");
  assert.equal(files[0]?.content, "present");
  assert.equal(files[0]?.bytes, 12);
});

test("a replayed chunk is idempotent", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.get(capability, "create", { path: "intro.md" });

  const bytes = utf8("hello\n");
  const hash = await sha256Hex(bytes);
  const query = { path: "intro.md", seq: "1", hash, data: base64url(bytes) };

  const first = await d.get(capability, "append", query);
  assert.equal(first.response.status, 200);
  const second = await d.get(capability, "append", query);
  assert.equal(second.response.status, 200);
  assert.equal((second.body.result as unknown as { replayed?: boolean }).replayed, true);

  const status = await d.get(capability, "status");
  const quota = (status.body.result as { quota: { live_bytes: number } }).quota;
  assert.equal(quota.live_bytes, 6, "a replay must not accept the bytes twice");
});

test("a capability that was never signed is refused, with the same body as every other pre-signature failure", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  const tampered: Capability = { ...capability, sig: "A".repeat(43) };
  const bad = await d.get(tampered);
  assert.equal(bad.response.status, 401);
  assert.equal((bad.body.error as { code: string }).code, "not-authorised");

  const malformed = await worker.fetch(new Request(`${BASE}/w1/nonsense`), testEnv(d.namespace) as never);
  assert.equal(malformed.status, 401);
  const malformedBody = (await malformed.json()) as { error: { code: string } };
  assert.equal(malformedBody.error.code, "not-authorised");
});

test("an expired capability is refused with 403, which is only reachable after a valid signature", async () => {
  const { capability } = await signedCapability({ exp: TEST_NOW - 1000 });
  const d = driver();
  const { response, body } = await d.get(capability);
  assert.equal(response.status, 403);
  assert.equal((body.error as unknown as { code: string }).code, "capability-expired");
});

test("a capability whose lifetime is too long is refused", async () => {
  const { capability } = await signedCapability({ exp: TEST_NOW + 604_801 });
  const d = driver();
  const { response, body } = await d.get(capability);
  assert.equal(response.status, 403);
  assert.equal((body.error as unknown as { code: string }).code, "ttl-exceeded");
});

test("a method that is not GET is refused with 405", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const response = await worker.fetch(
    new Request(`${BASE}/w1/${capability.kid}/x`, { method: "POST" }),
    testEnv(d.namespace) as never,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});

test("the health endpoint reports the policy and does not leak anything", async () => {
  const d = driver();
  const response = await worker.fetch(new Request(`${BASE}/healthz`), testEnv(d.namespace) as never);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { protocol: string; policy: { key_ids: string[] }; conformance_clock: boolean };
  assert.equal(body.protocol, "ctxwrite-v1");
  assert.deepEqual(body.policy.key_ids, ["k1"]);
  assert.equal(body.conformance_clock, true, "the health endpoint must report that the test clock is on");
  assert.equal(JSON.stringify(body).includes("test-only-signing-secret"), false);
});

test("the contract documents are served by the gateway", async () => {
  const d = driver();
  for (const route of ["/contract/ctxwrite-v1", "/contract/ctxwrite-v1/errors", "/contract/ctxwrite-v1/quotas"]) {
    const response = await worker.fetch(new Request(`${BASE}${route}`), testEnv(d.namespace) as never);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    const text = await response.text();
    assert.ok(text.length > 500, route);
  }
});

test("a misconfigured gateway fails closed and names the setting", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace, { SUBMISSIONS_REPO: "" }) as never;
  const response = await worker.fetch(new Request(`${BASE}/healthz`), env);
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(text.includes("SUBMISSIONS_REPO"), text);
});

test("the fields a capability binds are the ones the contract says", async () => {
  const fields = capabilityFields();
  assert.equal(fields.kid, "k1");
  assert.equal(fields.order, "10008-S001");
  assert.equal(fields.plan, "castiel-dev");
  assert.equal(fields.task, "10008-1-001-01");
  assert.equal(fields.writer, "agent-7");
});
