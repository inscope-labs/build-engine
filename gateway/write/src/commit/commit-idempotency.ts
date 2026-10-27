/**
 * The commit's idempotency (protocol section 6.3, 8.1).
 *
 * The general idempotency machinery is in `src/session/idempotency.ts`. This module is the part
 * that is specific to a commit: the digest of the request's logical payload, which is what makes
 * "the same key with different content" detectable.
 *
 * The digest covers the selection and the content of every selected file. Two commits with the
 * same key and the same digest are the same commit, and the second one replays the first one's
 * outcome. Two commits with the same key and different digests are a conflict.
 *
 * **Stage 5.3** performs the commit; the digest and the store are here in Stage 5.2 because they
 * are session state, and the session has to be able to answer "have I already done this?"
 * before anything is delivered.
 */
import { sha256HexOfText } from "../util/hash.ts";
import { buildQuery } from "../auth/root-url.ts";

/** The logical payload of a commit request. */
export interface CommitPayload {
  /** The selected paths, relative to the task folder, sorted. */
  files: string[];
  /** The content hash of each selected path. */
  hashes: Record<string, string>;
}

/**
 * The digest of a commit payload.
 *
 * The selection is sorted, so that the same set of files in a different order is the same
 * request. The hashes are sorted by path for the same reason.
 */
export async function commitDigest(payload: CommitPayload): Promise<string> {
  const files = [...payload.files].sort();
  const hashPart = files
    .map((path) => `${path}=${payload.hashes[path] ?? ""}`)
    .join("\n");
  const canonical = buildQuery({ files: files.join(","), hashes: hashPart });
  return sha256HexOfText(canonical);
}
