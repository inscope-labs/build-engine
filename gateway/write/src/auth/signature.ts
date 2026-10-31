/**
 * The `ctxwrite-v1` capability: its canonical message and its signature.
 *
 * The contract is `gateway/write/docs/protocol.md` section 3. This is its code.
 *
 * The shape follows the read side's `ctxgate-v1` scheme: a domain-separated HMAC-SHA256 over a
 * LF-separated message, base64url without padding, compared in constant time. The difference is
 * what the message binds. A read link binds a path and a commit; a write capability binds a
 * *scope* — an order, a plan, a task, a writer and the expected branch head — because the payload
 * arrives long after the capability was minted and cannot be covered by the signature.
 */
import { DOMAIN_SEPARATOR } from "../config/constants.ts";
import { base64url } from "../util/base64.ts";

/** The fields of the signed message, in order. */
export const MESSAGE_FIELDS = [
  "scheme",
  "kid",
  "exp",
  "order",
  "plan",
  "task",
  "writer",
  "head",
] as const;

/**
 * The exact bytes that are signed.
 *
 * `exp` is the decimal integer form, byte-identical to the path segment. The message ends with no
 * trailing separator.
 */
export function canonicalMessage(fields: {
  kid: string;
  exp: number;
  order: string;
  plan: string;
  task: string;
  writer: string;
  head: string;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      DOMAIN_SEPARATOR,
      fields.kid,
      String(fields.exp),
      fields.order,
      fields.plan,
      fields.task,
      fields.writer,
      fields.head,
    ].join("\n"),
  );
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

/** `base64url(HMAC-SHA256(secret, message))`, no padding. */
export async function sign(
  secret: string,
  fields: {
    kid: string;
    exp: number;
    order: string;
    plan: string;
    task: string;
    writer: string;
    head: string;
  },
): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    canonicalMessage(fields) as unknown as BufferSource,
  );
  return base64url(new Uint8Array(mac));
}

/**
 * Verify a signature.
 *
 * The comparison happens inside the WebCrypto verifier, which does not leak the position of the
 * first differing byte through its timing.
 */
export async function verifySignature(
  secret: string,
  fields: {
    kid: string;
    exp: number;
    order: string;
    plan: string;
    task: string;
    writer: string;
    head: string;
  },
  signature: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64urlToBytes(signature) as unknown as BufferSource,
    canonicalMessage(fields) as unknown as BufferSource,
  );
}

/** Decode a base64url signature into the 32 raw bytes the verifier wants. */
function base64urlToBytes(value: string): Uint8Array {
  const padded = value.length % 4 === 0 ? value : value + "=".repeat(4 - (value.length % 4));
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * The field rules of protocol section 3.
 *
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

/** `kid`: a selector, not a secret. `^[A-Za-z0-9_]{1,16}$`. */
export function isKid(s: string): boolean {
  return s.length >= 1 && s.length <= 16 && !hasControl(s) && /^[A-Za-z0-9_]+$/.test(s);
}

/** `exp`: unix seconds, decimal, no sign and no leading zeros. */
export function isExp(s: string): boolean {
  if (!/^[0-9]+$/.test(s)) return false;
  if (s.length > 1 && s.startsWith("0")) return false;
  return Number.isSafeInteger(Number(s));
}

/** `order`: `^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`. */
export function isOrder(s: string): boolean {
  return s.length >= 1 && s.length <= 64 && !hasControl(s) && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(s);
}

/** `plan`: `^[a-z0-9][a-z0-9-]{0,63}$`. */
export function isPlan(s: string): boolean {
  return s.length >= 1 && s.length <= 64 && !hasControl(s) && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

/** `task`: the plan tooling's task id pattern. */
export function isTask(s: string): boolean {
  return s.length >= 1 && s.length <= 64 && !hasControl(s) && /^[0-9]{5}-[1-9][0-9]*-[0-9]{3}-[0-9]{2}$/.test(s);
}

/** `writer`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. An identity, not a secret. */
export function isWriter(s: string): boolean {
  return s.length >= 1 && s.length <= 64 && !hasControl(s) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s);
}

/** `head`: exactly forty lowercase hex characters. */
export function isHead(s: string): boolean {
  return s.length === 40 && !hasControl(s) && /^[0-9a-f]+$/.test(s);
}

/** `sig`: base64url, unpadded, 43 characters. */
export function isSignature(s: string): boolean {
  return s.length === 43 && !hasControl(s) && /^[A-Za-z0-9_-]+$/.test(s);
}
