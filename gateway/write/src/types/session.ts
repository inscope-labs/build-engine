/**
 * The session state types.
 *
 * The session is one Durable Object instance per task. It holds the control plane: the writer
 * lease, the session state, the file inventory, the quota ledger, the idempotency store and the
 * commit record. The file *contents* are not here, because they are ephemeral (ADR 0001).
 */

/**
 * The session state.
 *
 * `sealed`, `revoked` and `closed` are three different closures with three different operational
 * meanings, so they are three states and not one flag (protocol section 5.2). The agent can only
 * cause `sealed`; `revoked` and `closed` are operator actions.
 */
export type SessionState = "open" | "sealed" | "revoked" | "closed";

/** The states in which the task's write path is closed. */
export const CLOSED_STATES: ReadonlySet<SessionState> = new Set<SessionState>([
  "sealed",
  "revoked",
  "closed",
]);

/** How much of a file is present. */
export type ContentState = "present" | "missing" | "tombstoned";

/** One file in the inventory. */
export interface FileEntry {
  /** The path, relative to the task folder. */
  path: string;
  /** The last accepted content sequence number. 0 means the file has no content yet. */
  lastSeq: number;
  /** The byte length of the content, or 0 when the content is gone. */
  bytes: number;
  /** The lowercase hex SHA-256 of the whole file, or null when the file has no content. */
  hash: string | null;
  /** Whether the content is still in memory. */
  content: ContentState;
}

/** One remembered chunk identity, for replay detection. */
export interface ChunkIdentity {
  seq: number;
  hash: string;
}

/** The quota ledger. */
export interface QuotaState {
  /** The number of live files: files that exist and are not tombstoned. */
  liveFiles: number;
  /** The sum of the current byte length of every live file. */
  liveBytes: number;
  /** Every byte ever accepted into staging. Never decreases. */
  bytesAcceptedTotal: number;
  /** The bytes that were accepted and then lost to an isolate eviction. */
  bytesLost: number;
}

/** The writer lease. One writer per task, for a bounded time. */
export interface WriterLease {
  /** The writer that holds the lease. */
  writer: string;
  /** When the lease was claimed, in unix seconds. */
  claimedAt: number;
  /** When the lease expires, in unix seconds. */
  expiresAt: number;
}

/** A recorded successful commit. */
export interface CommitRecord {
  /** The commit sha. */
  sha: string;
  /** The selected paths, relative to the task folder. */
  paths: string[];
  /** The content hash of each selected path. */
  hashes: Record<string, string>;
  /** The writer that caused the commit. */
  actor: string;
  /** The task the commit belongs to. */
  task: string;
  /** The work order the commit belongs to. */
  order: string;
  /** When the commit happened, in unix seconds. */
  at: number;
}

/**
 * A commit that was started and whose outcome was not recorded.
 *
 * The entry is written **before** the branch is moved and removed once the commit is recorded. If
 * it is still there, the last attempt did not finish, and the next attempt has to resolve it
 * rather than start again: the commit object may exist, and the branch may or may not point at
 * it.
 *
 * It is keyed by the expected head and the payload's digest, so that it describes one specific
 * commit attempt and not "a commit for this task".
 */
export interface CommitInflight {
  /** The digest of the commit's logical payload. */
  digest: string;
  /** The head the commit's parent is. */
  expectedHead: string;
  /** The commit sha, once the commit object exists. Null before that. */
  sha: string | null;
  /** The commit's timestamp, in unix seconds. Fixed, so that a repeated attempt is the same commit. */
  startedAt: number;
  /** The selected paths, relative to the task folder. */
  paths: string[];
  /** The content hash of each selected path. */
  hashes: Record<string, string>;
}

/** A recorded seal. */
export interface SealRecord {
  /** When the seal happened, in unix seconds. */
  at: number;
  /** The commit that was sealed. */
  commit: string;
  /** The number of files in the sealed commit. */
  files: number;
}

/** A recorded idempotent outcome. */
export interface IdempotencyEntry {
  /** The key. */
  key: string;
  /** A digest of the logical payload, so a reused key with a different payload is detected. */
  digest: string;
  /** The recorded outcome, returned again on a replay. */
  outcome: unknown;
  /** When the outcome was recorded, in unix seconds. */
  at: number;
}

/** The rate-limit window. */
export interface RateWindow {
  /** The start of the current window, in unix seconds. */
  startedAt: number;
  /** The number of requests in the current window. */
  count: number;
}

/** One file as `status` reports it. The field names are the wire names. */
export interface FileView {
  path: string;
  last_seq: number;
  bytes: number;
  hash: string | null;
  content: ContentState;
  tombstoned: boolean;
}

/** A snapshot of the session, as `status` reports it. */
export interface SessionSnapshot {
  state: SessionState;
  writer: string | null;
  leaseExpiresAt: number | null;
  files: FileView[];
  quota: QuotaState;
  committed: CommitRecord | null;
}

/**
 * The staging context: everything the staging operations read and change.
 *
 * The `contents` map is the **ephemeral** part. It lives in the Durable Object's memory and is
 * never written to storage, to disk, or to any third-party object store (ADR 0002). The
 * `files`, `chunks` and `quota` parts are the durable control plane.
 */
export interface StagingContext {
  /** The inventory, keyed by path. */
  files: Record<string, FileEntry>;
  /** The replay window of each file, keyed by path. */
  chunks: Record<string, ChunkIdentity[]>;
  /** The staged content, keyed by path. In memory only. */
  contents: Map<string, string>;
  /** The quota ledger. */
  quota: QuotaState;
}

/** The result of a staging operation. */
export type StagingOutcome =
  | { ok: true; result: Record<string, unknown>; replayed: boolean }
  | { ok: false; code: string; message: string };
