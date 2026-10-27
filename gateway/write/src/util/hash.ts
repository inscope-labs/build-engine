/**
 * SHA-256, in lowercase hex.
 *
 * The gateway hashes two things: the decoded chunk bytes, to check them against the `hash`
 * parameter, and the whole file, to record in the inventory. Both are SHA-256.
 */

/** The lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return hex(new Uint8Array(digest));
}

/** The lowercase hex SHA-256 of a string's UTF-8 bytes. */
export async function sha256HexOfText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/** The lowercase hex of a byte array. */
export function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** The UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Compare two hex digests in constant time.
 *
 * A digest is not a secret, but the comparison is cheap to make constant-time and the habit is
 * worth keeping: a timing-dependent comparison is the kind of thing that gets copied into a
 * place where it does matter.
 */
export function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
