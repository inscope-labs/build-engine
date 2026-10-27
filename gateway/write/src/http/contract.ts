/**
 * The contract documents, served by the gateway.
 *
 * The contract is the write-side counterpart of the read side's `conformance/SCHEME.md`, and it
 * is served from the gateway itself so that an agent can read it without being told where it
 * lives (protocol section 4.5).
 *
 * The documents are imported as text by the bundler's `Text` rule. The build-time module
 * declaration is in `src/types/assets.d.ts`.
 */
import protocolDocument from "../../docs/protocol.md";
import errorsDocument from "../../docs/error-catalog.md";
import quotasDocument from "../../docs/quotas-and-type-policy.md";
import { ROUTE_CONTRACT, ROUTE_ERRORS, ROUTE_QUOTAS } from "../config/constants.ts";

/** The document for a contract route, or null when the route is not a contract route. */
export function contractDocument(pathname: string): string | null {
  if (pathname === ROUTE_CONTRACT) return protocolDocument;
  if (pathname === ROUTE_ERRORS) return errorsDocument;
  if (pathname === ROUTE_QUOTAS) return quotasDocument;
  return null;
}

/** Whether the path is one of the contract routes. */
export function isContractRoute(pathname: string): boolean {
  return contractDocument(pathname) !== null;
}
