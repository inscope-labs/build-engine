/**
 * The capability parser (protocol section 2.1, 4.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCapabilityPath, parseQuery, decodeComponent, encodeComponent, buildQuery } from "../../../src/auth/root-url.ts";
import { capabilityFields, signedCapability, capabilityPath } from "../../helpers/mock-worker.ts";

const fields = capabilityFields();

test("a well-formed capability path parses", () => {
  const raw = `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/A${"B".repeat(42)}`;
  const parsed = parseCapabilityPath(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.capability.kid, fields.kid);
  assert.equal(parsed.capability.exp, fields.exp);
  assert.equal(parsed.capability.order, fields.order);
  assert.equal(parsed.capability.plan, fields.plan);
  assert.equal(parsed.capability.task, fields.task);
  assert.equal(parsed.capability.writer, fields.writer);
  assert.equal(parsed.capability.head, fields.head);
  assert.equal(parsed.operation, null);
});

test("the operation is the segment after the capability", () => {
  const raw = `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}/append`;
  const parsed = parseCapabilityPath(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.operation, "append");
});

test("an unknown operation still parses: the session decides that it is unknown", () => {
  const raw = `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}/nonsense`;
  const parsed = parseCapabilityPath(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.operation, "nonsense");
});

test("a malformed path is refused", () => {
  const cases: string[] = [
    "",
    "/",
    "/w1",
    `/w1/${fields.kid}`,
    `/w2/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`,
    `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}`,
    `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}/append/extra`,
  ];
  for (const raw of cases) {
    assert.equal(parseCapabilityPath(raw).ok, false, `should refuse ${JSON.stringify(raw)}`);
  }
});

test("an encoded separator is refused before anything is decoded", () => {
  const raw = `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/a%2Fb/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`;
  const parsed = parseCapabilityPath(raw);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "encoded-separator");
});

test("a field that does not meet its rule is refused", () => {
  const base = `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`;
  const bad: string[] = [
    `/w1/${"k".repeat(17)}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`,
    `/w1/${fields.kid}/00${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`,
    `/w1/${fields.kid}/-1/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/${"A".repeat(43)}`,
    `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/Task/${fields.writer}/${fields.head}/${"A".repeat(43)}`,
    `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/NOTHEX/${"A".repeat(43)}`,
    `/w1/${fields.kid}/${fields.exp}/${fields.order}/${fields.plan}/${fields.task}/${fields.writer}/${fields.head}/tooshort`,
  ];
  for (const raw of bad) {
    assert.equal(parseCapabilityPath(raw).ok, false, `should refuse ${JSON.stringify(raw)}`);
  }
  assert.equal(parseCapabilityPath(base).ok, true);
});

test("the query is parsed, and a repeated parameter is recorded", () => {
  const parsed = parseQuery("path=a.md&seq=1");
  assert.equal(parsed.repeated, null);
  assert.equal(parsed.entries.get("path")?.[0]?.value, "a.md");
  assert.equal(parsed.entries.get("seq")?.[0]?.value, "1");

  const repeated = parseQuery("path=a.md&path=b.md");
  assert.equal(repeated.repeated, "path");
});

test("a plus is a plus, not a space", () => {
  const parsed = parseQuery("path=a+b.md");
  assert.equal(parsed.entries.get("path")?.[0]?.value, "a+b.md");
});

test("percent-encoding round-trips, including a multi-byte character", () => {
  for (const value of ["a.md", "a b.md", "café/naïve.md", "a+b.md", "a%b.md", "a&b.md", "a=b.md"]) {
    assert.equal(decodeComponent(encodeComponent(value)), value, value);
  }
});

test("the raw value is kept, so that a comma inside a name is not a separator", () => {
  const parsed = parseQuery("files=a%2Cb.md,c.md");
  assert.equal(parsed.entries.get("files")?.[0]?.raw, "a%2Cb.md,c.md");
  const parts = parsed.entries.get("files")![0]!.raw.split(",");
  assert.deepEqual(parts.map(decodeComponent), ["a,b.md", "c.md"]);
});

test("a built query string is stable and sorted", () => {
  const query = buildQuery({ seq: "1", path: "a b.md" });
  assert.equal(query, "path=a%20b.md&seq=1");
  assert.equal(buildQuery({ path: "a.md" }), buildQuery({ path: "a.md" }));
});

test("the helper builds the same path the parser expects", async () => {
  const { capability } = await signedCapability();
  const parsed = parseCapabilityPath(capabilityPath(capability));
  assert.equal(parsed.ok, true);
});
