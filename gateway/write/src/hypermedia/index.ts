/**
 * The index — the first thing an agent sees (protocol section 4.6).
 *
 * The index is the hypermedia description of the session and of its legal next steps. It reports
 * what the agent needs to plan its work: the folder it writes into, the quotas it must respect, and
 * whether the task has already committed.
 *
 * It does **not** report the repository, the branch, the expected head, the key id or the
 * signature. The agent does not need them, and a response that carries them is a response that
 * gets logged.
 */
import { quotas } from "../policy/quotas.ts";
import typePolicy from "../config/type-policy.json" with { type: "json" };
import type { CommitRecord, SessionState } from "../types/session.ts";

/** The parts of a capability the index needs. */
export interface IndexContext {
  /** The writer this capability names. */
  writer: string;
  /** The capability's expiry, in unix seconds. */
  expiresAt: number;
  /** The plan id. */
  plan: string;
  /** The work order id. */
  order: string;
  /** The task id. */
  task: string;
  /** The configured folder template. */
  folderTemplate: string;
  /** The session state. */
  state: SessionState;
  /** The commit record, or null. */
  committed: CommitRecord | null;
}

/**
 * Resolve the task folder.
 *
 * The template is configuration and the placeholders come from the **signed** capability, so no
 * request can influence the result. A template with an unknown placeholder is a configuration
 * error and is caught by the environment validation, not here.
 */
export function resolveFolder(template: string, plan: string, order: string, task: string): string {
  return template
    .replace(/\{plan\}/g, plan)
    .replace(/\{order\}/g, order)
    .replace(/\{task\}/g, task);
}

/**
 * A digest of the type policy.
 *
 * The agent may be working against a long-lived capability while the policy is redeployed. The
 * digest lets it notice that the rules it was told about have changed.
 */
export function typePolicyDigest(): string {
  // A cheap, stable digest of the policy document. It is not a security boundary; it is a way to
  // notice a change.
  const text = JSON.stringify(typePolicy);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Build the index result. */
export function indexResult(ctx: IndexContext): Record<string, unknown> {
  const limits = quotas();
  return {
    writer: ctx.writer,
    expires_at: ctx.expiresAt,
    folder: resolveFolder(ctx.folderTemplate, ctx.plan, ctx.order, ctx.task),
    quotas: {
      max_files: limits.max_files,
      max_total_bytes: limits.max_total_bytes,
      max_file_bytes: limits.max_file_bytes,
      rate_limit: { requests: limits.rate_limit.requests, window_seconds: limits.rate_limit.window_seconds },
      max_concurrency: limits.max_concurrency,
    },
    type_policy_digest: typePolicyDigest(),
    committed: ctx.committed === null ? null : { sha: ctx.committed.sha, at: ctx.committed.at },
  };
}
