/**
 * Path safety (protocol section 5.1).
 *
 * A path names exactly one file, **relative to the task folder**. The scheme performs no
 * normalisation: a path is either already canonical and is accepted exactly as written, or it is
 * refused. There is no case folding, no Unicode normalisation, no collapsing of separators, no
 * `.` removal and no resolution of `..`.
 *
 * Two consequences worth stating explicitly, because implementations get them wrong:
 *
 *  - **A component may contain `..` as a substring.** `notes/na~me.v1..2.md` is a legal file name
 *    and a legal path. Only a component that is *exactly* `..` is refused. A check written as
 *    `*..*` both rejects legal names and can be bypassed by encodings.
 *  - **Unicode is not normalised.** `café/naïve.md` in NFC and the same text in NFD are two
 *    different paths. The signer and the file system must agree on the exact bytes.
 */
import { MAX_PATH_DEPTH, MAX_PATH_LENGTH } from "../config/constants.ts";

/** Why a path was refused. The reason is safe to report; the path itself is not. */
export type PathFailure =
  | "empty"
  | "absolute"
  | "backslash"
  | "control-character"
  | "empty-component"
  | "dot-component"
  | "dotdot-component"
  | "hidden-component"
  | "reserved-name"
  | "trailing-dot-or-space"
  | "too-long"
  | "too-deep";

/** The result of checking a path. */
export type PathCheck = { ok: true } | { ok: false; reason: PathFailure };

/** The Windows device names, which are reserved on some filesystems and refused everywhere. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Whether a string contains a control character. */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Check a path against the rules of protocol section 5.1.
 *
 * The checks are ordered cheapest-first, and the first failure is returned, so that the reason
 * reported is the one the client most likely needs to fix.
 */
export function checkPath(path: string): PathCheck {
  if (path === "") return { ok: false, reason: "empty" };
  if (path.startsWith("/")) return { ok: false, reason: "absolute" };
  if (path.includes("\\")) return { ok: false, reason: "backslash" };
  if (hasControl(path)) return { ok: false, reason: "control-character" };
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: "too-long" };

  const parts = path.split("/");
  if (parts.length > MAX_PATH_DEPTH) return { ok: false, reason: "too-deep" };

  for (const part of parts) {
    if (part === "") return { ok: false, reason: "empty-component" };
    if (part === ".") return { ok: false, reason: "dot-component" };
    if (part === "..") return { ok: false, reason: "dotdot-component" };
    if (part.startsWith(".")) return { ok: false, reason: "hidden-component" };
    if (RESERVED_NAMES.has(part.toLowerCase())) return { ok: false, reason: "reserved-name" };
    if (part.endsWith(".") || part.endsWith(" ")) {
      return { ok: false, reason: "trailing-dot-or-space" };
    }
  }
  return { ok: true };
}

/** Whether the path is acceptable. */
export function isSafePath(path: string): boolean {
  return checkPath(path).ok;
}

/**
 * The extension of a path, lowercased, or null when it has none.
 *
 * The extension is the last component's, and only when the name has one: `notes.v2/readme` has
 * no extension, because the extension belongs to the file's name, not to its directory.
 */
export function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot).toLowerCase();
}

/**
 * The file name of a path, without its directory.
 *
 * The name is used for the type policy and for the commit message, and it is the one part of a
 * path that is safe to show an operator.
 */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
