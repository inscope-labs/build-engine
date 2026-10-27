/**
 * The protocol's fixed values.
 *
 * The contract is `gateway/write/docs/protocol.md` (`ctxwrite-v1`). This module holds the values
 * that the contract fixes, and nothing that it leaves to policy. Policy lives in
 * `src/config/quotas.json`, `src/config/type-policy.json` and the environment.
 */

/** The scheme version. It appears in the path prefix, the domain separator and every envelope. */
export const PROTOCOL = "ctxwrite-v1";

/**
 * The path prefix of a capability. The capability is `/w1/{kid}/{exp}/{order}/{plan}/{task}/{writer}/{head}/{sig}`
 * and the operation, if any, is the segment after it.
 */
export const PATH_PREFIX = "w1";

/** How many segments a capability has, excluding the leading empty segment and the path prefix. */
export const CAPABILITY_SEGMENTS = 8;

/** The routes the gateway serves, below the origin. */
export const ROUTE_CONTRACT = "/contract/ctxwrite-v1";
export const ROUTE_ERRORS = "/contract/ctxwrite-v1/errors";
export const ROUTE_QUOTAS = "/contract/ctxwrite-v1/quotas";
export const ROUTE_HEALTH = "/healthz";
export const ROUTE_ADMIN = "/admin";

/** The operations an agent may invoke. The index is the capability path with no operation. */
export const OPERATIONS = [
  "index",
  "status",
  "create",
  "append",
  "replace",
  "read",
  "delete",
  "commit",
  "seal",
] as const;

export type Operation = (typeof OPERATIONS)[number];

/** The operations that change staged content. A sealed task refuses all of them. */
export const MUTATING_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "append",
  "replace",
  "delete",
  "commit",
  "seal",
]);

/**
 * The placeholder file.
 *
 * Git does not store empty folders, so the operator commits a placeholder into the task folder
 * before the work order is issued. The gateway never stages it, never commits it, never returns
 * it and never lists it: it is the operator's file and it is invisible to the agent
 * (protocol section 12.3).
 */
export const PLACEHOLDER_FILE = ".keep";

/**
 * The commit message the gateway generates. It is a constant: no request may influence it, because
 * a commit message is a piece of the operator's review surface.
 */
export const COMMIT_MESSAGE_SUBJECT = "ctxwrite-v1";

/**
 * The commit's author and committer identity.
 *
 * The gateway signs the commit as itself and as nobody else. A commit that carried the agent's
 * identity would be indistinguishable from a commit a person made by hand, and the operator's
 * review surface is exactly where that distinction matters.
 */
export const COMMIT_AUTHOR_NAME = "build-engine write gateway";
export const COMMIT_AUTHOR_EMAIL = "ctxwrite@users.noreply.github.com";

/**
 * The provider's retry policy.
 *
 * Three attempts, with the delay doubling between them and capped. The bound matters: a commit
 * that is going to fail should fail while the agent is still waiting, not after a minute of
 * silence. The commit route's own timeout is the outer bound, and these are the inner steps.
 */
export const PROVIDER_MAX_ATTEMPTS = 3;
export const PROVIDER_BACKOFF_BASE_MS = 250;
export const PROVIDER_BACKOFF_MAX_MS = 4000;

/**
 * The default per-call timeout for a provider call, in milliseconds.
 *
 * A provider that has not answered in ten seconds is not going to answer this commit, and the
 * agent is better served by a definite failure than by an open-ended wait.
 */
export const PROVIDER_TIMEOUT_MS = 10000;

/** The bounds on the configurable provider timeout. */
export const PROVIDER_TIMEOUT_MIN_MS = 1000;
export const PROVIDER_TIMEOUT_MAX_MS = 60000;

/**
 * The commit message.
 *
 * The format is fixed by the contract (section 8.3): the subject, a blank line, and the selected
 * paths, one per line, as paths relative to the task folder. The paths are the only part that
 * comes from the request, and they are the part the contract says they are.
 */
export function commitMessage(task: string, order: string, paths: readonly string[]): string {
  const body = paths.map((path) => path).join("\n");
  return `${COMMIT_MESSAGE_SUBJECT}: ${task} (${order})\n\n${body}\n`;
}

/** The header names the gateway sets or reads. */
export const HEADER_REQUEST_ID = "X-Request-Id";

/**
 * How many chunk identities are remembered per file, for replay detection.
 *
 * The window is bounded because the Durable Object's memory is bounded: a file that is appended to
 * a million times must not grow the session's state without limit. A replay outside the window
 * cannot be proven to be a replay, so it is refused (see protocol section 6.2).
 */
export const REPLAY_WINDOW = 16;

/** The path limits from protocol section 5.1. */
export const MAX_PATH_LENGTH = 240;
export const MAX_PATH_DEPTH = 8;

/** The default maximum lifetime of a capability, in seconds. Stage 1.4 and protocol section 3.4. */
export const DEFAULT_MAX_TTL_SECONDS = 604800;

/** The default writer-lease duration, in seconds. */
export const DEFAULT_LEASE_SECONDS = 300;

/** The domain separator is the scheme's first field in the signed message. */
export const DOMAIN_SEPARATOR = PROTOCOL;
