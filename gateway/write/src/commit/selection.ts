/**
 * The selection: the file list a commit names, checked against the session.
 *
 * The contract states the rules in section 8.2, and they are stricter than they look:
 *
 *  - **A selected path that is not staged, or that is tombstoned, is refused.** The gateway does
 *    not silently drop it. A commit that contains fewer files than were asked for is a surprising
 *    commit, and a surprising commit is worse than a refused one: the agent believes it delivered
 *    something it did not deliver.
 *  - **A file whose content was lost to an eviction is not committable.** The agent must re-stage
 *    it. The inventory still lists it, and the inventory is durable, so the gateway can tell the
 *    difference between "never existed" and "existed and is gone".
 *  - **The placeholder is never committable.** It is the operator's file, and it is invisible to
 *    the agent.
 *  - **The selection is a set, not a list.** A repeated path is refused rather than deduplicated,
 *    because a repeated path is a sign that the caller lost track of what it is asking for.
 *
 * The paths are relative to the task folder, and the folder is added by the gateway. The check
 * that the result stays inside the folder is here as well as in the path rules, because "the path
 * is safe" and "the path, resolved, is in the folder" are two different statements and the second
 * is the one that matters at a commit.
 */
import { checkPath } from "../policy/path-safety.ts";
import { checkType, typeFailureCode } from "../policy/type-policy.ts";
import { checkTotalBytes, quotas } from "../policy/quotas.ts";
import { PLACEHOLDER_FILE } from "../config/constants.ts";
import type { FileEntry } from "../types/session.ts";

/** One file of a validated selection. */
export interface SelectedFile {
  /** The path, relative to the task folder. */
  path: string;
  /** The path, relative to the repository root. */
  repositoryPath: string;
  /** The content to commit. */
  content: string;
  /** The SHA-256 of the content, lowercase hex. */
  hash: string;
  /** The byte length of the content. */
  bytes: number;
}

/** The result of validating a selection. */
export type SelectionResult =
  | { ok: true; files: SelectedFile[]; hashes: Record<string, string> }
  | { ok: false; code: string; message: string };

/**
 * Validate the selection against the session.
 *
 * The order of the checks is the order the contract lists them in, and it is cheapest-first
 * within that: a repeated path before a path that does not exist, and a path that does not exist
 * before a policy failure. The client is told the first thing that is wrong with the request, so
 * it fixes one thing at a time.
 */
export function validateSelection(
  requested: readonly string[],
  files: Record<string, FileEntry>,
  contents: Map<string, string>,
  folder: string,
): SelectionResult {
  if (requested.length === 0) {
    return { ok: false, code: "empty-selection", message: "the commit named no files" };
  }

  const seen = new Set<string>();
  for (const path of requested) {
    if (seen.has(path)) {
      return {
        ok: false,
        code: "repeated-parameter",
        message: "the selection named the same path more than once",
      };
    }
    seen.add(path);
  }

  const selected: SelectedFile[] = [];
  const hashes: Record<string, string> = {};
  let totalBytes = 0;

  for (const path of requested) {
    const pathCheck = checkPath(path);
    if (!pathCheck.ok) {
      return {
        ok: false,
        code: "malformed-path",
        message: "a selected path does not satisfy the path rules",
      };
    }
    if (path === PLACEHOLDER_FILE || path.endsWith(`/${PLACEHOLDER_FILE}`)) {
      return {
        ok: false,
        code: "malformed-path",
        message: "the placeholder file is not part of a selection",
      };
    }

    const repositoryPath = resolveInside(folder, path);
    if (repositoryPath === null) {
      return {
        ok: false,
        code: "malformed-path",
        message: "a selected path does not resolve inside the task folder",
      };
    }

    const entry = files[path];
    if (entry === undefined || entry.content !== "present") {
      // A single element that contains a comma is almost always a caller that percent-encoded
      // the separator as well as the paths. The contract splits on the raw comma, so that a
      // file name may contain a comma, and the cost of that rule is that the separator has to be
      // a literal one. Saying so is more useful than "that file is not staged".
      if (requested.length === 1 && path.includes(",")) {
        return {
          ok: false,
          code: "file-not-staged",
          message:
            "the selection looks like one path with a comma in it; the separator between paths " +
            "must be a literal comma, and each path is percent-encoded on its own",
        };
      }
      return {
        ok: false,
        code: "file-not-staged",
        message: "a selected path is not a live staged file; run status to see what is staged",
      };
    }

    const content = contents.get(path);
    if (content === undefined) {
      // The inventory says the content is there and the memory does not have it. The content was
      // lost, and the agent has to stage it again.
      return {
        ok: false,
        code: "file-not-staged",
        message: "a selected file's content is no longer held; stage it again",
      };
    }

    const bytes = new TextEncoder().encode(content);
    const typeCheck = checkType(path, bytes);
    if (!typeCheck.ok) {
      return {
        ok: false,
        code: typeFailureCode(typeCheck.reason),
        message: "a selected file does not satisfy the type policy",
      };
    }

    totalBytes += bytes.length;
    const totalCheck = checkTotalBytes(totalBytes);
    if (!totalCheck.ok) {
      return { ok: false, code: totalCheck.code, message: totalCheck.message };
    }

    selected.push({
      path,
      repositoryPath,
      content,
      hash: entry.hash ?? "",
      bytes: bytes.length,
    });
    hashes[path] = entry.hash ?? "";
  }

  const limits = quotas();
  if (totalBytes > limits.max_total_bytes) {
    return {
      ok: false,
      code: "total-bytes-exceeded",
      message: `the selection is larger than the ${limits.max_total_bytes} byte budget`,
    };
  }

  return { ok: true, files: selected, hashes };
}

/**
 * Resolve a path inside a folder, or null when it would escape.
 *
 * The path rules already refuse `..` as a component and an absolute path, so this should never
 * refuse anything. It is here because the commit is the operation where an escape would do real
 * damage, and "should never" is not a property a security check should rely on.
 */
export function resolveInside(folder: string, path: string): string | null {
  if (folder === "" || path === "") return null;
  const base = folder.split("/");
  const parts = path.split("/");
  const stack = [...base];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  // The result has to be *under* the folder. A length check is not enough: `notes/../../x.md`
  // resolves to a path of the same length as the folder, but one level above it.
  if (stack.length <= base.length) return null;
  for (let i = 0; i < base.length; i++) {
    if (stack[i] !== base[i]) return null;
  }
  return stack.join("/");
}
