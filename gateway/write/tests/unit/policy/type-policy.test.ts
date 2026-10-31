/**
 * The type policy (protocol section 7.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkType, checkTypeAllowed, typeForPath, allowedExtensions } from "../../../src/policy/type-policy.ts";
import { utf8 } from "../../../src/util/hash.ts";

test("an allowed text type is accepted", () => {
  const check = checkType("intro.md", utf8("# hello\n"));
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.type.id, "markdown");
  assert.equal(check.type.media_type, "text/markdown");
});

test("an extension that is not in the allow-list is refused, and the refusal names the alternatives", () => {
  const check = checkType("notes.xyz", utf8("an unknown type"));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "type-not-allowed");
  assert.ok((check.allowed ?? []).includes(".md"));
});

test("binary content is refused even with an allowed extension", () => {
  const check = checkType("data.md", new Uint8Array([0x68, 0x69, 0x00, 0x21]));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "binary");
});

test("content that is not UTF-8 is refused", () => {
  const check = checkType("intro.md", new Uint8Array([0xff, 0xfe, 0x41]));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "not-utf8");
});

test("a type that may not be empty refuses an empty file", () => {
  const check = checkType("data.json", utf8(""));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "empty-not-allowed");
});

test("a type that may be empty accepts an empty file", () => {
  const check = checkType("notes.txt", utf8(""));
  assert.equal(check.ok, true);
});

test("an explicit type that disagrees with the extension is refused", () => {
  const check = checkType("intro.md", utf8("x"), "text/plain");
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "type-mismatch");
});

test("an explicit type that agrees with the extension is accepted", () => {
  const check = checkType("intro.md", utf8("x"), "text/markdown");
  assert.equal(check.ok, true);
});

test("a denied extension is refused, and it is refused as a denial rather than as an unknown type", () => {
  const check = checkType("key.pem", utf8("x"));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "denied-extension");

  const binary = checkType("image.png", utf8("not really a png"));
  assert.equal(binary.ok, false);
  if (binary.ok) return;
  assert.equal(binary.reason, "denied-extension");
});

test("a denied name is refused", () => {
  const check = checkType("credentials", utf8("x"));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "denied-name");
});

test("a file that is too large is refused", () => {
  const check = checkType("big.md", utf8("x".repeat(12289)));
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.reason, "file-too-large");
});

test("the name-only check does not apply the content rules", () => {
  // A scaffolded file has no content yet, so the empty-file rule must not apply to it.
  const check = checkTypeAllowed("data.json");
  assert.equal(check.ok, true);
  assert.equal(checkTypeAllowed("data.md").ok, true);
  assert.equal(checkTypeAllowed("image.png").ok, false);
  assert.equal(checkTypeAllowed("notes.xyz").ok, false);
});

test("the extension maps to the right type", () => {
  assert.equal(typeForPath("a.md")?.id, "markdown");
  assert.equal(typeForPath("a.py")?.id, "python");
  assert.equal(typeForPath("a.json")?.id, "json");
  assert.equal(typeForPath("a.unknown"), null);
  assert.ok(allowedExtensions().includes(".markdown"));
});
