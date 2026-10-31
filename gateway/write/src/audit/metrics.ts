/**
 * Counters (protocol section 11).
 *
 * The counters exist so that an operator can see what the gateway is doing without reading the
 * audit stream. They count events; they never carry a path, a query string or a payload.
 *
 * **Stage 5.4.1** adds the durable counters and the metrics endpoint. The in-memory counters
 * here are enough for the contract to hold in Stage 5.2 and are the shape the durable ones will
 * take.
 */

/** The counters the gateway keeps. */
export interface Counters {
  /** The number of requests, by outcome. */
  requests: number;
  /** The number of requests that were refused before the signature was verified. */
  notAuthorised: number;
  /** The number of requests that were refused after a valid capability. */
  refused: number;
  /** The number of successful requests, by operation. */
  byOperation: Record<string, number>;
  /** The number of idempotent replays. */
  replays: number;
}

/** A fresh set of counters. */
export function emptyCounters(): Counters {
  return { requests: 0, notAuthorised: 0, refused: 0, byOperation: {}, replays: 0 };
}

/**
 * Count one request.
 *
 * The counters are per Worker instance and are therefore per isolate. They are a live view, not a
 * total; the audit stream is the record of what happened.
 */
export function count(counters: Counters, outcome: { op: string; status: number; code?: string; replayed?: boolean }): Counters {
  counters.requests += 1;
  if (outcome.code === "not-authorised") counters.notAuthorised += 1;
  else if (outcome.status >= 400) counters.refused += 1;
  else {
    counters.byOperation[outcome.op] = (counters.byOperation[outcome.op] ?? 0) + 1;
    if (outcome.replayed === true) counters.replays += 1;
  }
  return counters;
}
