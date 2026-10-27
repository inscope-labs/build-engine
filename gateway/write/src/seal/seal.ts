/**
 * The seal (protocol section 8.4).
 *
 * Seal is the agent's statement that the task's folder is complete. It is **irreversible** for the
 * agent: there is no unseal operation, and every write after a seal is `410 task-sealed`.
 *
 * Seal requires a successful commit to exist. A seal without one is `409 seal-requires-commit`,
 * because a seal that freezes a folder with nothing in it would be a way to end a task without
 * delivering anything (plan task 5.3.7).
 *
 * The three closures are distinct (protocol section 5.2): `sealed` is the agent finishing, while
 * `revoked` and `closed` are the operator's decisions. They are not one flag, and this module
 * only ever produces `sealed`.
 */
import type { CommitRecord, SessionState } from "../types/session.ts";

/** The result of a seal. */
export type SealDecision =
  | { ok: true; state: SessionState; result: Record<string, unknown> }
  | { ok: false; code: string; message: string };

/**
 * Seal the session.
 *
 * The caller has already established that the session is `open`; a session in any of the closed
 * states is refused before it gets here.
 */
export function sealSession(
  committed: CommitRecord | null,
  now: number,
): SealDecision {
  if (committed === null) {
    return {
      ok: false,
      code: "seal-requires-commit",
      message: "the task has no successful commit; commit the files before sealing",
    };
  }
  return {
    ok: true,
    state: "sealed",
    result: {
      sealed: true,
      at: now,
      commit: committed.sha,
      files: committed.paths.length,
    },
  };
}
