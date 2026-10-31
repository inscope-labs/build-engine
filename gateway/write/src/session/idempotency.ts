/**
 * The idempotency store (protocol section 6.3).
 *
 * Idempotency applies at two levels. The chunk level is in `src/session/sequence.ts`. This is the
 * **operation** level: `commit` and `seal` record a key, the outcome, and a digest of the request's
 * logical payload.
 *
 * - The key is the `idem` parameter when the client supplies one; otherwise it is derived
 *   deterministically from the request, so that a plain retry of the same commit is idempotent
 *   without the client having to think about it.
 * - **Same key, same payload** — the recorded outcome is returned again, with `replayed = true`.
 *   This is the "commit succeeded but the response was lost" case.
 * - **Same key, different payload** — `idempotency-conflict`. Never a second commit, never a
 *   silent overwrite.
 *
 * The store is durable. It is the only state that must survive an isolate eviction, because it is
 * the only thing that can prove a commit already happened.
 */
import type { IdempotencyEntry } from "../types/session.ts";

/** The store, keyed by idempotency key. */
export type IdempotencyStore = Record<string, IdempotencyEntry>;

/**
 * The key to use for a request.
 *
 * The derived form is `auto:<sha256>`, where the digest is over the request's logical payload.
 * The explicit form is the client's own key, which is what lets a client retry a commit whose
 * *selection* changed — that retry then fails as an idempotency conflict rather than as a second
 * commit.
 */
export function resolveIdempotencyKey(explicit: string | undefined, payloadDigest: string): string {
  return explicit !== undefined && explicit !== "" ? explicit : `auto:${payloadDigest}`;
}

/** What the store says about a key. */
export type IdempotencyLookup =
  | { kind: "new" }
  | { kind: "replay"; outcome: unknown }
  | { kind: "conflict" };

/**
 * Look up a key.
 *
 * The digest is what makes a replay distinguishable from a divergent retry: the same key with a
 * different digest is a conflict, and the recorded outcome is NOT returned.
 */
export function lookupIdempotency(
  store: IdempotencyStore,
  key: string,
  digest: string,
): IdempotencyLookup {
  const entry = store[key];
  if (entry === undefined) return { kind: "new" };
  if (entry.digest === digest) return { kind: "replay", outcome: entry.outcome };
  return { kind: "conflict" };
}

/** Record an outcome. */
export function recordIdempotency(
  store: IdempotencyStore,
  key: string,
  digest: string,
  outcome: unknown,
  now: number,
): IdempotencyStore {
  return { ...store, [key]: { key, digest, outcome, at: now } };
}
