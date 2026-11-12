/**
 * The task-state fact over the real request path (operator channel, `GET /admin/task-state`).
 *
 * These are the build-engine half of the refusal cases the task-state transition contract
 * requires: an unsealed task, a task in the wrong state, and a stale or replayed attestation are
 * each reported as *not attested*, so that Gateway A refuses `SET_DONE` for them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, testEnv, TEST_NOW, type Capability } from "../helpers/mock-worker.ts";

const BASE = "https://write.example.internal";

function driver() {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  return {
    namespace,
    async get(capability: Capability, operation: string) {
      const path =
        `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
        `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;
      const response = await worker.fetch(new Request(`${BASE}${path}/${operation}`), env);
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
    async fact(query: string, token: string | null = "test-operator-token", method = "GET") {
      const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };
      const response = await worker.fetch(new Request(`${BASE}/admin/task-state${query}`, { method, headers }), env);
      return { response, text: await response.text() };
    },
    async admin(route: string, body: unknown) {
      return worker.fetch(
        new Request(`${BASE}/admin/${route}`, {
          method: "POST",
          headers: { Authorization: "Bearer test-operator-token", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    },
    async recordCommit(capability: Capability, overrides: Record<string, unknown> = {}) {
      const session = namespace.session(capability.task);
      await session.fetch("https://session.internal/admin/commit-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commit: {
            sha: "b".repeat(40),
            paths: ["intro.md"],
            hashes: {},
            actor: capability.writer,
            task: capability.task,
            order: capability.order,
            at: TEST_NOW,
            ...overrides,
          },
        }),
      });
    },
  };
}

function query(capability: Capability, order = capability.order): string {
  return `?task=${encodeURIComponent(capability.task)}&order=${encodeURIComponent(order)}`;
}

test("an unsealed task with a commit is reported open and not attested", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  const { response, text } = await d.fact(query(capability));
  assert.equal(response.status, 200);
  const fact = JSON.parse(text) as Record<string, unknown>;
  assert.equal(fact.state, "open");
  assert.equal(fact.committed, true);
  assert.equal(fact.sealed, false);
  assert.equal(fact.seal_attested, false);
});

test("a task sealed after a commit is attested", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  assert.equal((await d.get(capability, "seal")).response.status, 200);
  const { response, text } = await d.fact(query(capability));
  assert.equal(response.status, 200);
  const fact = JSON.parse(text) as Record<string, unknown>;
  assert.equal(fact.state, "sealed");
  assert.equal(fact.seal_attested, true);
});

test("asking about the same sealed task under another work order is not attested", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  await d.get(capability, "seal");
  const { text } = await d.fact(query(capability, "10008-S999"));
  const fact = JSON.parse(text) as Record<string, unknown>;
  assert.equal(fact.state, "sealed");
  assert.equal(fact.seal_attested, false);
});

test("a sealed task stays sealed and attested when the operator later tries to revoke it", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  await d.get(capability, "seal");
  // A sealed session cannot be revoked; the state stays sealed. The fact must say so honestly.
  await d.admin("revoke", { task: capability.task });
  const fact = JSON.parse((await d.fact(query(capability))).text) as Record<string, unknown>;
  assert.equal(fact.state, "sealed");
  assert.equal(fact.seal_attested, true);
});

test("a revoked task is not attested", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  assert.equal((await d.admin("revoke", { task: capability.task })).status, 200);
  const fact = JSON.parse((await d.fact(query(capability))).text) as Record<string, unknown>;
  assert.equal(fact.state, "revoked");
  assert.equal(fact.seal_attested, false);
});

test("a closed work order is not attested", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  assert.equal((await d.admin("close", { task: capability.task })).status, 200);
  const fact = JSON.parse((await d.fact(query(capability))).text) as Record<string, unknown>;
  assert.equal(fact.state, "closed");
  assert.equal(fact.seal_attested, false);
});

test("a task the gateway has never seen is unknown, and asking does not create it", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const first = JSON.parse((await d.fact(query(capability))).text) as Record<string, unknown>;
  assert.equal(first.known, false);
  assert.equal(first.state, "unknown");
  assert.equal(first.seal_attested, false);
  // Asking twice gives the same answer: the read created nothing, so the first real request
  // still sees a fresh, open task.
  const second = JSON.parse((await d.fact(query(capability))).text) as Record<string, unknown>;
  assert.deepEqual(second, first);
  const index = await d.get(capability, "status");
  assert.equal(index.body.state, "open");
});

test("the same fact, asked again, is the same fact (a replayed read is safe)", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability);
  await d.get(capability, "seal");
  const a = (await d.fact(query(capability))).text;
  const b = (await d.fact(query(capability))).text;
  assert.equal(a, b);
});

test("the route needs the operator token", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  for (const token of [null, "not-the-token", ""]) {
    const { response, text } = await d.fact(query(capability), token);
    assert.equal(response.status, 401);
    assert.equal(text, "unauthorised\n");
  }
});

test("a signing key does not grant the operator route", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const { response } = await d.fact(query(capability), capability.sig);
  assert.equal(response.status, 401);
});

test("malformed requests are refused with 400", async () => {
  const d = driver();
  for (const bad of [
    "",
    "?task=10008-1-001-01",
    "?order=10008-S001",
    "?task=&order=10008-S001",
    "?task=10008-1-001-01&order=10008-S001&extra=1",
    "?task=a&task=b&order=10008-S001",
    "?task=10008-1-001-01&order=a&order=b",
    "?task=../etc&order=10008-S001",
    "?task=a%2Fb&order=10008-S001",
    `?task=${"a".repeat(129)}&order=10008-S001`,
  ]) {
    const { response } = await d.fact(bad);
    assert.equal(response.status, 400, `expected 400 for ${bad}`);
  }
});

test("only GET reaches the route", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const { response } = await d.fact(query(capability), "test-operator-token", "POST");
  assert.equal(response.status, 404);
});

test("the response carries no capability, no writer and no content", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability, { paths: ["secret-name.md"], hashes: { "secret-name.md": "9".repeat(64) } });
  await d.get(capability, "seal");
  const { text } = await d.fact(query(capability));
  for (const forbidden of [capability.writer, capability.sig, "/w1/"]) {
    assert.equal(text.includes(forbidden), false, `the response must not contain ${forbidden}`);
  }
});

test("the response carries this task's paths and hashes, and nothing else (ADR 0015)", async () => {
  // The transfer verifies what the gateway sealed against the gateway's own record, so the
  // record is readable. What it never carries is the content, the writer or a capability.
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability, { paths: ["secret-name.md"], hashes: { "secret-name.md": "9".repeat(64) } });
  await d.get(capability, "seal");
  const { text } = await d.fact(query(capability));
  assert.equal(text.includes("secret-name.md"), true, "the path is there");
  assert.equal(text.includes("9".repeat(64)), true, "the hash is there");
  assert.equal(text.includes(capability.writer), false, "the writer is not");
  assert.equal(text.includes(capability.sig), false, "the signature is not");
});

test("a commit recorded against another task brings no paths or hashes", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  await d.recordCommit(capability, { paths: ["secret-name.md"], hashes: { "secret-name.md": "9".repeat(64) } });
  await d.get(capability, "seal");
  const { text } = await d.fact(`?task=${encodeURIComponent("10008-1-001-99")}&order=${encodeURIComponent(capability.order)}`);
  assert.equal(text.includes("secret-name.md"), false, "another task's paths are not here");
  assert.equal(text.includes("9".repeat(64)), false, "another task's hashes are not here");
});
