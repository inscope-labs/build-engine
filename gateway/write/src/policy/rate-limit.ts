/**
 * The rate limit (protocol section 7.1).
 *
 * The limit is per task, not per IP: the gateway's job here is to bound the work one task can
 * make it do, and a task is the unit that the quota ledger, the writer lease and the seal are all
 * keyed on.
 *
 * The window is a fixed window, not a sliding one. A sliding window needs a timestamp per
 * request, which means unbounded state; a fixed window needs one counter, which is what a
 * Durable Object's storage is for.
 */
import { quotas } from "./quotas.ts";
import type { RateWindow } from "../types/session.ts";

/** The result of a rate check. */
export type RateDecision =
  | { ok: true; window: RateWindow }
  | { ok: false; retryAfter: number; message: string };

/**
 * Count a request against the window and return the window to store.
 *
 * The window resets when it has elapsed. The counter is incremented only if the request is
 * allowed, so that a refused request does not push the window's reset further out.
 */
export function countRequest(window: RateWindow | null, now: number): RateDecision {
  const limits = quotas().rate_limit;
  const current: RateWindow =
    window === null || now - window.startedAt >= limits.window_seconds
      ? { startedAt: now, count: 0 }
      : window;

  if (current.count >= limits.requests) {
    const retryAfter = Math.max(1, limits.window_seconds - (now - current.startedAt));
    return {
      ok: false,
      retryAfter,
      message: `too many requests: at most ${limits.requests} per ${limits.window_seconds} seconds`,
    };
  }
  return { ok: true, window: { startedAt: current.startedAt, count: current.count + 1 } };
}

/** The number of requests left in the current window. */
export function remaining(window: RateWindow | null, now: number): number {
  const limits = quotas().rate_limit;
  if (window === null || now - window.startedAt >= limits.window_seconds) return limits.requests;
  return Math.max(0, limits.requests - window.count);
}
