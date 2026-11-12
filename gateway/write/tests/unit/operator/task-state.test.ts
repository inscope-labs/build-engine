/**
 * The task-state fact (operator channel).
 *
 * The fact is what Gateway A reads before it records `done`. The rule under test: the fact is
 * *attested* only when the session is sealed, the seal is over the recorded commit, and the commit
 * belongs to the task and the work order that were asked about. Everything else is not attested,
 * and the fact says why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeTaskState, type SessionView } from "../../../src/operator/task-state.ts";
import type { CommitRecord, SealRecord } from "../../../src/types/session.ts";

const TASK = "10008-1-001-01";
const ORDER = "10008-S001";

function commit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    sha: "b".repeat(40),
    paths: ["intro.md", "notes.md"],
    hashes: { "intro.md": "1".repeat(64) },
    actor: "agent-7",
    task: TASK,
    order: ORDER,
    at: 1_800_000_000,
    ...overrides,
  };
}

function seal(overrides: Partial<SealRecord> = {}): SealRecord {
  return { at: 1_800_000_100, commit: "b".repeat(40), files: 2, ...overrides };
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return { state: "sealed", commit: commit(), seal: seal(), ...overrides };
}

test("a task this gateway has never seen is unknown and not attested", () => {
  const fact = describeTaskState(undefined, TASK, ORDER);
  assert.equal(fact.known, false);
  assert.equal(fact.state, "unknown");
  assert.equal(fact.seal_attested, false);
  assert.equal(fact.commit, null);
  assert.equal(fact.seal, null);
});

test("a sealed task whose seal is over its commit, for this task and order, is attested", () => {
  const fact = describeTaskState(session(), TASK, ORDER);
  assert.equal(fact.known, true);
  assert.equal(fact.state, "sealed");
  assert.equal(fact.sealed, true);
  assert.equal(fact.committed, true);
  assert.equal(fact.seal_attested, true);
  assert.deepEqual(fact.commit, {
    sha: "b".repeat(40),
    files: 2,
    at: 1_800_000_000,
    task_match: true,
    order_match: true,
    hashes: { "intro.md": "1".repeat(64) },
  });
  assert.deepEqual(fact.seal, { at: 1_800_000_100, commit: "b".repeat(40), files: 2 });
});

test("an open task with a commit is not attested", () => {
  const fact = describeTaskState(session({ state: "open", seal: null }), TASK, ORDER);
  assert.equal(fact.state, "open");
  assert.equal(fact.committed, true);
  assert.equal(fact.sealed, false);
  assert.equal(fact.seal_attested, false);
});

test("an open task with no commit is not attested", () => {
  const fact = describeTaskState(session({ state: "open", commit: null, seal: null }), TASK, ORDER);
  assert.equal(fact.committed, false);
  assert.equal(fact.commit, null);
  assert.equal(fact.seal_attested, false);
});

for (const state of ["revoked", "closed"] as const) {
  test(`a ${state} task is not attested, even if it holds a commit and a seal record`, () => {
    const fact = describeTaskState(session({ state }), TASK, ORDER);
    assert.equal(fact.state, state);
    assert.equal(fact.sealed, false);
    assert.equal(fact.seal_attested, false);
  });
}

test("a seal over a different commit than the recorded one is not attested", () => {
  const fact = describeTaskState(session({ seal: seal({ commit: "c".repeat(40) }) }), TASK, ORDER);
  assert.equal(fact.seal_attested, false);
});

test("a sealed state with no seal record is not attested", () => {
  const fact = describeTaskState(session({ seal: null }), TASK, ORDER);
  assert.equal(fact.sealed, true);
  assert.equal(fact.seal_attested, false);
});

test("a sealed state with no commit record is not attested", () => {
  const fact = describeTaskState(session({ commit: null }), TASK, ORDER);
  assert.equal(fact.seal_attested, false);
});

test("a commit recorded for another work order is not an attestation for this one", () => {
  const fact = describeTaskState(session({ commit: commit({ order: "10008-S002" }) }), TASK, ORDER);
  assert.equal(fact.seal_attested, false);
  assert.equal(fact.commit?.order_match, false);
  assert.equal(fact.commit?.task_match, true);
});

test("a commit recorded for another task is not an attestation for this one", () => {
  const fact = describeTaskState(session({ commit: commit({ task: "10008-1-001-02" }) }), TASK, ORDER);
  assert.equal(fact.seal_attested, false);
  assert.equal(fact.commit?.task_match, false);
});

test("the fact carries no capability, no writer and no content", () => {
  const text = JSON.stringify(describeTaskState(session(), TASK, ORDER));
  for (const forbidden of ["agent-7", "actor", "sig", "capability", "content"]) {
    assert.equal(text.includes(forbidden), false, `the fact must not contain ${forbidden}`);
  }
});

test("the fact carries this task's paths and hashes, and no content", () => {
  // ADR 0015, open point 1: the transfer verifies what the gateway sealed against the
  // gateway's own record, so the record is readable - and it is about this task only.
  const text = JSON.stringify(describeTaskState(session(), TASK, ORDER));
  assert.equal(text.includes("intro.md"), true);
  assert.equal(text.includes("1".repeat(64)), true);
});

test("describing a session does not change it", () => {
  const stored = session();
  const before = JSON.stringify(stored);
  describeTaskState(stored, TASK, ORDER);
  assert.equal(JSON.stringify(stored), before);
});

test("the fact has exactly the fields the shared transition vectors use", async () => {
  const { readFileSync } = await import("node:fs");
  const file = new URL("../../../../../conformance/cases/task-state-transition.json", import.meta.url);
  const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: { request: { seal_fact: unknown } }[] }).cases;
  const facts = cases.map((c) => c.request.seal_fact).filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null);
  assert.ok(facts.length > 0);
  const real = Object.keys(describeTaskState(session(), TASK, ORDER)).sort();
  for (const fact of facts) assert.deepEqual(Object.keys(fact).sort(), real);
  // and the commit and seal sub-objects
  const commitKeys = Object.keys(describeTaskState(session(), TASK, ORDER).commit ?? {}).sort();
  const sealKeys = Object.keys(describeTaskState(session(), TASK, ORDER).seal ?? {}).sort();
  for (const fact of facts) {
    if (fact.commit !== null) assert.deepEqual(Object.keys(fact.commit as object).sort(), commitKeys);
    if (fact.seal !== null) assert.deepEqual(Object.keys(fact.seal as object).sort(), sealKeys);
  }
});

/**
 * The per-file hash map (ADR 0015, open point 1). The transfer verifies what the gateway
 * sealed against the gateway's own record, so the record has to be readable — and it has to
 * stay about *this* task.
 */

test("the commit carries the per-file hashes the gateway recorded, keyed by path", () => {
  const fact = describeTaskState(session(), TASK, ORDER);
  assert.deepEqual(fact.commit?.hashes, { "intro.md": "1".repeat(64) });
});

test("a commit recorded against another task brings no paths or hashes", () => {
  const fact = describeTaskState(session({ commit: commit({ task: "other-task" }) }), TASK, ORDER);
  assert.equal(fact.commit?.task_match, false);
  assert.deepEqual(fact.commit?.hashes, {});
  assert.equal(fact.seal_attested, false);
});

test("a commit recorded against another work order brings no paths or hashes", () => {
  const fact = describeTaskState(session({ commit: commit({ order: "other-order" }) }), TASK, ORDER);
  assert.equal(fact.commit?.order_match, false);
  assert.deepEqual(fact.commit?.hashes, {});
  assert.equal(fact.seal_attested, false);
});
