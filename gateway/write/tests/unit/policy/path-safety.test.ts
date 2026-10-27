/**
 * The path rules (protocol section 5.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPath, isSafePath, extensionOf, fileNameOf } from "../../../src/policy/path-safety.ts";

test("an ordinary path is accepted", () => {
  for (const path of [
    "intro.md",
    "docs/intro.md",
    "a/b/c/d/e/f/g/h.txt",
    "notes/na~me.v1..2.md",
    "file with spaces.md",
    "café/naïve.md",
    "UPPER.MD",
  ]) {
    assert.equal(isSafePath(path), true, path);
  }
});

test("an empty path is refused", () => {
  assert.deepEqual(checkPath(""), { ok: false, reason: "empty" });
});

test("an absolute path is refused", () => {
  assert.deepEqual(checkPath("/intro.md"), { ok: false, reason: "absolute" });
});

test("a backslash is refused", () => {
  assert.deepEqual(checkPath("docs\\intro.md"), { ok: false, reason: "backslash" });
});

test("a control character is refused", () => {
  assert.deepEqual(checkPath("intro\u0000.md"), { ok: false, reason: "control-character" });
  assert.deepEqual(checkPath("intro\u001f.md"), { ok: false, reason: "control-character" });
  assert.deepEqual(checkPath("intro\u007f.md"), { ok: false, reason: "control-character" });
});

test("an empty component is refused", () => {
  assert.deepEqual(checkPath("docs//intro.md"), { ok: false, reason: "empty-component" });
  assert.deepEqual(checkPath("docs/"), { ok: false, reason: "empty-component" });
});

test("a dot component is refused", () => {
  assert.deepEqual(checkPath("./intro.md"), { ok: false, reason: "dot-component" });
  assert.deepEqual(checkPath("docs/./intro.md"), { ok: false, reason: "dot-component" });
});

test("a dotdot component is refused", () => {
  assert.deepEqual(checkPath("../intro.md"), { ok: false, reason: "dotdot-component" });
  assert.deepEqual(checkPath("docs/../../intro.md"), { ok: false, reason: "dotdot-component" });
});

test("a component that merely contains two dots is a legal file name", () => {
  // The rule is "a component that is exactly ..", not a substring test. A substring test would
  // reject this legal name, and can be bypassed by encodings.
  assert.equal(isSafePath("notes/na~me.v1..2.md"), true);
  assert.equal(isSafePath("a..b"), true);
  assert.equal(isSafePath("..hidden"), false, "a hidden component is still hidden");
});

test("a hidden component is refused", () => {
  assert.deepEqual(checkPath(".env"), { ok: false, reason: "hidden-component" });
  assert.deepEqual(checkPath("docs/.git/config"), { ok: false, reason: "hidden-component" });
});

test("a Windows device name is refused", () => {
  for (const name of ["con", "CON", "nul", "com1", "LPT9"]) {
    assert.deepEqual(checkPath(name), { ok: false, reason: "reserved-name" }, name);
  }
  // The rule is about the whole component, so a name that merely starts with one is fine.
  assert.equal(isSafePath("console.md"), true);
  assert.equal(isSafePath("com1.txt"), true);
});

test("a trailing dot or space is refused", () => {
  assert.deepEqual(checkPath("intro.md."), { ok: false, reason: "trailing-dot-or-space" });
  assert.deepEqual(checkPath("intro.md "), { ok: false, reason: "trailing-dot-or-space" });
});

test("a path that is too long or too deep is refused", () => {
  assert.deepEqual(checkPath("a".repeat(241)), { ok: false, reason: "too-long" });
  assert.deepEqual(checkPath("a/b/c/d/e/f/g/h/i"), { ok: false, reason: "too-deep" });
});

test("the extension and the file name are read from the last component", () => {
  assert.equal(extensionOf("docs/intro.md"), ".md");
  assert.equal(extensionOf("intro.MD"), ".md");
  assert.equal(extensionOf("docs/notes.v2/readme"), null);
  assert.equal(extensionOf(".gitignore"), null);
  assert.equal(fileNameOf("docs/intro.md"), "intro.md");
  assert.equal(fileNameOf("intro.md"), "intro.md");
});
