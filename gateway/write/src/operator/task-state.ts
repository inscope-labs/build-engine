/**
 * The task-state fact (operator channel, `GET /admin/task-state`).
 *
 * Gateway A owns a task's *state*; this gateway owns the *seal* (ADR 0011 item 1, and
 * `docs/release/TASK-STATE-TRANSITION-CONTRACT.md`). Before Gateway A records `done` it needs one
 * fact from here: has this task, under this work order, been sealed after a successful commit?
 * This module answers that and nothing else.
 *
 * What it is, and is not:
 *
 *  - It is **read-only**. Describing a session never creates, changes or persists one.
 *  - It is a **fact, not a decision**. Whether a transition is allowed is Gateway A's rule. This
 *    gateway only says what it holds.
 *  - It is bound to **both** the task and the work order. A seal that belongs to a different
 *    order is not an attestation for this one.
 *  - It carries **no capability, no signature, no writer id and no content**. It carries the
 *    sealed commit's **file paths relative to the task folder** and their **SHA-256 content
 *    hashes**, and only when that commit belongs to the task and the work order asked about
 *    (ADR 0015, open point 1): the transfer has to verify what the gateway sealed, and the
 *    gateway's own record is what it verifies against. The audit rules (ADR 0004) apply to
 *    this response as they do to the audit record.
 */
import type { CommitRecord, SealRecord, SessionState } from "../types/session.ts";

/** The state as reported: a session state, or `unknown` when this gateway has no record of the task. */
export type ReportedState = SessionState | "unknown";

/** The fact the operator channel returns. */
export interface TaskStateFact {
  ok: true;
  /** The task, as the operator asked about it. */
  task: string;
  /** The work order, as the operator asked about it. */
  order: string;
  /** Whether this gateway holds a session for the task at all. */
  known: boolean;
  /** The session state, or `unknown`. */
  state: ReportedState;
  /** Whether a successful commit is recorded. */
  committed: boolean;
  /** Whether the session is sealed. */
  sealed: boolean;
  /**
   * The recorded commit, reduced to what the operator needs. `null` when there is none.
   *
   * `hashes` is the per-file SHA-256 map the gateway recorded when it committed, keyed by the
   * path relative to the task folder. It is present only when the commit belongs to **this**
   * task and **this** work order: a commit recorded against another task brings no paths here.
   */
  commit: {
    sha: string;
    files: number;
    at: number;
    task_match: boolean;
    order_match: boolean;
    hashes: Record<string, string>;
  } | null;
  /** The recorded seal. `null` when the task is not sealed. */
  seal: { at: number; commit: string; files: number } | null;
  /**
   * The one field Gateway A acts on.
   *
   * True only when the session is `sealed`, a seal record and a commit record both exist, the seal
   * is over that commit, and the commit belongs to the task and the work order asked about.
   */
  seal_attested: boolean;
}

/** The part of a stored session this module reads. */
export interface SessionView {
  state: SessionState;
  commit: CommitRecord | null;
  seal: SealRecord | null;
}

/**
 * Describe a task's state.
 *
 * `stored` is `undefined` when the gateway has never held a session for the task.
 */
export function describeTaskState(
  stored: SessionView | undefined,
  task: string,
  order: string,
): TaskStateFact {
  if (stored === undefined) {
    return {
      ok: true,
      task,
      order,
      known: false,
      state: "unknown",
      committed: false,
      sealed: false,
      commit: null,
      seal: null,
      seal_attested: false,
    };
  }

  const commit = stored.commit ?? null;
  const seal = stored.seal ?? null;
  const taskMatch = commit !== null && commit.task === task;
  const orderMatch = commit !== null && commit.order === order;

  const attested =
    stored.state === "sealed" &&
    commit !== null &&
    seal !== null &&
    seal.commit === commit.sha &&
    taskMatch &&
    orderMatch;

  return {
    ok: true,
    task,
    order,
    known: true,
    state: stored.state,
    committed: commit !== null,
    sealed: stored.state === "sealed",
    commit:
      commit === null
        ? null
        : {
            sha: commit.sha,
            files: commit.paths.length,
            at: commit.at,
            task_match: taskMatch,
            order_match: orderMatch,
            // Another task's paths are not this task's business, so they are not reported.
            hashes: taskMatch && orderMatch ? { ...commit.hashes } : {},
          },
    seal: seal === null ? null : { at: seal.at, commit: seal.commit, files: seal.files },
    seal_attested: attested,
  };
}
