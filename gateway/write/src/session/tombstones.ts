/**
 * Tombstones (protocol section 5.3, 6).
 *
 * A soft delete marks a file as deleted. The file keeps its place in the inventory — so that a
 * later commit cannot confuse "deleted" with "never existed" — but it stops counting against the
 * live file count and the live byte budget, and its content is dropped.
 *
 * A tombstoned path is resurrected by `create`, which starts the file again at sequence 1. That
 * is the "soft delete is reversible only by re-scaffold" rule.
 */
import type { FileEntry } from "../types/session.ts";

/** Whether the entry is a live file: it exists and it is not deleted. */
export function isLive(entry: FileEntry): boolean {
  return entry.content !== "tombstoned";
}

/**
 * Mark a file as deleted.
 *
 * The bytes are returned so that the caller can release them from the quota ledger; the content
 * is dropped, because a deleted file's content is not deliverable and keeping it would keep the
 * bytes alive for no reason.
 */
export function tombstone(entry: FileEntry): { entry: FileEntry; releasedBytes: number } {
  const releasedBytes = isLive(entry) ? entry.bytes : 0;
  return {
    entry: { ...entry, content: "tombstoned", bytes: 0, hash: null, lastSeq: 0 },
    releasedBytes,
  };
}

/**
 * The live files, in a stable order.
 *
 * The order is by path, so that two calls with the same state produce the same list, which keeps
 * the audit record and the status response comparable between requests.
 */
export function liveFiles(files: Record<string, FileEntry>): FileEntry[] {
  return Object.values(files)
    .filter(isLive)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every file, tombstoned or not, in a stable order. */
export function allFiles(files: Record<string, FileEntry>): FileEntry[] {
  return Object.values(files).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
