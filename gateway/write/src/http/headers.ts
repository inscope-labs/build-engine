/**
 * The response headers.
 *
 * Every response carries the same set, because a mutating GET is the compatibility transport for
 * a GET-only agent and the caching story has to be enforced at the edge as well as in the
 * application (protocol section 10.1, ADR 0003).
 */
import { HEADER_REQUEST_ID } from "../config/constants.ts";

/**
 * Build the header set for a response.
 *
 * - `Cache-Control: private, no-store, max-age=0, must-revalidate` — a cached context file is a
 *   leaked context file, and a cached *write* is a repeated write.
 * - `CDN-Cache-Control: no-store` — the edge cache is told separately, because it does not always
 *   read `Cache-Control`.
 * - no redirect is ever issued by the gateway, so there is no `Location` header to set.
 * - `Referrer-Policy: no-referrer` — a capability in a path is a capability that a Referer header
 *   would leak to whatever the agent's next request goes to.
 */
export function baseHeaders(requestId: string): Headers {
  return new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    [HEADER_REQUEST_ID]: requestId,
  });
}

/**
 * The headers for a plain-text response.
 *
 * Only the health endpoint and the misconfiguration notice use these, and neither carries
 * anything sensitive.
 */
export function textHeaders(requestId: string): Headers {
  const headers = baseHeaders(requestId);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return headers;
}

/**
 * The headers for a markdown response, which is how the contract documents are served.
 */
export function markdownHeaders(requestId: string): Headers {
  const headers = baseHeaders(requestId);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  return headers;
}
