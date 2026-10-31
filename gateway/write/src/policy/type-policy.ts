/**
 * The type policy (protocol section 7.2).
 *
 * The policy is an allow-list: a file's type is derived from its extension, and an extension that
 * appears in no entry is refused. The authority is `src/config/type-policy.json`; the published
 * view is `gateway/write/docs/quotas-and-type-policy.md`.
 *
 * The rules:
 *  - **text only** — the content must be valid UTF-8, and a NUL byte is refused as binary;
 *  - **UTF-8** — the content is decoded with a fatal decoder, so invalid sequences are refused
 *    rather than replaced;
 *  - **per-type ceilings may only lower the global one** — the global cap is in `quotas.json` and
 *    is enforced regardless of the policy.
 */
import typePolicy from "../config/type-policy.json" with { type: "json" };
import { extensionOf } from "./path-safety.ts";
import { quotas } from "./quotas.ts";

/** One entry of the policy. */
export interface TypeEntry {
  id: string;
  media_type: string;
  extensions: string[];
  max_bytes: number;
  allow_empty: boolean;
  schema: string | null;
}

const TYPES = typePolicy.types as TypeEntry[];
const DENIED_NAMES = new Set(typePolicy.denied_names as string[]);
const DENIED_EXTENSIONS = new Set(typePolicy.denied_extensions as string[]);
const BY_EXTENSION = new Map<string, TypeEntry>();
for (const entry of TYPES) {
  for (const ext of entry.extensions) BY_EXTENSION.set(ext, entry);
}

/** The types the policy allows. */
export function allowedTypes(): readonly TypeEntry[] {
  return TYPES;
}

/** The media type a path's extension maps to, or null when the extension is not allowed. */
export function typeForPath(path: string): TypeEntry | null {
  const ext = extensionOf(path);
  if (ext === null) return null;
  return BY_EXTENSION.get(ext) ?? null;
}

/** Why a file was refused by the type policy. */
export type TypeFailure =
  | "type-not-allowed"
  | "type-mismatch"
  | "denied-name"
  | "denied-extension"
  | "not-utf8"
  | "binary"
  | "empty-not-allowed"
  | "file-too-large";

/** The result of checking a file against the policy. */
export type TypeCheck =
  | { ok: true; type: TypeEntry }
  | { ok: false; reason: TypeFailure; allowed?: string[] };

/**
 * Check a path and its content against the policy.
 *
 * The extension is checked first, because a file whose type is not allowed should be refused
 * before its content is decoded.
 */
export function checkType(path: string, content: Uint8Array, explicitType?: string): TypeCheck {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (DENIED_NAMES.has(name)) return { ok: false, reason: "denied-name" };

  const ext = extensionOf(path);
  if (ext !== null && DENIED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "denied-extension" };
  }

  const entry = typeForPath(path);
  if (entry === null) {
    return { ok: false, reason: "type-not-allowed", allowed: allowedExtensions() };
  }

  if (explicitType !== undefined && explicitType !== "" && explicitType !== entry.media_type) {
    return { ok: false, reason: "type-mismatch" };
  }

  // The content must be text. A NUL byte is the giveaway that it is not.
  for (const byte of content) {
    if (byte === 0) return { ok: false, reason: "binary" };
  }
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(content);
  } catch {
    return { ok: false, reason: "not-utf8" };
  }

  if (content.length === 0 && !entry.allow_empty) {
    return { ok: false, reason: "empty-not-allowed" };
  }
  if (content.length > entry.max_bytes || content.length > quotas().max_file_bytes) {
    return { ok: false, reason: "file-too-large" };
  }
  return { ok: true, type: entry };
}

/**
 * Every extension the policy allows, sorted.
 *
 * The refusal for a disallowed type names these, because an agent that cannot write `.md` needs
 * to know that `.markdown` is the alternative.
 */
export function allowedExtensions(): string[] {
  return [...BY_EXTENSION.keys()].sort();
}

/**
 * Check only the name and the extension of a path.
 *
 * `create` uses this: a scaffolded file has no content yet, so the content rules — UTF-8, the
 * empty-file rule, the size ceiling — do not apply to it. They apply to the content, when it
 * arrives.
 */
export function checkTypeAllowed(path: string): { ok: true; type: TypeEntry } | { ok: false; reason: TypeFailure } {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (DENIED_NAMES.has(name)) return { ok: false, reason: "denied-name" };

  const ext = extensionOf(path);
  if (ext !== null && DENIED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "denied-extension" };
  }

  const entry = typeForPath(path);
  if (entry === null) return { ok: false, reason: "type-not-allowed" };
  return { ok: true, type: entry };
}
