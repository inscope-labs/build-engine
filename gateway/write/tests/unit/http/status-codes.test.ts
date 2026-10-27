/**
 * The error catalogue, in code (protocol section 9).
 *
 * The catalogue in `docs/error-catalog.md` and the table in `src/http/status-codes.ts` must agree.
 * A code that exists in one and not the other is a code an agent can be sent but cannot look up,
 * or a code the documentation promises and the gateway never produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ERROR_SPECS, errorSpec, isKnownCode } from "../../../src/http/status-codes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGUE = readFileSync(resolve(HERE, "../../../docs/error-catalog.md"), "utf-8");

/** The codes the catalogue documents, with the status it gives them. */
function documentedCodes(): Map<string, number> {
  const codes = new Map<string, number>();
  const pattern = /\| <a id="([a-z0-9-]+)"><\/a>`[a-z0-9-]+` \| (\d{3}) \|/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CATALOGUE)) !== null) {
    codes.set(match[1]!, Number(match[2]));
  }
  return codes;
}

test("every code the gateway can produce is in the catalogue", () => {
  const documented = documentedCodes();
  for (const code of Object.keys(ERROR_SPECS)) {
    assert.equal(documented.has(code), true, `${code} is not in the catalogue`);
  }
});

test("every code in the catalogue is one the gateway can produce", () => {
  for (const code of documentedCodes().keys()) {
    assert.equal(isKnownCode(code), true, `${code} is in the catalogue but not in the code table`);
  }
});

test("the status in the catalogue is the status in the code table", () => {
  for (const [code, status] of documentedCodes()) {
    assert.equal(errorSpec(code).status, status, code);
  }
});

test("the retryable codes are the ones that can succeed on a retry", () => {
  // A retry that changes nothing can only succeed for a rate limit and an unavailable state.
  // The provider's codes are the same two things on the far side: a rate limit that will pass,
  // and a service that was briefly down. What cannot succeed on a retry is a request that is
  // wrong, a credential that is wrong, or a branch that has moved.
  const retryable = new Set([
    "rate-limited",
    "state-unavailable",
    "provider-rate-limited",
    "provider-unavailable",
  ]);
  for (const [code, spec] of Object.entries(ERROR_SPECS)) {
    if (spec.retryable) {
      assert.ok(
        retryable.has(code),
        `${code} is marked retryable, but a retry that changes nothing cannot succeed`,
      );
    }
  }
  // The codes that must not be retryable, because a retry cannot fix them.
  for (const code of [
    "provider-rejected",
    "provider-credential-invalid",
    "expected-sha-conflict",
    "idempotency-conflict",
    "reconcile-required",
    "seal-requires-commit",
  ]) {
    assert.equal(ERROR_SPECS[code]!.retryable, false, code);
  }
});

test("the pre-signature failures are one code and one body", () => {
  // Everything that happens before the signature is verified is a 401, so that a caller who
  // cannot authenticate learns nothing about which check failed.
  const preSignature = ["not-authorised"];
  for (const code of preSignature) {
    assert.equal(ERROR_SPECS[code]!.status, 401, code);
  }
  assert.equal(Object.values(ERROR_SPECS).filter((spec) => spec.status === 401).length, 1);
});

test("the three closures are distinct codes", () => {
  for (const code of ["task-sealed", "task-revoked", "order-closed"]) {
    assert.equal(ERROR_SPECS[code]!.status, 410, code);
  }
});

test("an unknown code is a 500 rather than being thrown away", () => {
  assert.equal(errorSpec("no-such-code").status, 500);
  assert.equal(isKnownCode("no-such-code"), false);
});
