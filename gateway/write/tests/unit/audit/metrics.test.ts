/**
 * The counters (plan task 5.5.2: the error mapping and the counters).
 *
 * The counters exist so that an operator can see what the gateway is doing without reading the
 * audit stream. They count **events**; they never carry a path, a query string or a payload.
 *
 * The counters are per Worker instance, and therefore per isolate. That is why the metrics
 * endpoint says so in its own body. The test below pins the *scope* of the counters — a set of
 * counters is independent of every other set — because that is the property the endpoint's
 * disclaimer rests on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { count, emptyCounters } from "../../../src/audit/metrics.ts";

test("a fresh set of counters is all zeros", () => {
  const counters = emptyCounters();
  assert.equal(counters.requests, 0);
  assert.equal(counters.notAuthorised, 0);
  assert.equal(counters.refused, 0);
  assert.equal(counters.replays, 0);
  assert.equal(counters.bytes, 0);
  assert.equal(counters.auditWriteFailures, 0);
  assert.deepEqual(counters.byOperation, {});
  assert.deepEqual(counters.byCode, {});
});

test("a success is counted by operation", () => {
  const counters = emptyCounters();
  count(counters, { op: "status", status: 200 });
  count(counters, { op: "status", status: 200 });
  count(counters, { op: "commit", status: 200 });

  assert.equal(counters.requests, 3);
  assert.deepEqual(counters.byOperation, { status: 2, commit: 1 });
  assert.equal(counters.refused, 0);
});

test("a failure is counted by code, and is a refusal", () => {
  const counters = emptyCounters();
  count(counters, { op: "read", status: 404, code: "file-not-found" });
  count(counters, { op: "read", status: 404, code: "file-not-found" });
  count(counters, { op: "commit", status: 409, code: "writer-conflict" });

  assert.equal(counters.requests, 3);
  assert.equal(counters.refused, 3);
  assert.deepEqual(counters.byCode, { "file-not-found": 2, "writer-conflict": 1 });
  assert.deepEqual(counters.byOperation, {}, "a refusal is not a success");
});

test("a pre-signature refusal is counted apart from the other refusals", () => {
  const counters = emptyCounters();
  count(counters, { op: "unknown", status: 401, code: "not-authorised" });
  count(counters, { op: "read", status: 410, code: "task-sealed" });

  assert.equal(counters.notAuthorised, 1);
  assert.equal(counters.refused, 1, "the pre-signature refusal is not counted twice");
});

test("a replay is counted as a replay", () => {
  const counters = emptyCounters();
  count(counters, { op: "commit", status: 200, replayed: true });
  count(counters, { op: "commit", status: 200, replayed: false });

  assert.equal(counters.replays, 1);
  assert.equal(counters.byOperation.commit, 2, "both are successes");
});

test("the accepted bytes are counted", () => {
  const counters = emptyCounters();
  count(counters, { op: "append", status: 200, bytes: 6 });
  count(counters, { op: "append", status: 200, bytes: 10 });
  assert.equal(counters.bytes, 16);
});

test("two sets of counters are independent, because they belong to two instances", () => {
  // This is the property the metrics endpoint's disclaimer rests on: the counters cover one
  // Worker instance, so a second instance's counters are a second set.
  const first = emptyCounters();
  const second = emptyCounters();
  count(first, { op: "status", status: 200 });

  assert.equal(first.requests, 1);
  assert.equal(second.requests, 0);
  assert.deepEqual(second.byOperation, {});
});
