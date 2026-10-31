/**
 * The ctxgate-v1 signed context-link scheme, ported to TypeScript.
 *
 * This is a faithful port of `template/engine/tools/ctxlink.py`, which is the normative
 * reference. The two MUST agree byte for byte; `test/unit/scheme.test.ts` proves that this
 * port reproduces every vector in `conformance/signing-vectors.json`, and the conformance
 * harness proves that a gateway running this code accepts links minted by the Python client.
 *
 * The specification is `conformance/SCHEME.md`. Read that first; this file is its code.
 */

export const SCHEME = "ctxgate-v1";

/** The message is these six fields, joined by one LF, UTF-8, with no trailing separator. */
export const MESSAGE_FIELDS = ["scheme", "kid", "exp", "order", "ref", "path"] as const;

const KID_RE = /^[A-Za-z0-9_]+$/;
const ORDER_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const REF_RE = /^[0-9a-f]+$/;
const HEX_RE = /^[0-9A-Fa-f]{2}$/;

/**
 * JavaScript's `$` matches before a trailing line terminator, so a regex alone would accept
 * "k1\n". Every field is therefore also checked for control characters, and for its length.
 */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function isKid(s: string): boolean {
  return s.length >= 1 && s.length <= 16 && !hasControl(s) && KID_RE.test(s);
}

export function isOrder(s: string): boolean {
  return s.length >= 1 && s.length <= 64 && !hasControl(s) && ORDER_RE.test(s);
}

export function isRef(s: string): boolean {
  return s.length === 40 && !hasControl(s) && REF_RE.test(s);
}

/**
 * A path is safe when it is already canonical. Nothing is normalised: a path is either
 * accepted exactly as written or refused (conformance/SCHEME.md section 5).
 */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  if (hasControl(path)) return false;
  for (const part of path.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

/** The exact bytes that are signed. */
export function canonicalMessage(kid: string, exp: number, order: string, ref: string, path: string): Uint8Array {
  return new TextEncoder().encode([SCHEME, kid, String(exp), order, ref, path].join("\n"));
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("not base64url");
  if (s.length % 4 === 1) throw new Error("not base64url");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** base64url(HMAC-SHA256(secret, message)), no padding. */
export async function sign(
  secret: string,
  kid: string,
  exp: number,
  order: string,
  ref: string,
  path: string,
): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, canonicalMessage(kid, exp, order, ref, path) as unknown as BufferSource);
  return base64url(new Uint8Array(mac));
}

/**
 * Verify a signature. The comparison happens inside the WebCrypto verifier, which does not
 * leak the position of the first differing byte through its timing.
 */
export async function verifySignature(
  secret: string,
  kid: string,
  exp: number,
  order: string,
  ref: string,
  path: string,
  signature: string,
): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = base64urlDecode(signature);
  } catch {
    return false;
  }
  if (sig.length !== 32) return false;
  const key = await hmacKey(secret);
  return crypto.subtle.verify("HMAC", key, sig as unknown as BufferSource, canonicalMessage(kid, exp, order, ref, path) as unknown as BufferSource);
}

/** Percent-encode one path segment: only the RFC 3986 unreserved set stays literal. */
export function encodeSegment(segment: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(segment)) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Percent-encode a whole path, segment by segment. '/' is the separator and is never encoded. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
}

/**
 * Percent-decode one path segment and decode it as UTF-8.
 *
 * Two rules matter here and are easy to get wrong:
 *  - this is percent-decoding, NOT form-decoding: '+' is a literal plus, not a space;
 *  - the decode happens per segment, so a %2F inside a segment can never become a separator.
 * Invalid UTF-8 becomes U+FFFD, which is what the Python reference does.
 */
export function decodeSegment(segment: string): string {
  const out: number[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) {
      for (const b of new TextEncoder().encode(plain)) out.push(b);
      plain = "";
    }
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (c === "%" && i + 2 < segment.length && HEX_RE.test(segment[i + 1]! + segment[i + 2]!)) {
      flush();
      out.push(parseInt(segment.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      plain += c;
    }
  }
  flush();
  return new TextDecoder().decode(new Uint8Array(out));
}

/**
 * Mint a link: validate the inputs and sign.
 *
 * This is the counterpart of `ctxlink.mint` in the Python client, which validates before it
 * signs. `sign()` above deliberately does NOT validate, exactly as the Python `sign()` does not;
 * the validation lives here, so that a signer refuses the same inputs the gateway would.
 */
export async function mint(
  secret: string,
  kid: string,
  exp: number,
  order: string,
  ref: string,
  path: string,
): Promise<{ signature: string; urlPath: string }> {
  if (!isKid(kid)) throw new Error("bad kid");
  if (!isOrder(order)) throw new Error("bad order");
  if (!isRef(ref)) throw new Error("bad ref");
  if (!isSafePath(path)) throw new Error("unsafe path");
  const signature = await sign(secret, kid, exp, order, ref, path);
  return { signature, urlPath: `/v1/${kid}/${exp}/${order}/${signature}/${ref}/${encodePath(path)}` };
}

/** The parsed form of a link. */
export interface ParsedLink {
  kid: string;
  exp: number;
  order: string;
  sig: string;
  ref: string;
  path: string;
}

/** Why a link could not be parsed. Each reason maps to an audit reason. */
export type ParseFailure =
  | "malformed"
  | "encoded-separator";

/**
 * Parse and validate a request path into a link. The order of the checks matters and is
 * fixed by conformance/SCHEME.md section 7.
 */
export function parseLink(rawPath: string): { ok: true; link: ParsedLink } | { ok: false; reason: ParseFailure } {
  if (/%(2f|5c|00)/i.test(rawPath)) return { ok: false, reason: "encoded-separator" };
  const parts = rawPath.split("/");
  // ['', 'v1', kid, exp, order, sig, ref, path...]
  if (parts.length < 8 || parts[0] !== "" || parts[1] !== "v1") return { ok: false, reason: "malformed" };
  const kid = parts[2]!;
  const expStr = parts[3]!;
  const order = parts[4]!;
  const sig = parts[5]!;
  const ref = parts[6]!;
  const path = parts.slice(7).map(decodeSegment).join("/");
  if (!/^[0-9]+$/.test(expStr)) return { ok: false, reason: "malformed" };
  if (!isKid(kid) || !isOrder(order) || !isRef(ref) || !isSafePath(path)) return { ok: false, reason: "malformed" };
  return { ok: true, link: { kid, exp: Number(expStr), order, sig, ref, path } };
}
