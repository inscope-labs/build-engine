/**
 * The clock.
 *
 * A conformant implementation needs a controllable notion of "now", because the exact comparison
 * against `exp` is part of the contract (protocol section 14.4). The reference pattern is the read
 * gateway's: an environment variable holding a fixed timestamp, re-read on every request.
 *
 * A production deployment MUST NOT set the test clock, because the override would let a caller
 * extend the life of an expired capability.
 */

/** The environment variable that pins the clock, in unix seconds. */
export const TEST_CLOCK_ENV = "CTXGATE_TEST_CLOCK";

/** The current time, in unix seconds. */
export function now(env: { CTXGATE_TEST_CLOCK?: string }): number {
  const pinned = env[TEST_CLOCK_ENV];
  if (pinned !== undefined && pinned !== "") {
    const seconds = Number(pinned);
    if (Number.isInteger(seconds) && seconds >= 0) return seconds;
  }
  return Math.floor(Date.now() / 1000);
}

/** Whether the test clock is engaged. The health endpoint reports this. */
export function testClockEngaged(env: { CTXGATE_TEST_CLOCK?: string }): boolean {
  const pinned = env[TEST_CLOCK_ENV];
  if (pinned === undefined || pinned === "") return false;
  const seconds = Number(pinned);
  return Number.isInteger(seconds) && seconds >= 0;
}
