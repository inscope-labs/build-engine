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

import { findLeaks, runHygieneCheck, type Sentinel } from "../../helpers/hygiene.ts";
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

test("the check can fail: a planted leak is found", async () => {
  // A check that cannot fail proves nothing, and this one has failed before by finding nothing
  // because it had stopped driving the gateway. The rule is therefore exercised directly, on a
  // synthetic output that carries a sentinel.
  const sentinels: Sentinel[] = [{ name: "a-secret", value: "sentinel-value-0123456789" }];

  const planted = findLeaks([{ where: "log", text: "the secret is sentinel-value-0123456789" }], sentinels);
  assert.equal(planted.length, 1);
  assert.equal(planted[0]?.sentinel, "a-secret");
  assert.equal(planted[0]?.where, "log");

  // And the shape rule catches a secret that nobody planted.
  const shape = findLeaks(
    [{ where: "output-0", text: "the token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" }],
    sentinels,
  );
  assert.equal(shape.length, 1);
  assert.equal(shape[0]?.sentinel, "shape");

  // And a clean output is clean.
  assert.deepEqual(findLeaks([{ where: "log", text: "{\"status\":200}" }], sentinels), []);
});

test("the sentinels cover the capability itself, not only the secrets behind it", async () => {
  const result = await runHygieneCheck();
  const names = result.sentinels.map((sentinel) => sentinel.name);

  for (const expected of [
    "signing-secret",
    "github-token",
    "operator-token",
    "payload",
    "payload-base64",
    "query-value",
    "capability-url",
    "signature",
  ]) {
    assert.ok(names.includes(expected), `the ${expected} sentinel is planted`);
  }

  // And each one is a value that is actually distinctive, so that a substring match means
  // something.
  for (const sentinel of result.sentinels) {
    assert.ok(sentinel.value.length >= 8, `${sentinel.name} is distinctive enough to match on`);
  }
});
