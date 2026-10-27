/**
 * The quotas (protocol section 7.1).
 *
 * The authority is `src/config/quotas.json`; the published view is
 * `gateway/write/docs/quotas-and-type-policy.md`. The units are fixed: **bytes are authoritative**
 * and KiB means 1024 bytes.
 *
 * What the numbers mean, which is the part the JSON cannot say, is in the protocol: the limits
 * count **live** state, not cumulative history, so a tombstone frees a slot and its bytes and an
 * agent that staged the wrong file can recover. The accounting itself — the arithmetic over the
 * session's ledger — is in `src/session/quota-accounting.ts`, because it has to happen inside the
 * Durable Object, atomically with the change it accounts for.
 */
import quotasJson from "../config/quotas.json" with { type: "json" };

/** The quota limits. */
export interface QuotaLimits {
  /** The number of live files: files that exist and are not tombstoned. */
  max_files: number;
  /** The sum of the current byte length of every live file. */
  max_total_bytes: number;
  /** The byte length of any one file. */
  max_file_bytes: number;
  /** The rate limit. */
  rate_limit: { requests: number; window_seconds: number };
  /** The number of concurrent writers per task. */
  max_concurrency: number;
}

const LIMITS: QuotaLimits = {
  max_files: quotasJson.max_files,
  max_total_bytes: quotasJson.max_total_bytes,
  max_file_bytes: quotasJson.max_file_bytes,
  rate_limit: quotasJson.rate_limit,
  max_concurrency: quotasJson.max_concurrency,
};

/** The effective limits. */
export function quotas(): QuotaLimits {
  return LIMITS;
}

/** The result of a quota check. */
export type QuotaDecision =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** Whether the task may hold another live file. */
export function checkFileCount(liveFiles: number): QuotaDecision {
  if (liveFiles >= LIMITS.max_files) {
    return {
      ok: false,
      code: "file-count-exceeded",
      message: `the task already holds the maximum of ${LIMITS.max_files} files; delete one to free a slot`,
    };
  }
  return { ok: true };
}

/** Whether a single file may be that large. */
export function checkFileSize(bytes: number): QuotaDecision {
  if (bytes > LIMITS.max_file_bytes) {
    return {
      ok: false,
      code: "file-too-large",
      message: `a file may be at most ${LIMITS.max_file_bytes} bytes`,
    };
  }
  return { ok: true };
}

/** Whether the task may hold that many staged bytes in total. */
export function checkTotalBytes(liveBytes: number): QuotaDecision {
  if (liveBytes > LIMITS.max_total_bytes) {
    return {
      ok: false,
      code: "total-bytes-exceeded",
      message: `the task may stage at most ${LIMITS.max_total_bytes} bytes; delete a file to free its bytes`,
    };
  }
  return { ok: true };
}
