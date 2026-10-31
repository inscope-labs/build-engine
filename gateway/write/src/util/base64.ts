/**
 * base64url, without padding (RFC 4648 section 5).
 *
 * The gateway uses base64url in two places: the signature, and the chunk payload in the query
 * string. Both are unpadded, and both must round-trip exactly.
 */

/** Encode bytes as base64url with the padding stripped. */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url string.
 *
 * Returns null rather than throwing, because every caller of this is handling untrusted input and
 * wants to answer "not base64url" rather than to handle an exception.
 */
export function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  // A base64 length of 1 modulo 4 cannot be produced by any input.
  if (value.length % 4 === 1) return null;
  const padded = value.length % 4 === 0 ? value : value + "=".repeat(4 - (value.length % 4));
  try {
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Decode a base64url string into text.
 *
 * The text must be valid UTF-8. A chunk that decodes to invalid UTF-8 is refused by the staging
 * layer, not here; this function returns null for that case so the caller can tell "not base64url"
 * from "not text" apart if it needs to.
 */
export function base64urlDecodeText(value: string): string | null {
  const bytes = base64urlDecode(value);
  if (bytes === null) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}
