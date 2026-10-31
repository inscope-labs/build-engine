/**
 * The provider's failures, and the retry policy.
 *
 * Two things live here, and they are kept together because they are one decision: **which
 * provider failures can be retried**, and **what the agent is told when they cannot**.
 *
 * The case that matters most, and the one that is easiest to get wrong, is a request that timed
 * out *after* the provider acted. A blind retry of "create the commit" is how a duplicate commit
 * is created. So:
 *
 *  - the calls that only create objects — a blob, a tree, a commit — are safe to retry, because
 *    they are content-addressed and create nothing that is referenced;
 *  - the call that **moves the branch** is never retried blindly. If it times out, the gateway
 *    goes and *looks* at the branch, and decides from what it finds. That is the difference
 *    between `reconcile-required` and a second commit.
 *
 * The gateway's own codes for a provider's failures are:
 *
 * | The provider said | The agent gets | Retryable |
 * |---|---|---|
 * | 401, 403 | `provider-credential-invalid` | no — the operator must fix the credential |
 * | 404 | `provider-rejected` (or the call site's own code) | no |
 * | 409, 422 | `expected-sha-conflict` | no — the branch moved |
 * | 429 | `provider-rate-limited` | yes |
 * | 5xx, a timeout, a network failure | `provider-unavailable` | yes |
 * | anything else | `provider-rejected` | no |
 */
import { ProviderError } from "./github-client.ts";

/** The retry policy. */
export interface RetryPolicy {
  /** How many attempts in total, including the first. */
  maxAttempts: number;
  /** The delay before the second attempt, in milliseconds. */
  baseDelayMs: number;
  /** The ceiling on the delay, in milliseconds. */
  maxDelayMs: number;
}

/**
 * Whether a failure can be retried unchanged.
 *
 * A 429 and a 5xx can. A 4xx cannot: the request itself is the problem, and repeating it
 * unchanged will fail the same way.
 */
export function isRetryableFailure(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  if (e.kind === "timeout" || e.kind === "network") return true;
  if (e.kind === "status" && e.status !== null) {
    return e.status === 429 || e.status >= 500;
  }
  return false;
}

/**
 * The gateway's code for a provider failure.
 *
 * The call site may override it, because a 404 means different things to different calls: a
 * missing branch is a configuration fault, and a missing task folder is the agent's problem to
 * take to the operator.
 */
export function providerCode(e: unknown, override?: string): string {
  if (override !== undefined) return override;
  if (!(e instanceof ProviderError)) return "provider-unavailable";
  if (e.kind === "timeout" || e.kind === "network") return "provider-unavailable";
  const status = e.status;
  if (status === 401 || status === 403) return "provider-credential-invalid";
  if (status === 409 || status === 422) return "expected-sha-conflict";
  if (status === 429) return "provider-rate-limited";
  if (status !== null && status >= 500) return "provider-unavailable";
  return "provider-rejected";
}

/** The message that goes with a provider code. The message never quotes the provider. */
export function providerMessage(code: string): string {
  switch (code) {
    case "provider-rate-limited":
      return "the provider is rate limiting the gateway; retry after a moment";
    case "provider-unavailable":
      return "the provider did not complete the request; retry after a moment";
    case "provider-credential-invalid":
      return "the gateway's provider credential was refused; this is an operator fault";
    case "provider-rejected":
      return "the provider refused the request";
    case "expected-sha-conflict":
      return "the submissions branch moved since the capability was issued";
    case "task-folder-missing":
      return "the task folder does not exist on the branch; ask the operator to create it";
    case "gateway-misconfigured":
      return "the gateway's destination configuration is not usable; this is an operator fault";
    default:
      return "the provider did not complete the request";
  }
}

/** The default sleep between attempts. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an operation, retrying it while the failure is one that a retry can fix.
 *
 * The sleep is a parameter, so that the tests do not spend real seconds waiting for a backoff
 * that is not what they are testing.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= Math.max(1, policy.maxAttempts); attempt++) {
    try {
      return await operation(attempt);
    } catch (e) {
      last = e;
      if (attempt >= policy.maxAttempts || !isRetryableFailure(e)) throw e;
      const delay = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
      await sleep(delay);
    }
  }
  throw last;
}
