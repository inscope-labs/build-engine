/**
 * The response shapes.
 *
 * The envelope is the same for every response, success or failure (protocol section 4.3). A
 * gateway that returns a different shape per operation is a gateway an agent has to special-case.
 */
import type { Operation } from "../config/constants.ts";
import type { SessionState } from "./session.ts";

/** One next step. `href` is root-relative: the agent resolves it as `root + href`. */
export interface Link {
  /** A stable machine-readable name, e.g. `append`. */
  rel: string;
  /** The operation the link invokes. */
  op: Operation;
  /** The path and query after the capability prefix, always beginning with `/`. */
  href: string;
  /** The parameters the agent must supply, for the operations whose values it cannot know. */
  required: string[];
}

/** The links a response carries. */
export interface Links {
  /** The absolute URL of the canonical contract. */
  contract: string;
  /** The absolute URL of the error catalogue, present only when there is an error. */
  help?: string;
  /** The legal next steps. Never empty on a success, except in the `sealed` state. */
  next: Link[];
}

/** The machine-readable failure. `code` is the authoritative outcome. */
export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

/** The envelope. Every response is one of these. */
export interface Envelope {
  protocol: string;
  op: Operation | string;
  /** The task the request was for, or null when the request did not parse far enough to know. */
  task: string | null;
  /** The work order, or null for the same reason. */
  order: string | null;
  state: SessionState | null;
  result: unknown;
  links: Links;
  error: ErrorBody | null;
}
