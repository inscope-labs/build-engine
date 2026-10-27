/**
 * The error type the gateway throws and returns.
 *
 * A failure carries a code, and the code decides the status, the retryability and the help link.
 * The message is a short, fixed sentence: it must not contain the request URL, the query string,
 * the capability, the payload, file content, or any provider detail (protocol section 10.3).
 */
import { errorSpec } from "./status-codes.ts";
import type { ErrorBody } from "../types/responses.ts";

/** A failure the gateway knows how to answer. */
export class GatewayError extends Error {
  /** The machine-readable code. This is the authoritative outcome. */
  readonly code: string;
  /** The HTTP status the code carries. */
  readonly status: number;
  /** Whether retrying the same request unchanged can succeed. */
  readonly retryable: boolean;
  /** Optional structured detail, for the cases where the client needs a fact, not a sentence. */
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    const spec = errorSpec(code);
    this.status = spec.status;
    this.retryable = spec.retryable;
    this.detail = detail;
  }

  /** The error body as it appears in the envelope. */
  toBody(): ErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

/**
 * Build a failure.
 *
 * The message is written here, at the call site, so that it can be specific about what the client
 * should do — but it must stay free of anything sensitive.
 */
export function fail(code: string, message: string, detail?: Record<string, unknown>): GatewayError {
  return new GatewayError(code, message, detail);
}

/** Whether a value is a GatewayError. */
export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}

/**
 * The single body for every pre-signature failure.
 *
 * A caller who cannot authenticate learns nothing about why: not whether the key id is unknown,
 * not whether the signature is wrong, not whether the path is malformed. The body is the same for
 * all of them (protocol section 9).
 */
export const NOT_AUTHORISED_MESSAGE = "not authorised\n";

/** The failure for every pre-signature failure. */
export function notAuthorised(): GatewayError {
  return new GatewayError("not-authorised", "not authorised");
}
