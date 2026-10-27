/**
 * The writer lease (protocol section 2.5).
 *
 * One writer per task, enforced by a lease held in the Durable Object, so that it is consistent
 * across the whole task and survives a restart.
 *
 * The lease is an identity binding, not a secret. Whoever holds the capability can act as the
 * capability's writer; the lease stops a *second* capability from writing at the same time. A
 * stolen capability is indistinguishable from the original writer, and no amount of lease logic
 * changes that — it is what "bearer" means.
 */
import type { WriterLease } from "../types/session.ts";

/** The result of trying to take or renew the lease. */
export type LeaseDecision =
  | { ok: true; lease: WriterLease; renewed: boolean }
  | { ok: false; code: "writer-conflict"; message: string };

/**
 * Take or renew the lease.
 *
 * - No lease: the caller takes it.
 * - A lease held by the same writer: the caller renews it. The lease slides, so an active agent
 *   does not lose its lease while it is working.
 * - An expired lease: the caller takes it, whoever the previous holder was. Otherwise a crashed
 *   writer would deadlock its task forever, which is exactly what an expiry is supposed to
 *   prevent.
 * - An active lease held by a different writer: refused. The second writer is not the writer, and
 *   the contract tells it to stop rather than to retry.
 */
export function claimLease(
  lease: WriterLease | null,
  writer: string,
  now: number,
  leaseSeconds: number,
): LeaseDecision {
  if (lease === null) {
    return { ok: true, lease: { writer, claimedAt: now, expiresAt: now + leaseSeconds }, renewed: false };
  }
  if (lease.writer === writer) {
    return {
      ok: true,
      lease: { writer, claimedAt: lease.claimedAt, expiresAt: now + leaseSeconds },
      renewed: true,
    };
  }
  if (now >= lease.expiresAt) {
    return { ok: true, lease: { writer, claimedAt: now, expiresAt: now + leaseSeconds }, renewed: false };
  }
  return {
    ok: false,
    code: "writer-conflict",
    message: "another writer holds this task; you are not the writer",
  };
}

/** Whether the lease is still active at this moment. The boundary is inclusive. */
export function leaseActive(lease: WriterLease | null, now: number): boolean {
  return lease !== null && now < lease.expiresAt;
}
