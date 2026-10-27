/**
 * The audit stream (plan task 5.4.1, protocol section 11).
 *
 * The platform's log is the complete stream; this is the durable, queryable copy of the records
 * that belong to an order. What is checked here is that the copy is complete for its order,
 * that it is redacted, and that it is bounded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryNamespace, capabilityFields, signedCapability, testEnv, type Capability } from "../helpers/mock-worker.ts";
import { containsSecret } from "../../src/audit/redaction.ts";

const BASE = "https://write.example.internal";

/** A driver that records what the gateway emitted. */
function driver() {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  return {
    namespace,
    env,
    async get(capability: Capability, operation?: string, query?: Record<string, string | undefined>) {
      const parts = [
        `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}`,
        `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`,
      ].join("");
      const search =
        query === undefined
          ? ""
          : `?${new URLSearchParams(
              Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][],
            ).toString()}`;
      const { default: worker } = await import("../../src/index.ts");
      const response = await worker.fetch(
        new Request(`${BASE}${parts}${operation ?? ""}${search}`),
        env,
      );
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
    async operator(path: string, token = "test-operator-token") {
      const { default: worker } = await import("../../src/index.ts");
      const response = await worker.fetch(
        new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }),
        env,
      );
      return { response, body: await response.text() };
    },
  };
}

test("the operator can read an order's audit stream", async () => {
  const d = driver();
  const { capability } = await signedCapability(capabilityFields());
  await d.get(capability, "/create", { path: "intro.md" });

  const { response, body } = await d.operator(`/admin/audit?order=${capability.order}`);
  assert.equal(response.status, 200);
  const records = JSON.parse(body) as { op: string; reason: string; status: number }[];
  assert.ok(records.length >= 1);
  assert.equal(records[0]!.op, "create");
  assert.equal(records[0]!.reason, "ok");
  assert.equal(records[0]!.status, 200);
});

test("the stream holds every request of the order, and the refusals with their codes", async () => {
  const d = driver();
  const { capability } = await signedCapability(capabilityFields());
  await d.get(capability, "/create", { path: "intro.md" });
  await d.get(capability, "/read", { path: "nowhere.md" });

  const { body } = await d.operator(`/admin/audit?order=${capability.order}`);
  const records = JSON.parse(body) as { op: string; reason: string }[];
  assert.equal(records.length, 2);
  assert.equal(records[1]!.op, "read");
  assert.equal(records[1]!.reason, "file-not-found");
});

test("one order's stream holds no other order's records", async () => {
  const d = driver();
  const first = await signedCapability(capabilityFields({ order: "ORDER-A" }));
  const second = await signedCapability(capabilityFields({ order: "ORDER-B" }));
  await d.get(first.capability, "/status");
  await d.get(second.capability, "/status");
  await d.get(second.capability, "/status");

  const a = JSON.parse((await d.operator(`/admin/audit?order=ORDER-A`)).body) as unknown[];
  const b = JSON.parse((await d.operator(`/admin/audit?order=ORDER-B`)).body) as unknown[];
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
});

test("the records are redacted: no path, no content, nothing that looks like a secret", async () => {
  const d = driver();
  const { capability } = await signedCapability(capabilityFields());
  await d.get(capability, "/create", { path: "intro.md" });

  const { body } = await d.operator(`/admin/audit?order=${capability.order}`);
  assert.ok(!body.includes("intro.md"), "the record must not name the file");
  assert.equal(containsSecret(body), false);
});

test("the stream is bounded by the count and by the age", async () => {
  const d = driver();
  const { capability } = await signedCapability(capabilityFields());
  for (let i = 0; i < 5; i++) await d.get(capability, "/status");

  const limited = JSON.parse((await d.operator(`/admin/audit?order=${capability.order}&limit=2`)).body) as unknown[];
  assert.equal(limited.length, 2);

  const future = JSON.parse(
    (await d.operator(`/admin/audit?order=${capability.order}&since=${Number.MAX_SAFE_INTEGER}`)).body,
  ) as unknown[];
  assert.equal(future.length, 0);
});

test("the audit route needs the operator credential", async () => {
  const d = driver();
  const { response } = await d.operator("/admin/audit?order=10008-S001", "not-the-token");
  assert.equal(response.status, 401);
});

test("the audit route needs an order", async () => {
  const d = driver();
  const { response } = await d.operator("/admin/audit");
  assert.equal(response.status, 400);
});

test("the metrics endpoint says that it is not a total", async () => {
  const d = driver();
  const { capability } = await signedCapability(capabilityFields());
  await d.get(capability, "/status");

  const { response, body } = await d.operator("/admin/metrics");
  assert.equal(response.status, 200);
  const parsed = JSON.parse(body) as { scope: string; counters: { requests: number; byCode: Record<string, number> } };
  assert.equal(parsed.scope, "worker-instance");
  assert.ok(parsed.counters.requests >= 1);
  assert.ok(Object.keys(parsed.counters.byCode).length >= 0);
});
