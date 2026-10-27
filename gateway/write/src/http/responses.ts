/**
 * The response envelope.
 *
 * Every response, success or failure, is a JSON object with the same top-level shape (protocol
 * section 4.3). The envelope is built field by field from this module, for the same reason the
 * audit record is: a field that is not in the schema has no path into the body, so a capability, a
 * payload or a provider error cannot leak into a response by accident.
 */
import { PROTOCOL } from "../config/constants.ts";
import { baseHeaders } from "./headers.ts";
import { contractUrl, helpUrl } from "./help.ts";
import type { Envelope, Link } from "../types/responses.ts";
import type { Operation } from "../config/constants.ts";
import type { SessionState } from "../types/session.ts";

/** What a response is built from. */
export interface EnvelopeInput {
  /** The operation, or the path as written when the request did not parse. */
  op: Operation | string;
  /** The task, or null when the request did not parse far enough to know it. */
  task: string | null;
  /** The work order, or null for the same reason. */
  order: string | null;
  /** The session state, or null when the request never reached the session. */
  state: SessionState | null;
  /** The operation's result, or null on a failure. */
  result: unknown;
  /** The legal next steps. */
  next: Link[];
  /** The failure, or null on a success. */
  error: { code: string; message: string; retryable: boolean } | null;
  /** The gateway's origin, for the absolute contract and help links. */
  base: string;
}

/** Build the envelope. */
export function envelope(input: EnvelopeInput): Envelope {
  const links: Envelope["links"] = {
    contract: contractUrl(input.base),
    next: input.next,
  };
  if (input.error !== null) links.help = helpUrl(input.base, input.error.code);
  return {
    protocol: PROTOCOL,
    op: input.op,
    task: input.task,
    order: input.order,
    state: input.state,
    result: input.result,
    links,
    error: input.error,
  };
}

/** Build the JSON response for an envelope. */
export function jsonResponse(requestId: string, status: number, body: Envelope): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders(requestId) });
}

/**
 * Build the response for a failure.
 *
 * The failure's own status is used, so a `GatewayError` and the catalogue can never disagree.
 */
export function errorResponse(
  requestId: string,
  status: number,
  input: Omit<EnvelopeInput, "result" | "error" | "next"> & { error: Envelope["error"]; next?: Link[] },
): Response {
  const body = envelope({
    ...input,
    result: null,
    next: input.next ?? [],
    error: input.error,
  });
  return jsonResponse(requestId, status, body);
}
