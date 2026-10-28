/**
 * The rate limit (plan task 5.5.2: the quota module).
 *
 * The limit is per task, and it is a **fixed** window rather than a sliding one: a sliding window
 * needs a timestamp per request, which is unbounded state, and a fixed window needs one counter,
 * which is what a Durable Object's storage is for.
 *
 * Two properties are easy to get wrong and are pinned here:
 *
 *  - a **refused** request must not push the window's reset further out. A flood that keeps the
 *    window alive is a flood that never lets the task work again;
 *  - the window **resets** when it has elapsed, measured from the moment the window opened, not
 *    from the last request in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { countRequest, remaining } from "../../../src/policy/rate-limit.ts";
import { quotas } from "../../../src/policy/quotas.ts";
import type { RateWindow } from "../../../src/types/session.ts";

const LIMITS = quotas().rate_limit;
const NOW = 1_800_000_000;

test("the limit is the one the contract publishes", () => {
  assert.equal(LIMITS.requests, 30);
  assert.equal(LIMITS.window_seconds, 60);
});

test("the first request opens the window and is allowed", () => {
  const decision = countRequest(null, NOW);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.window.startedAt, NOW);
  assert.equal(decision.window.count, 1);
});

test("the window allows exactly the published number of requests", () => {
  let window: RateWindow | null = null;
  for (let i = 0; i < LIMITS.requests; i++) {
    const decision = countRequest(window, NOW);
    assert.equal(decision.ok, true, `request ${i + 1} is allowed`);
    if (!decision.ok) return;
    window = decision.window;
  }
  assert.equal(window?.count, LIMITS.requests);

  const refused = countRequest(window, NOW);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.match(refused.message, /too many requests/);
  assert.ok(refused.retryAfter > 0, "the refusal says when to come back");
});

test("a refused request does not push the window's reset further out", () => {
  let window: RateWindow | null = null;
  for (let i = 0; i < LIMITS.requests; i++) {
    const decision = countRequest(window, NOW);
    if (!decision.ok) return;
    window = decision.window;
  }
  // The window opened at NOW and lasts for the whole period, so the reset is at NOW + 60.
  const at = NOW + LIMITS.window_seconds - 1;
  const refused = countRequest(window, at);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.retryAfter, 1, "the window ends one second later, not when the flood does");
});

test("the window resets when it has elapsed", () => {
  let window: RateWindow | null = null;
  for (let i = 0; i < LIMITS.requests; i++) {
    const decision = countRequest(window, NOW);
    if (!decision.ok) return;
    window = decision.window;
  }
  assert.equal(countRequest(window, NOW).ok, false);

  // One second past the window, the task may work again.
  const later = NOW + LIMITS.window_seconds;
  const decision = countRequest(window, later);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.window.startedAt, later, "the new window starts now");
  assert.equal(decision.window.count, 1);
});

test("the remaining count is what is left of the window", () => {
  assert.equal(remaining(null, NOW), LIMITS.requests);
  assert.equal(remaining({ startedAt: NOW, count: 0 }, NOW), LIMITS.requests);
  assert.equal(remaining({ startedAt: NOW, count: 1 }, NOW), LIMITS.requests - 1);
  assert.equal(remaining({ startedAt: NOW, count: LIMITS.requests }, NOW), 0);
  // An elapsed window is a full window.
  assert.equal(
    remaining({ startedAt: NOW, count: LIMITS.requests }, NOW + LIMITS.window_seconds),
    LIMITS.requests,
  );
});
