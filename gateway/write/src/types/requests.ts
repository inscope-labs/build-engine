/**
 * The request shapes: the capability, the operation, and the parsed parameters.
 */
import type { Operation } from "../config/constants.ts";

/**
 * A parsed capability.
 *
 * Every field here is bound into the signature (protocol section 3.1), so a capability that parsed
 * is still not a valid capability: the signature has to verify.
 */
export interface Capability {
  /** The key id, which selects the signing secret. */
  kid: string;
  /** The expiry, in unix seconds. The capability is valid while `now <= exp`. */
  exp: number;
  /** The work order id. */
  order: string;
  /** The plan id. */
  plan: string;
  /** The task id. */
  task: string;
  /** The authorised writer. An identity, not a secret. */
  writer: string;
  /** The expected head of the submissions branch, 40 lowercase hex. */
  head: string;
  /** The signature, base64url without padding. */
  sig: string;
}

/** The parsed parameters of one operation. */
export interface OperationParams {
  /** The file path, relative to the task folder. */
  path?: string;
  /** The explicit media type of a file. */
  type?: string;
  /** The content sequence number. */
  seq?: number;
  /** The lowercase hex SHA-256 of the decoded chunk. */
  hash?: string;
  /** The base64url chunk content. */
  data?: string;
  /** The selected paths of a commit. */
  files?: string[];
  /** An idempotency key. */
  idem?: string;
}

/** A request that parsed into a capability, an operation and its parameters. */
export interface ParsedRequest {
  capability: Capability;
  operation: Operation;
  params: OperationParams;
}

/** Why a request path could not be parsed. Every one of these is a 401. */
export type ParseFailure =
  | "malformed"
  | "encoded-separator";

/** The result of parsing a request path. */
export type ParseResult =
  | { ok: true; request: ParsedRequest }
  | { ok: false; reason: ParseFailure };
