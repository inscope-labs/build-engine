/**
 * Sequence numbers and chunk hashes (protocol section 6.2).
 *
 * Every content mutation carries `(path, seq, hash)`. The sequence number increases by one per
 * chunk per file, and the hash is the SHA-256 of the decoded chunk.
 *
 * The rules are:
 *
 *  - `seq == last_seq + 1` — accepted;
 *  - `seq <= last_seq` and the pair is in the replay window and the hash matches — a **replay**:
 *    the original outcome is returned and nothing changes;
 *  - `seq <= last_seq` and the hash does not match — `sequence-conflict`;
 *  - `seq <= last_seq` and the pair is not in the window — `sequence-conflict`, because the
 *    gateway cannot prove it is a replay and it fails closed;
 *  - `seq > last_seq + 1` — `sequence-gap`.
 *
 * The gateway does not normalise, reorder or buffer out-of-order chunks. A gap is an error, not
 * a queue.
 */
import { REPLAY_WINDOW } from "../config/constants.ts";
import type { ChunkIdentity } from "../types/session.ts";

/** The result of a sequence check. */
export type SequenceDecision =
  | { ok: true; mode: "accepted" | "replay" }
  | { ok: false; code: "sequence-gap" | "sequence-conflict"; message: string };

/**
 * Decide what to do with a chunk.
 *
 * `lastSeq` is the last accepted sequence number for the file, 0 when the file has no content.
 */
export function decideSequence(
  lastSeq: number,
  window: ChunkIdentity[],
  seq: number,
  hash: string,
): SequenceDecision {
  if (seq > lastSeq + 1) {
    return {
      ok: false,
      code: "sequence-gap",
      message: `the chunk skips a sequence number: the next expected is ${lastSeq + 1}`,
    };
  }
  if (seq > lastSeq) {
    return { ok: true, mode: "accepted" };
  }
  const remembered = window.find((entry) => entry.seq === seq);
  if (remembered !== undefined && remembered.hash === hash) {
    return { ok: true, mode: "replay" };
  }
  return {
    ok: false,
    code: "sequence-conflict",
    message: "this sequence number was already used with different content",
  };
}

/**
 * Add a chunk identity to the replay window.
 *
 * The window is bounded, because the Durable Object's memory is bounded: a file that is appended
 * to a million times must not grow the session's state without limit. A replay of a chunk older
 * than the window can no longer be proven to be a replay, and is refused instead.
 */
export function pushIdentity(window: ChunkIdentity[], identity: ChunkIdentity): ChunkIdentity[] {
  const next = window.filter((entry) => entry.seq !== identity.seq);
  next.push(identity);
  next.sort((a, b) => a.seq - b.seq);
  return next.slice(-REPLAY_WINDOW);
}
