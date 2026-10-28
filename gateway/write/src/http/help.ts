/**
 * The corrective-help links.
 *
 * A failure returns a help link, not an opaque code. The link points at the error catalogue's
 * anchor for the code, so that the agent (or the operator) can read what the code means and what
 * to do about it (protocol section 4.3).
 */
import { ROUTE_CONTRACT, ROUTE_ERRORS } from "../config/constants.ts";

/** The origin of the gateway, without a trailing slash. */
export function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

/** The absolute URL of the canonical contract. */
export function contractUrl(base: string): string {
  return `${base}${ROUTE_CONTRACT}`;
}

/** The absolute URL of the error catalogue. */
export function errorsUrl(base: string): string {
  return `${base}${ROUTE_ERRORS}`;
}

/**
 * The absolute URL of the catalogue entry for one code.
 *
 * The code is a known identifier, not user input, so it is placed in the fragment as-is. A code
 * that is not in the catalogue still produces a link; it simply lands on the top of the document.
 */
export function helpUrl(base: string, code: string): string {
  return `${errorsUrl(base)}#${encodeURIComponent(code)}`;
}
