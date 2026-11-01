/**
 * The seal (plan task 5.5.2: the seal module).
 *
 * The seal is the agent's statement that the task's folder is complete, and it is **irreversible**
 * for the agent: there is no unseal operation, and every write after a seal is `410 task-sealed`.
 *
 * The precondition is the interesting part. A seal **requires a successful commit to exist**,
 * because a seal that freezes a folder with nothing in it would be a way to end a task without
 * delivering anything (plan task 5.3.7). The check belongs to this module, and the module only
 * ever produces the `sealed` state — `revoked` and `closed` are the operator's decisions and are
 * made elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { sealSession } from "../../../src/seal/seal.ts";
import type { CommitRecord } from "../../../src/types/session.ts";

/** A commit record. */
function commit(paths = ["intro.md", "notes.md"]): CommitRecord {
  return {
    sha: "c".repeat(40),
    paths,
    hashes: {},
    actor: "agent-7",
    task: "10008-1-001-01",
    order: "10008-S001",
    at: 1_800_000_000,
  };
}

test("a seal without a commit is refused", () => {
  const decision = sealSession(null, 1_800_000_000);
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.code, "seal-requires-commit");
  assert.equal(decision.ok === false && decision.code === "seal-requires-commit", true);
});

test("a seal with a commit freezes the folder and reports what it froze", () => {
  const decision = sealSession(commit(), 1_800_000_500);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.state, "sealed");
  assert.equal(decision.result.sealed, true);
  assert.equal(decision.result.at, 1_800_000_500);
  assert.equal(decision.result.commit, "c".repeat(40));
  assert.equal(decision.result.files, 2, "the number of files in the commit");
});

test("the module only ever produces the sealed state", () => {
  // `revoked` and `closed` are the operator's decisions. The seal must not be able to produce
  // them, or an agent could seal a task into a state only the operator may create.
  const decision = sealSession(commit(), 1_800_000_000);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.state, "sealed");
});

test("a commit with no files still counts as a commit", () => {
  // The precondition is that a commit *exists*. Whether the selection was empty is the
  // selection's business, and the gateway refuses an empty selection before it gets here.
  const decision = sealSession(commit([]), 1_800_000_000);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.result.files, 0);
});
