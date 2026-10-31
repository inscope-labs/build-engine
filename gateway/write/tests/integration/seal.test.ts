/**
 * The seal, and the three closures (protocol section 5.2, 8.4; plan tasks 5.2.9 and 5.2.10).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import { MemoryNamespace, signedCapability, testEnv, TEST_NOW, type Capability } from "../helpers/mock-worker.ts";

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
  };
}

test("a seal without a commit is refused", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const { response, body } = await d.get(capability, "seal");
  assert.equal(response.status, 409);
  assert.equal((body.error as unknown as { code: string }).code, "seal-requires-commit");
  assert.equal(body.state, "open");
});

test("a seal after a successful commit freezes the folder", async () => {
  const { capability } = await signedCapability();
  const d = driver();

  // Stage 5.3 records the commit. Until it lands, the test records it through the session's own
  // interface, which is the same one Stage 5.3 will use.
  const session = d.namespace.session(capability.task);
  await session.fetch("https://session.internal/admin/commit-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commit: {
        sha: "b".repeat(40),
        paths: ["intro.md"],
        hashes: { "intro.md": "c".repeat(64) },
        actor: capability.writer,
        at: TEST_NOW,
      },
    }),
  });

  const sealed = await d.get(capability, "seal");
  assert.equal(sealed.response.status, 200);
  assert.equal(sealed.body.state, "sealed");
  assert.equal((sealed.body.result as unknown as { sealed: boolean }).sealed, true);
  // A sealed task has no next step: the only legal next step is to stop.
  assert.deepEqual((sealed.body.links as { next: unknown[] }).next, []);
});

test("a sealed task refuses every write, and says that it is sealed", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const session = d.namespace.session(capability.task);
  await session.fetch("https://session.internal/admin/commit-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commit: { sha: "b".repeat(40), paths: [], hashes: {}, actor: capability.writer, at: TEST_NOW },
    }),
  });
  assert.equal((await d.get(capability, "seal")).response.status, 200);

  const write = await d.get(capability, "create", { path: "intro.md" });
  assert.equal(write.response.status, 410);
  assert.equal((write.body.error as unknown as { code: string }).code, "task-sealed");
  assert.equal(write.body.state, "sealed");
});

test("a sealed task still answers the index, so that the agent can learn why it stopped", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const session = d.namespace.session(capability.task);
  await session.fetch("https://session.internal/admin/commit-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commit: { sha: "b".repeat(40), paths: [], hashes: {}, actor: capability.writer, at: TEST_NOW },
    }),
  });
  assert.equal((await d.get(capability, "seal")).response.status, 200);

  const index = await d.get(capability);
  assert.equal(index.response.status, 200);
  assert.equal(index.body.state, "sealed");
});

test("a revoked task refuses every write, with its own code", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const response = await d.admin("revoke", { task: capability.task });
  assert.equal(response.status, 200);

  const write = await d.get(capability, "create", { path: "intro.md" });
  assert.equal(write.response.status, 410);
  assert.equal((write.body.error as unknown as { code: string }).code, "task-revoked");
});

test("a closed work order refuses every write, with its own code", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  assert.equal((await d.admin("close", { task: capability.task })).status, 200);

  const write = await d.get(capability, "create", { path: "intro.md" });
  assert.equal(write.response.status, 410);
  assert.equal((write.body.error as unknown as { code: string }).code, "order-closed");
});

test("seal, revocation and closure are three different closures", async () => {
  // The contract says they are distinct state transitions, not one flag. The codes prove it.
  const codes = new Set<string>();
  for (const close of ["seal", "revoke", "close"]) {
    const { capability } = await signedCapability();
    const d = driver();
    if (close === "seal") {
      const session = d.namespace.session(capability.task);
      await session.fetch("https://session.internal/admin/commit-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commit: { sha: "b".repeat(40), paths: [], hashes: {}, actor: capability.writer, at: TEST_NOW },
        }),
      });
      await d.get(capability, "seal");
    } else {
      await d.admin(close, { task: capability.task });
    }
    const write = await d.get(capability, "create", { path: "intro.md" });
    codes.add((write.body.error as unknown as { code: string }).code);
  }
  assert.deepEqual([...codes].sort(), ["order-closed", "task-revoked", "task-sealed"]);
});

test("the operator channel needs its own credential", async () => {
  const { capability } = await signedCapability();
  const d = driver();
  const response = await worker.fetch(
    new Request(`${BASE}/admin/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: capability.task }),
    }),
    d.env,
  );
  assert.equal(response.status, 401);
});
