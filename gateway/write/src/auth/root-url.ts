/**
 * Parsing the request: the capability in the path, and the parameters in the query string.
 *
 * The contract is `gateway/write/docs/protocol.md` sections 2, 4.1 and 4.2.
 *
 * Two decoding rules are easy to get wrong and are stated here because they are load-bearing:
 *
 *  - **`+` is a literal plus, not a space.** The query string is decoded as a URI component, not
 *    as `application/x-www-form-urlencoded`. `URLSearchParams` would turn every `+` into a space
 *    and silently corrupt every path that contains one.
 *  - **The capability path is never decoded.** Its segments are identifiers with strict rules
 *    (`kid`, `exp`, `order`, `plan`, `task`, `writer`, `head`, `sig`), none of which can contain a
 *    percent sign or a slash. A percent-encoded character in the capability path is therefore
 *    simply an invalid field, not something to decode and re-check.
 */
import { PATH_PREFIX } from "../config/constants.ts";
import { isExp, isHead, isKid, isOrder, isPlan, isSignature, isTask, isWriter } from "./signature.ts";
import type { Capability } from "../types/requests.ts";

/** The result of parsing the capability out of a request path. */
export type CapabilityParse =
  | { ok: true; capability: Capability; operation: string | null }
  | { ok: false; reason: "malformed" | "encoded-separator" };

/**
 * Parse a request path into a capability and the raw operation segment.
 *
 * The operation is returned as a string and is NOT checked against the list of known operations:
 * the contract's verification order puts "the operation is known" after the session checks
 * (section 14.3), so the decision belongs to the session, not to the parser.
 */
export function parseCapabilityPath(rawPath: string): CapabilityParse {
  if (/%(2f|5c|00)/i.test(rawPath)) return { ok: false, reason: "encoded-separator" };

  const parts = rawPath.split("/");
  // ['', 'w1', kid, exp, order, plan, task, writer, head, sig, op?]
  if (parts.length < 10 || parts.length > 11) return { ok: false, reason: "malformed" };
  if (parts[0] !== "" || parts[1] !== PATH_PREFIX) return { ok: false, reason: "malformed" };

  const kid = parts[2]!;
  const exp = parts[3]!;
  const order = parts[4]!;
  const plan = parts[5]!;
  const task = parts[6]!;
  const writer = parts[7]!;
  const head = parts[8]!;
  const sig = parts[9]!;

  if (
    !isKid(kid) ||
    !isExp(exp) ||
    !isOrder(order) ||
    !isPlan(plan) ||
    !isTask(task) ||
    !isWriter(writer) ||
    !isHead(head) ||
    !isSignature(sig)
  ) {
    return { ok: false, reason: "malformed" };
  }

  const operation = parts.length === 11 ? parts[10]! : null;
  if (operation !== null && (operation === "" || operation.includes("/"))) {
    return { ok: false, reason: "malformed" };
  }

  return {
    ok: true,
    capability: { kid, exp: Number(exp), order, plan, task, writer, head, sig },
    operation,
  };
}

/** One query parameter, as it appeared on the wire and as it decodes. */
export interface QueryEntry {
  /** The raw value, still percent-encoded. */
  raw: string;
  /** The decoded value. */
  value: string;
}

/** The parsed query string: a parameter may appear at most once. */
export interface ParsedQuery {
  /** The values, in the order they appeared. */
  entries: Map<string, QueryEntry[]>;
  /** A parameter that appeared more than once. */
  repeated: string | null;
}

/**
 * Parse a query string into its parameters.
 *
 * The decoding is percent-decoding of a URI component. `+` is left alone. A parameter that
 * appears twice is recorded rather than rejected here: the contract refuses a repeated parameter
 * (400 `repeated-parameter`), and the session decides that, because the refusal has to come after
 * the operation check.
 *
 * The **raw** value is kept as well as the decoded one, because the `files` parameter is
 * comma-separated and the split has to happen on the raw value, before decoding (protocol
 * section 4.2.7). Otherwise a `%2C` inside a file name would be indistinguishable from the
 * separator.
 */
export function parseQuery(rawQuery: string): ParsedQuery {
  const entries = new Map<string, QueryEntry[]>();
  let repeated: string | null = null;
  if (rawQuery === "") return { entries, repeated };

  for (const pair of rawQuery.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const name = decodeComponent(rawName);
    const value = decodeComponent(rawValue);
    const existing = entries.get(name);
    if (existing === undefined) entries.set(name, [{ raw: rawValue, value }]);
    else if (repeated === null) repeated = name;
  }
  return { entries, repeated };
}

/**
 * Percent-decode one query component.
 *
 * The bytes are collected first and decoded as UTF-8 afterwards, so a multi-byte character that
 * is percent-encoded byte by byte survives. Invalid UTF-8 becomes U+FFFD, which is what the read
 * scheme's reference implementation does.
 */
export function decodeComponent(value: string): string {
  const bytes: number[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) {
      for (const b of new TextEncoder().encode(plain)) bytes.push(b);
      plain = "";
    }
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "%" && i + 2 < value.length && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      flush();
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      plain += c;
    }
  }
  flush();
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Percent-encode one query component, for the links the gateway hands out.
 *
 * Only the RFC 3986 unreserved set stays literal. `+` is encoded as `%2B` so that it survives a
 * round trip through a decoder that is being kind about `+`.
 */
export function encodeComponent(value: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(value)) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * Build a query string from parameters, in a stable order.
 *
 * The order is fixed so that the same logical request always produces the same query string,
 * which is what makes the derived idempotency key deterministic (protocol section 6.3).
 */
export function buildQuery(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    parts.push(`${encodeComponent(key)}=${encodeComponent(value)}`);
  }
  return parts.join("&");
}
