/**
 * Counters (protocol section 11).
 *
 * The counters exist so that an operator can see what the gateway is doing without reading the
 * audit stream. They count events; they never carry a path, a query string or a payload.
 *
 * **Stage 5.4.1** completes them. The counters are per Worker instance, and therefore per
 * isolate: they are a live view of one instance, not a total. The metrics endpoint says so in
 * its own body, because a number that looks like a total and is not is worse than no number.
 * The durable totals live in the audit stream, which is per order and queryable.
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
  /** The number of refusals, by error code. */
  byCode: Record<string, number>;
  /** The number of idempotent replays. */
  replays: number;
  /** The number of bytes the gateway accepted into staging. */
  bytes: number;
  /** The number of times the durable audit write failed. */
  auditWriteFailures: number;
}

/** A fresh set of counters. */
export function emptyCounters(): Counters {
  return {
    requests: 0,
    notAuthorised: 0,
    refused: 0,
    byOperation: {},
    byCode: {},
    replays: 0,
    bytes: 0,
    auditWriteFailures: 0,
  };
}

/**
 * Count one request.
 *
 * The counters are per Worker instance and are therefore per isolate. They are a live view, not a
 * total; the audit stream is the record of what happened.
 */
export function count(
  counters: Counters,
  outcome: { op: string; status: number; code?: string; replayed?: boolean; bytes?: number },
): Counters {
  counters.requests += 1;
  if (outcome.bytes !== undefined) counters.bytes += outcome.bytes;
  if (outcome.code !== undefined) {
    counters.byCode[outcome.code] = (counters.byCode[outcome.code] ?? 0) + 1;
  }
  if (outcome.code === "not-authorised") counters.notAuthorised += 1;
  else if (outcome.status >= 400) counters.refused += 1;
  else {
    counters.byOperation[outcome.op] = (counters.byOperation[outcome.op] ?? 0) + 1;
    if (outcome.replayed === true) counters.replays += 1;
  }
  return counters;
}
