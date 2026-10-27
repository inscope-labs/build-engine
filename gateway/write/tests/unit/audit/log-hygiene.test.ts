/**
 * Log hygiene (plan task 5.4.2, ADR 0004).
 *
 * The check is a **driver**, not a set of assertions scattered across the suite: the same code
 * backs this test and the deploy gate, so the gate and the test can never check different
 * things.
 *
 * The pass condition is that nothing the gateway emitted contains a sentinel. The sentinels are
 * planted in every place a secret could be, and the gateway is driven through the whole
 * protocol and through the failure paths with them in place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runHygieneCheck } from "../../helpers/hygiene.ts";
import { containsSecret } from "../../../src/audit/redaction.ts";

test("nothing the gateway emits contains a sentinel", async () => {
  const result = await runHygieneCheck();

  assert.ok(result.outputs.length > 0, "the check must have captured something, or it proves nothing");
  assert.deepEqual(
    result.findings,
    [],
    `a sentinel leaked: ${result.findings.map((f) => `${f.sentinel} in ${f.where}`).join(", ")}`,
  );
});

test("the check actually exercises the gateway, rather than finding nothing because it did nothing", async () => {
  const result = await runHygieneCheck();

  // A log line per request, and the failure bodies. If this ever drops, the check has stopped
  // driving the gateway and has become a test of nothing.
  const logs = result.outputs.filter((output) => output.where === "log");
  assert.ok(logs.length >= 8, `expected the log to hold a line per request, found ${logs.length}`);
  assert.ok(
    result.outputs.some((output) => output.text.includes("not-authorised")),
    "the refusal path must be exercised",
  );
  assert.ok(
    result.outputs.some((output) => output.text.includes("method-not-allowed")),
    "the wrong-method path must be exercised",
  );
});

test("the audit records are in the captured outputs, and they are redacted", async () => {
  const result = await runHygieneCheck();

  const audit = result.outputs.find((output) => output.text.includes("\"reason\":\"ok\"") && output.text.includes("\"op\":\"commit\""));
  assert.ok(audit !== undefined, "the commit's audit record must be in the captured output");
  assert.equal(containsSecret(audit!.text), false);
  // The record carries the counts and the identifiers, and never the file's name.
  assert.ok(audit!.text.includes("\"files\":1"));
  assert.ok(!audit!.text.includes("sentinel-file"), "the audit record must not name the file");
});
