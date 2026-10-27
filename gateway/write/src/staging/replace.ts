/**
 * Replacing a file's content (protocol section 5.3, 6).
 *
 * A replace is a chunk write with `mode = "replace"`: the chunk *is* the whole file. It carries
 * the same `(path, seq, hash, data)` as an append, and the same sequence and replay rules apply,
 * so a replace is as safe to retry as an append.
 *
 * The difference is arithmetic: a replace sets the file's size rather than growing it, and it
 * accepts only the chunk's bytes.
 */
import { writeChunk } from "./append.ts";
import type { StagingContext, StagingOutcome } from "../types/session.ts";

/** Replace a file's content with one chunk. */
export async function replaceContent(
  ctx: StagingContext,
  path: string,
  seq: number,
  hash: string,
  data: string,
): Promise<StagingOutcome> {
  return writeChunk(ctx, path, seq, hash, data, "replace");
}
