/**
 * Appending a chunk (protocol section 6).
 *
 * A chunk write carries `(path, seq, hash, data)`. The sequence number increases by one per chunk
 * per file, and the hash is the SHA-256 of the **decoded** chunk bytes.
 *
 * The write is idempotent: a repeated `(path, seq, hash)` is a replay and returns the original
 * outcome without changing anything. A different hash at an old sequence number is a conflict.
 */
import { checkType } from "../policy/type-policy.ts";
import { decideSequence, pushIdentity } from "../session/sequence.ts";
import { setFileBytes } from "../session/quota-accounting.ts";
import { scaffold } from "./scaffold.ts";
import { sha256Hex, utf8 } from "../util/hash.ts";
import { base64urlDecode } from "../util/base64.ts";
import { checkTotalBytes, quotas } from "../policy/quotas.ts";
import type { StagingContext, StagingOutcome } from "../types/session.ts";

/** How a chunk write changes the file. */
export type WriteMode = "append" | "replace";

/**
 * Write a chunk.
 *
 * The path and the type have been checked by the caller. This function is about the session's
 * state: whether the file exists, what its sequence number is, and whether the chunk is a replay.
 */
export async function writeChunk(
  ctx: StagingContext,
  path: string,
  seq: number,
  hash: string,
  data: string,
  mode: WriteMode,
): Promise<StagingOutcome> {
  const existing = ctx.files[path];

  if (existing !== undefined && existing.content !== "present") {
    return {
      ok: false,
      code: "file-not-staged",
      message: "the file has no staged content; create it again and send the content from seq 1",
    };
  }

  // A write to an unknown path creates the file. The chunk is then the whole of its content.
  if (existing === undefined) {
    const created = scaffold(ctx, path);
    if (!created.ok) {
      return { ok: false, code: created.code, message: created.message };
    }
  }

  const bytes = base64urlDecode(data);
  if (bytes === null) {
    return { ok: false, code: "invalid-parameter", message: "data is not base64url" };
  }

  const computed = await sha256Hex(bytes);
  if (computed !== hash) {
    return {
      ok: false,
      code: "hash-mismatch",
      message: "the hash is not the SHA-256 of the decoded data",
    };
  }

  const typeCheck = checkType(path, bytes);
  if (!typeCheck.ok) {
    if (typeCheck.reason === "file-too-large") {
      return { ok: false, code: "file-too-large", message: "the file would be too large" };
    }
    return { ok: false, code: typeCheck.reason, message: describeTypeFailure(typeCheck.reason) };
  }

  const entry = ctx.files[path]!;
  const current = ctx.contents.get(path) ?? "";
  const decoded = new TextDecoder().decode(bytes);
  const next = mode === "append" ? current + decoded : decoded;
  const nextBytes = utf8(next);

  // The file's ceiling is the tighter of the type's and the global one.
  const fileCeiling = Math.min(typeCheck.type.max_bytes, quotas().max_file_bytes);
  if (nextBytes.length > fileCeiling) {
    return {
      ok: false,
      code: "file-too-large",
      message: `a file may be at most ${fileCeiling} bytes`,
    };
  }

  const totalCheck = checkTotalBytes(ctx.quota.liveBytes - entry.bytes + nextBytes.length);
  if (!totalCheck.ok) return { ok: false, code: totalCheck.code, message: totalCheck.message };

  const window = ctx.chunks[path] ?? [];
  const decision = decideSequence(entry.lastSeq, window, seq, hash);
  if (!decision.ok) return { ok: false, code: decision.code, message: decision.message };

  if (decision.mode === "replay") {
    // The chunk was already applied. The current state IS the outcome.
    return {
      ok: true,
      result: {
        path,
        seq: entry.lastSeq,
        bytes: entry.bytes,
        hash: entry.hash,
        sha256: entry.hash,
      },
      replayed: true,
    };
  }

  const previousBytes = entry.bytes;
  ctx.contents.set(path, next);
  const wholeHash = await sha256Hex(nextBytes);
  entry.lastSeq = seq;
  entry.bytes = nextBytes.length;
  entry.hash = wholeHash;
  ctx.files[path] = entry;
  ctx.chunks[path] = pushIdentity(window, { seq, hash });
  ctx.quota = setFileBytes(ctx.quota, previousBytes, nextBytes.length, bytes.length);

  return {
    ok: true,
    result: { path, seq, bytes: entry.bytes, hash: wholeHash, sha256: wholeHash },
    replayed: false,
  };
}

/**
 * Append a chunk to a file.
 *
 * The chunk is added to whatever the file already holds. The sequence and replay rules are the
 * same as for a replace; the difference is arithmetic.
 */
export async function appendChunk(
  ctx: StagingContext,
  path: string,
  seq: number,
  hash: string,
  data: string,
): Promise<StagingOutcome> {
  return writeChunk(ctx, path, seq, hash, data, "append");
}

/** A sentence for a type-policy refusal. The path is not echoed: it is client-supplied. */
function describeTypeFailure(reason: string): string {
  switch (reason) {
    case "type-not-allowed":
      return "that file type is not allowed; see the type policy";
    case "type-mismatch":
      return "the type parameter does not match the file's extension";
    case "not-utf8":
      return "the content is not valid UTF-8";
    case "binary":
      return "the content is binary; this is a text protocol";
    case "empty-not-allowed":
      return "that file type may not be empty";
    case "denied-name":
      return "that file name is not allowed";
    case "denied-extension":
      return "that file extension is not allowed";
    default:
      return "the file is not allowed by the type policy";
  }
}
