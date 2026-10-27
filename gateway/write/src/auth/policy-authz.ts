/**
 * The authorisation policy.
 *
 * Two levels of decision live here, and the contract's verification order (section 14.3) is what
 * keeps them apart:
 *
 *  - the **capability level**, which the Worker decides before the Durable Object is touched: is
 *    this capability expired, and is its lifetime within the gateway's maximum?
 *  - the **session level**, which the Durable Object decides once it has the session state: is this
 *    task revoked, closed or sealed, and may this operation proceed?
 *
 * The signature is checked before either of them, so a forged capability cannot tell "expired"
 * from "revoked" from "not allowed" (section 9).
 */
import { fail, GatewayError } from "../http/errors.ts";
import { MUTATING_OPERATIONS, type Operation } from "../config/constants.ts";
import type { Capability } from "../types/requests.ts";
import type { SessionState } from "../types/session.ts";

/**
 * The capability-level checks: expiry and the maximum lifetime.
 *
 * The expiry boundary is inclusive: a capability is served at exactly `exp` and refused at
 * `exp + 1` (section 3.4).
 */
export function authorizeCapability(
  capability: Capability,
  now: number,
  maxTtlSeconds: number,
): GatewayError | null {
  if (now > capability.exp) {
    return fail("capability-expired", "the capability has expired");
  }
  if (capability.exp - now > maxTtlSeconds) {
    return fail("ttl-exceeded", "the capability's lifetime is longer than the gateway allows");
  }
  return null;
}

/**
 * The session-level checks.
 *
 * The three closed states are distinct, because the operator's response to each is different
 * (section 5.2):
 *
 *  - `revoked` — the operator tore the task down. It was hostile, or it was a mistake.
 *  - `closed`  — the work order is over.
 *  - `sealed`  — the agent declared the folder complete, and the deliverable is delivered.
 *
 * In the `sealed` state the index still answers, so that the agent can learn *why* it stopped.
 */
export function authorizeSession(state: SessionState, operation: Operation): GatewayError | null {
  if (state === "revoked") return fail("task-revoked", "the task was revoked by the operator");
  if (state === "closed") return fail("order-closed", "the work order was closed by the operator");
  // A repeated seal is not an error: the contract says a seal returns the recorded outcome, and
  // the agent that lost a seal's response has to be able to find out that the seal happened
  // (protocol section 8.4). Every other operation on a sealed task is refused.
  if (state === "sealed" && operation !== "index" && operation !== "seal") {
    return fail("task-sealed", "the task is sealed; its folder is frozen");
  }
  return null;
}

/**
 * Whether the operation changes staged content.
 *
 * A sealed task refuses every mutation, and so does a task that is revoked or closed. The index
 * is the only operation that survives a seal.
 */
export function isMutating(operation: Operation): boolean {
  return MUTATING_OPERATIONS.has(operation);
}

/**
 * The parameter names that would try to choose the destination.
 *
 * The destination is derived from the signed capability and the configured folder template
 * (section 2.4). A request that names a repository, a branch or a folder is refused with a
 * specific code rather than a generic "unknown parameter", because an agent that tried it needs
 * to be told that it is not allowed to, not that it spelled something wrong.
 */
export const DESTINATION_PARAMETERS: ReadonlySet<string> = new Set([
  "repo",
  "repository",
  "branch",
  "ref",
  "folder",
  "dir",
  "directory",
  "path_prefix",
  "submissions_repo",
  "submissions_branch",
  "task_folder",
]);

/** Whether the parameter name is one that tries to choose the destination. */
export function isDestinationParameter(name: string): boolean {
  return DESTINATION_PARAMETERS.has(name.toLowerCase());
}
