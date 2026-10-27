/**
 * Soft delete (protocol section 5.3).
 *
 * A delete tombstones a file. The file keeps its place in the inventory — so that a later commit
 * can tell "deleted" from "never existed" — but it stops counting against the live file count and
 * the live byte budget, and its content is dropped.
 *
 * A tombstoned path is resurrected by `create`, which starts the file again at sequence 1.
 */
import { tombstone } from "../session/tombstones.ts";
import { removeFile } from "../session/quota-accounting.ts";
import type { StagingContext, StagingOutcome } from "../types/session.ts";

/** Delete a staged file, softly. */
export function deleteStaged(ctx: StagingContext, path: string): StagingOutcome {
  const entry = ctx.files[path];
  if (entry === undefined) {
    return { ok: false, code: "file-not-found", message: "no such staged file" };
  }
  if (entry.content === "tombstoned") {
    return { ok: false, code: "file-not-found", message: "the file is already deleted" };
  }

  const { entry: tombstoned, releasedBytes } = tombstone(entry);
  ctx.files[path] = tombstoned;
  ctx.contents.delete(path);
  ctx.chunks[path] = [];
  ctx.quota = removeFile(ctx.quota, releasedBytes);

  return {
    ok: true,
    result: { path, deleted: true, released_bytes: releasedBytes },
    replayed: false,
  };
}
