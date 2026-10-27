/**
 * The quota ledger (protocol section 7.1) and the quota checks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyQuota,
  addFile,
  removeFile,
  addBytes,
  setFileBytes,
  markLost,
  reconcile,
} from "../../../src/session/quota-accounting.ts";
import { checkFileCount, checkFileSize, checkTotalBytes, quotas } from "../../../src/policy/quotas.ts";

test("the ledger starts empty", () => {
  assert.deepEqual(emptyQuota(), { liveFiles: 0, liveBytes: 0, bytesAcceptedTotal: 0, bytesLost: 0 });
});

test("a file takes a slot and gives it back", () => {
  let quota = addFile(emptyQuota());
  quota = addBytes(quota, 100);
  assert.equal(quota.liveFiles, 1);
  assert.equal(quota.liveBytes, 100);
  assert.equal(quota.bytesAcceptedTotal, 100);

  quota = removeFile(quota, 100);
  assert.equal(quota.liveFiles, 0);
  assert.equal(quota.liveBytes, 0);
  // The cumulative total does not go down: the task did accept those bytes.
  assert.equal(quota.bytesAcceptedTotal, 100);
});

test("a file that changes size moves the live bytes by the difference", () => {
  let quota = addFile(emptyQuota());
  quota = setFileBytes(quota, 0, 100, 100);
  assert.equal(quota.liveBytes, 100);
  assert.equal(quota.bytesAcceptedTotal, 100);

  // A replace of 100 bytes with 40 bytes accepts 40 bytes, and the live total drops by 60.
  quota = setFileBytes(quota, 100, 40, 40);
  assert.equal(quota.liveBytes, 40);
  assert.equal(quota.bytesAcceptedTotal, 140);
});

test("content that is lost frees the live bytes and is counted as lost", () => {
  let quota = addFile(emptyQuota());
  quota = addBytes(quota, 100);
  quota = markLost(quota, 100);
  assert.equal(quota.liveBytes, 0);
  assert.equal(quota.bytesAcceptedTotal, 100);
  assert.equal(quota.bytesLost, 100);
});

test("reconciling brings the ledger back in line with the inventory", () => {
  let quota = addFile(emptyQuota());
  quota = addBytes(quota, 100);
  quota = reconcile(quota, 1, 0);
  assert.equal(quota.liveBytes, 0);
  assert.equal(quota.bytesLost, 100);
  assert.equal(quota.bytesAcceptedTotal, 100);
});

test("the limits are the ones the contract publishes", () => {
  const limits = quotas();
  assert.equal(limits.max_files, 20);
  assert.equal(limits.max_total_bytes, 245760);
  assert.equal(limits.max_file_bytes, 12288);
  assert.deepEqual(limits.rate_limit, { requests: 30, window_seconds: 60 });
  assert.equal(limits.max_concurrency, 1);
});

test("the file-count check refuses the twenty-first file", () => {
  assert.equal(checkFileCount(19).ok, true);
  const refused = checkFileCount(20);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, "file-count-exceeded");
});

test("the size checks refuse over the limit", () => {
  assert.equal(checkFileSize(12288).ok, true);
  assert.equal(checkFileSize(12289).ok, false);
  assert.equal(checkTotalBytes(245760).ok, true);
  assert.equal(checkTotalBytes(245761).ok, false);
});
