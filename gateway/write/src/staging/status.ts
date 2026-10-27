/**
 * The status of a session (protocol section 4.1, 13.2).
 *
 * `status` is what an agent calls when it is unsure. It reports the inventory, the quota usage
 * and, for each file, whether its content is still there.
 *
 * The distinction that matters is `content: present | missing | tombstoned`. A file whose content
 * is `missing` was staged and then lost to an isolate eviction: the inventory is durable, the
 * content is not, and the agent has to send the content again.
 */
import { allFiles, liveFiles } from "../session/tombstones.ts";
import type { CommitRecord, QuotaState, SessionSnapshot, SessionState, StagingContext, WriterLease } from "../types/session.ts";

/** Build the snapshot. */
export function snapshot(
  ctx: StagingContext,
  state: SessionState,
  lease: WriterLease | null,
  committed: CommitRecord | null,
): SessionSnapshot {
  const files = allFiles(ctx.files).map((entry) => ({
    path: entry.path,
    last_seq: entry.lastSeq,
    bytes: entry.bytes,
    hash: entry.hash,
    content: entry.content,
    tombstoned: entry.content === "tombstoned",
  }));

  return {
    state,
    writer: lease?.writer ?? null,
    leaseExpiresAt: lease?.expiresAt ?? null,
    files,
    quota: { ...ctx.quota },
    committed,
  };
}

/**
 * The quota's view, as a client sees it.
 *
 * The live figures are what the limits apply to. The cumulative figures are for the operator: how
 * much the task has accepted, and how much of that was lost to an eviction.
 */
export function quotaView(quota: QuotaState): {
  live_files: number;
  live_bytes: number;
  bytes_accepted_total: number;
  bytes_lost: number;
} {
  return {
    live_files: quota.liveFiles,
    live_bytes: quota.liveBytes,
    bytes_accepted_total: quota.bytesAcceptedTotal,
    bytes_lost: quota.bytesLost,
  };
}

/** The live files only, which is what a commit may select from. */
export function selectableFiles(ctx: StagingContext): string[] {
  return liveFiles(ctx.files).map((entry) => entry.path);
}
