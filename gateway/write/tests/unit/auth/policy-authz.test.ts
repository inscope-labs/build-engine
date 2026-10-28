/**
 * The authorisation policy (plan task 5.5.2: the auth modules).
 *
 * Two decisions live in `src/auth/policy-authz.ts`, and they are the two halves of the contract's
 * verification order:
 *
 *  - the **capability level**, which the Worker decides before the Durable Object is touched: is
 *    the capability expired, and is its lifetime within the gateway's maximum?
 *  - the **session level**, which the Durable Object decides once it knows the state: may this
 *    operation proceed on a task that is revoked, closed or sealed?
 *
 * The boundaries here are exact and the exactness is the point: a capability is served at `exp`
 * and refused at `exp + 1`, and the three closures are three different codes because the
 * operator's response to each of them is different.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  authorizeCapability,
  authorizeSession,
  isDestinationParameter,
  isMutating,
  DESTINATION_PARAMETERS,
} from "../../../src/auth/policy-authz.ts";
import type { Capability } from "../../../src/types/requests.ts";

const NOW = 1_800_000_000;

/** A capability with the fields the policy reads. */
function capability(exp: number): Capability {
  return {
    kid: "k1",
    exp,
    order: "10008-S001",
    plan: "castiel-dev",
    task: "10008-1-001-01",
    writer: "agent-7",
    head: "a".repeat(40),
    sig: "A".repeat(43),
  };
}

test("a capability is served at its expiry and refused one second later", () => {
  assert.equal(authorizeCapability(capability(NOW), NOW, 3600), null, "served at exp");
  assert.equal(authorizeCapability(capability(NOW), NOW - 1, 3600), null, "served before exp");
  const expired = authorizeCapability(capability(NOW), NOW + 1, 3600);
  assert.ok(expired !== null);
  assert.equal(expired.code, "capability-expired");
  assert.equal(expired.status, 403);
  assert.equal(expired.retryable, false);
});

test("a capability whose lifetime is longer than the gateway allows is refused", () => {
  const long = authorizeCapability(capability(NOW + 3601), NOW, 3600);
  assert.ok(long !== null);
  assert.equal(long.code, "ttl-exceeded");
  assert.equal(long.status, 403);

  // The boundary: exactly the maximum is allowed, and one second more is not.
  assert.equal(authorizeCapability(capability(NOW + 3600), NOW, 3600), null);
});

test("an expired capability is reported as expired, and not as a ttl problem", () => {
  // A capability that is both expired and too long-lived is expired: the order of the checks is
  // the contract's, and the agent is told the first thing that is wrong with it.
  const both = authorizeCapability(capability(NOW - 10), NOW, 1);
  assert.ok(both !== null);
  assert.equal(both.code, "capability-expired");
});

test("the three closures are three different codes", () => {
  const revoked = authorizeSession("revoked", "create");
  assert.ok(revoked !== null);
  assert.equal(revoked.code, "task-revoked");
  assert.equal(revoked.status, 410);

  const closed = authorizeSession("closed", "create");
  assert.ok(closed !== null);
  assert.equal(closed.code, "order-closed");
  assert.equal(closed.status, 410);

  const sealed = authorizeSession("sealed", "create");
  assert.ok(sealed !== null);
  assert.equal(sealed.code, "task-sealed");
  assert.equal(sealed.status, 410);
});

test("a sealed task still answers the index, so the agent can learn why it stopped", () => {
  assert.equal(authorizeSession("sealed", "index"), null);
  // And a repeated seal is not an error: the agent that lost the seal's response has to be able
  // to find out that the seal happened.
  assert.equal(authorizeSession("sealed", "seal"), null);
});

test("an open task allows every operation", () => {
  for (const operation of ["index", "status", "create", "append", "replace", "read", "delete", "commit", "seal"] as const) {
    assert.equal(authorizeSession("open", operation), null, `${operation} is allowed on an open task`);
  }
});

test("the mutating operations are exactly the ones that change something", () => {
  for (const operation of ["create", "append", "replace", "delete", "commit", "seal"] as const) {
    assert.equal(isMutating(operation), true, `${operation} mutates`);
  }
  for (const operation of ["index", "status", "read"] as const) {
    assert.equal(isMutating(operation), false, `${operation} does not mutate`);
  }
});

test("the destination cannot be chosen by a request", () => {
  for (const name of ["repo", "repository", "branch", "ref", "folder", "dir", "directory"]) {
    assert.equal(isDestinationParameter(name), true, `${name} tries to choose the destination`);
    assert.equal(isDestinationParameter(name.toUpperCase()), true, "the check is case-insensitive");
  }
  // The parameters the contract defines are not destination parameters.
  for (const name of ["path", "files", "seq", "hash", "data", "idem", "type"]) {
    assert.equal(isDestinationParameter(name), false, `${name} is a contract parameter`);
  }
  assert.ok(DESTINATION_PARAMETERS.size >= 7, "the set is not empty");
});
