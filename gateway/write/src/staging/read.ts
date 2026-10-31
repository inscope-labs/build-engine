/**
 * Reading back staged content (protocol section 4.1, 5.3).
 *
 * The agent reads back only what it staged. There is no route that reads anything else, and the
 * content comes from memory, not from the repository.
 */
import { sha256Hex, utf8 } from "../util/hash.ts";
import { base64url } from "../util/base64.ts";
import type { StagingContext, StagingOutcome } from "../types/session.ts";

/**
 * Read a staged file.
 *
 * Two different failures, and the client needs to be able to tell them apart:
 *
 *  - the path was never staged — `404 file-not-found`;
 *  - the path was staged but its content was lost to an isolate eviction — `409 file-not-staged`,
 *    because the fix is to re-create the file and send the content again, not to give up.
 */
export async function readStaged(ctx: StagingContext, path: string): Promise<StagingOutcome> {
  const entry = ctx.files[path];
  if (entry === undefined) {
    return { ok: false, code: "file-not-found", message: "no such staged file" };
  }
  if (entry.content !== "present") {
    return {
      ok: false,
      code: "file-not-staged",
      message: "the staged content was lost; create the file again and send the content from seq 1",
    };
  }

  const content = ctx.contents.get(path) ?? "";
  const bytes = utf8(content);
  const digest = await sha256Hex(bytes);
  return {
    ok: true,
    result: {
      path,
      seq: entry.lastSeq,
      bytes: entry.bytes,
      hash: digest,
      sha256: digest,
      /** The content, base64url, so that the envelope stays JSON and the bytes stay exact. */
      data: base64url(bytes),
    },
    replayed: false,
  };
}
