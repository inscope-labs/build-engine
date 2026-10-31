/**
 * The state channel fails closed.
 *
 * The revocation list, the abuse budgets and the audit ring live in the Durable Object. If the
 * gateway cannot read them, it does not know whether an order has been revoked and it does not
 * know whether a budget has been spent. In that situation the only safe answer is to serve
 * nothing, and this test is what holds the code to that.
 *
 * The case that matters most: the state store answers with an error. The gateway must NOT read
 * that as "there are no revocations", because a revoked capability that keeps working is worse
 * than an outage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStateClient, callStateAdmin, STATE_UNAVAILABLE } from "../../src/state-client.ts";
import type { Policy } from "../../src/policy.ts";

const POLICY = {
  rateLimitPerIp: 600,
  rateLimitGlobal: 2000,
  rateLimitPerOrder: 120,
  auditRetention: 500,
  refusalBurst: 60,
  refusalCooldownSeconds: 300,
} as unknown as Policy;

/** A Durable Object stub that answers with whatever the test tells it to. */
function stateStore(behaviour: "ok" | "error" | "throw" | "garbage", body: unknown = { action: "allow", reason: "ok" }) {
  const calls: string[] = [];
  const stub = {
    async fetch(url: string) {
      calls.push(String(url));
      if (behaviour === "throw") throw new Error("the object is unreachable");
      if (behaviour === "error") return new Response("state error: storage is down", { status: 500 });
      if (behaviour === "garbage") return new Response("not json", { status: 200 });
      return Response.json(body);
    },
  };
  const env = { STATE: { idFromName: () => "state-id", get: () => stub } } as unknown as {
    STATE: DurableObjectNamespace;
  };
  return { env, calls };
}

test("a state store that answers normally is believed", async () => {
  const { env } = stateStore("ok", { action: "allow", reason: "ok" });
  const client = buildStateClient(env, POLICY);
  assert.deepEqual(await client.gate("1.2.3.4", 1000), { action: "allow", reason: "ok" });
  assert.deepEqual(await client.apply("10008-S001", 1000), { action: "allow", reason: "ok" });
});

test("a revocation the store reports is passed through", async () => {
  const { env } = stateStore("ok", { action: "revoked", reason: "revoked" });
  const client = buildStateClient(env, POLICY);
  assert.deepEqual(await client.apply("10008-S001", 1000), { action: "revoked", reason: "revoked" });
});

test("a state store that errors is not read as an empty revocation list", async () => {
  const { env } = stateStore("error");
  const client = buildStateClient(env, POLICY);
  const applied = await client.apply("10008-S001", 1000);
  assert.equal(applied.action, STATE_UNAVAILABLE, "an unreadable revocation list must fail closed");
  assert.notEqual(applied.action, "allow");
  const gated = await client.gate("1.2.3.4", 1000);
  assert.equal(gated.action, STATE_UNAVAILABLE, "an unreadable budget must fail closed");
});

test("a state store that cannot be reached is not read as an empty revocation list", async () => {
  const { env } = stateStore("throw");
  const client = buildStateClient(env, POLICY);
  const applied = await client.apply("10008-S001", 1000);
  assert.equal(applied.action, STATE_UNAVAILABLE);
});

test("a state store that answers with something that is not a decision fails closed", async () => {
  const { env } = stateStore("garbage");
  const client = buildStateClient(env, POLICY);
  assert.equal((await client.apply("10008-S001", 1000)).action, STATE_UNAVAILABLE);
});

test("an audit record that cannot be written is logged, not lost and not thrown", async () => {
  const { env } = stateStore("error");
  const client = buildStateClient(env, POLICY);
  const written: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => written.push(args.map(String).join(" "));
  try {
    await client.audit({
      ts: 1,
      status: 503,
      reason: "state-unavailable",
      kid: "-",
      order: "-",
      ref: "-",
      path: "-",
      bytes: 0,
      request_id: "abc",
    });
  } finally {
    console.log = original;
  }
  assert.equal(written.length, 1, "the record must be written somewhere");
  assert.match(written[0]!, /state-unavailable/);
});

test("the operator channel reports a revoke the store did not accept as a failure", async () => {
  const { env } = stateStore("error");
  const result = await callStateAdmin(env, "/revoke", "POST", { order: "10008-S001" });
  assert.equal(result.ok, false, "a revoke that was not stored must not be reported as done");
  if (!result.ok) assert.equal(result.status, 503);
});

test("the operator channel reports a revoke the store accepted", async () => {
  const { env } = stateStore("ok", { revoked: "10008-S001" });
  const result = await callStateAdmin(env, "/revoke", "POST", { order: "10008-S001" });
  assert.equal(result.ok, true);
});
