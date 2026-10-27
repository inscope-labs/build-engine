/**
 * The writer lease (protocol section 2.5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { claimLease, leaseActive } from "../../../src/session/writer-claim.ts";

const LEASE = 300;

test("the first writer takes the lease", () => {
  const decision = claimLease(null, "agent-7", 1000, LEASE);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.lease.writer, "agent-7");
  assert.equal(decision.lease.claimedAt, 1000);
  assert.equal(decision.lease.expiresAt, 1300);
  assert.equal(decision.renewed, false);
});

test("the same writer continues and renews the lease", () => {
  const first = claimLease(null, "agent-7", 1000, LEASE);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = claimLease(first.lease, "agent-7", 1100, LEASE);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.renewed, true);
  assert.equal(second.lease.expiresAt, 1400);
  // The claim time is the first one: the session did not start again.
  assert.equal(second.lease.claimedAt, 1000);
});

test("a different writer is refused while the lease is active", () => {
  const first = claimLease(null, "agent-7", 1000, LEASE);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const other = claimLease(first.lease, "agent-8", 1100, LEASE);
  assert.equal(other.ok, false);
  if (other.ok) return;
  assert.equal(other.code, "writer-conflict");
});

test("an expired lease may be taken by another writer, so that a crash does not deadlock a task", () => {
  const first = claimLease(null, "agent-7", 1000, LEASE);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const other = claimLease(first.lease, "agent-8", 1300, LEASE);
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.equal(other.lease.writer, "agent-8");
});

test("the lease is active up to its expiry and not at it", () => {
  const decision = claimLease(null, "agent-7", 1000, LEASE);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(leaseActive(decision.lease, 1299), true);
  assert.equal(leaseActive(decision.lease, 1300), false);
  assert.equal(leaseActive(null, 1000), false);
});
