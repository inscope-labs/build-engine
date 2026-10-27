/**
 * The quota ledger (protocol section 7.1).
 *
 * The ledger counts **live** state, not cumulative history:
 *
 *  - `liveFiles` — files that exist and are not tombstoned;
 *  - `liveBytes` — the current byte length of every live file;
 *  - `bytesAcceptedTotal` — every byte ever accepted into staging. Never decreases;
 *  - `bytesLost` — the bytes that were accepted and then lost to an isolate eviction.
 *
 * Counting live state is what bounds the size of the *deliverable*, which is the thing the quota
 * exists to protect. A tombstone frees a slot and its bytes, so an agent that staged the wrong
 * file can recover without asking the operator.
 *
 * The arithmetic lives here rather than in `src/policy/quotas.ts` because it has to happen
 * **inside** the Durable Object, atomically with the change it accounts for. The Durable Object
 * serialises the requests that touch one task, so the ledger cannot be raced.
 */
import type { QuotaState } from "../types/session.ts";

/** An empty ledger. */
export function emptyQuota(): QuotaState {
  return { liveFiles: 0, liveBytes: 0, bytesAcceptedTotal: 0, bytesLost: 0 };
}

/** Take a file slot. */
export function addFile(quota: QuotaState): QuotaState {
  return { ...quota, liveFiles: quota.liveFiles + 1 };
}

/** Release a file slot and the bytes it held. */
export function removeFile(quota: QuotaState, bytes: number): QuotaState {
  return {
    ...quota,
    liveFiles: Math.max(0, quota.liveFiles - 1),
    liveBytes: Math.max(0, quota.liveBytes - bytes),
  };
}

/** Account for bytes that entered staging. */
export function addBytes(quota: QuotaState, bytes: number): QuotaState {
  return {
    ...quota,
    liveBytes: quota.liveBytes + bytes,
    bytesAcceptedTotal: quota.bytesAcceptedTotal + bytes,
  };
}

/**
 * Account for a file whose content changed size.
 *
 * The live bytes move by the difference, because the file now occupies a different amount of
 * space. The cumulative total grows by the bytes that were *accepted*, which is the size of the
 * chunk, not the size of the file: a replace of a large file with a small one accepts the small
 * one.
 */
export function setFileBytes(
  quota: QuotaState,
  previousBytes: number,
  newBytes: number,
  acceptedBytes: number,
): QuotaState {
  return {
    ...quota,
    liveBytes: Math.max(0, quota.liveBytes - previousBytes) + newBytes,
    bytesAcceptedTotal: quota.bytesAcceptedTotal + acceptedBytes,
  };
}

/**
 * Account for bytes that were staged and then lost.
 *
 * The live bytes go down, because the bytes are gone; the cumulative total does not, because the
 * task did accept them. The difference is reported, so that an operator sees that an eviction
 * happened instead of discovering it in a diff.
 */
export function markLost(quota: QuotaState, bytes: number): QuotaState {
  return {
    ...quota,
    liveBytes: Math.max(0, quota.liveBytes - bytes),
    bytesLost: quota.bytesLost + bytes,
  };
}

/**
 * Bring the ledger back in line with the inventory.
 *
 * The ledger is derived state: it can only be wrong if the content was lost to an eviction, which
 * is the one event that changes the inventory without going through the ledger. Reconciling it
 * when the session is loaded is what keeps the two from drifting apart.
 */
export function reconcile(
  quota: QuotaState,
  liveFiles: number,
  liveBytes: number,
): QuotaState {
  const lost = Math.max(0, quota.liveBytes - liveBytes);
  return {
    liveFiles,
    liveBytes,
    bytesAcceptedTotal: quota.bytesAcceptedTotal,
    bytesLost: quota.bytesLost + lost,
  };
}
