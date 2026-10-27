/**
 * Scaffolding a file (protocol section 5.3).
 *
 * `create` is the operation that makes a file exist. It is also the recovery path: a file whose
 * content was lost to an isolate eviction is resurrected by `create`, which starts it again at
 * sequence 1.
 *
 * The three cases, which the contract distinguishes on purpose:
 *
 *  - the path is unknown — the file is created, empty;
 *  - the path exists and its content is **present** — `409 path-exists`. The gateway does not
 *    silently discard work that is already there;
 *  - the path exists but its content is **missing**, or it is tombstoned — the file is reset, and
 *    the response says so.
 */
import { addFile, removeFile } from "../session/quota-accounting.ts";
import type { FileEntry, StagingContext, StagingOutcome } from "../types/session.ts";

/**
 * Create or resurrect a file.
 *
 * The path and the type have already been checked by the caller: this function is about the
 * session's state, not about the request.
 */
export function scaffold(ctx: StagingContext, path: string): StagingOutcome {
  const existing = ctx.files[path];

  if (existing === undefined) {
    const entry: FileEntry = { path, lastSeq: 0, bytes: 0, hash: null, content: "present" };
    ctx.files[path] = entry;
    ctx.contents.set(path, "");
    ctx.quota = addFile(ctx.quota);
    return { ok: true, result: { path, created: true, resurrected: false }, replayed: false };
  }

  if (existing.content === "present") {
    return {
      ok: false,
      code: "path-exists",
      message: "the file already has content; use replace to change it, or delete it first",
    };
  }

  // The content was lost to an eviction, or the file was tombstoned. Either way it starts again.
  const wasTombstoned = existing.content === "tombstoned";
  const entry: FileEntry = { path, lastSeq: 0, bytes: 0, hash: null, content: "present" };
  ctx.files[path] = entry;
  ctx.contents.set(path, "");
  if (wasTombstoned) {
    // A tombstone released the slot, so the slot has to be taken again.
    ctx.quota = addFile(ctx.quota);
  }
  return { ok: true, result: { path, created: false, resurrected: true }, replayed: false };
}

/**
 * Release a file's slot and bytes. Used by the delete operation.
 *
 * Kept here so that the two operations that change a file's liveness agree on what releasing
 * means.
 */
export function releaseFile(ctx: StagingContext, path: string): number {
  const entry = ctx.files[path];
  if (entry === undefined) return 0;
  const released = entry.content === "tombstoned" ? 0 : entry.bytes;
  ctx.quota = removeFile(ctx.quota, released);
  return released;
}
