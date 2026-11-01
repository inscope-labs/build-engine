/**
 * The encodings (plan task 5.5.2: the utility modules).
 *
 * Two encodings carry the protocol's payload, and both of them have to round-trip exactly:
 *
 *  - **base64url without padding** (RFC 4648 section 5), for the chunk payload in the query
 *    string and for the signature;
 *  - **SHA-256 in lowercase hex**, for the chunk hash the client sends and for the file hash the
 *    gateway records.
 *
 * The decoders return `null` rather than throwing, because every caller is handling untrusted
 * input and wants to answer "not base64url" rather than to handle an exception.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { base64url, base64urlDecode, base64urlDecodeText } from "../../../src/util/base64.ts";
import { equalHex, hex, sha256Hex, sha256HexOfText, utf8 } from "../../../src/util/hash.ts";

test("base64url round-trips, without padding", () => {
  for (const text of ["", "a", "ab", "abc", "hello\n", "a longer piece of text\n", "ünïcödé ✓"]) {
    const encoded = base64url(utf8(text));
    assert.ok(!encoded.includes("="), "the padding is stripped");
    assert.ok(!encoded.includes("+") && !encoded.includes("/"), "the url alphabet is used");
    assert.equal(new TextDecoder().decode(base64urlDecode(encoded)!), text);
  }
});

test("the url alphabet is the one the signature uses", () => {
  // The bytes 0xfb 0xff encode to "+/8=" in the standard alphabet and to "-_8" in the url one.
  const encoded = base64url(new Uint8Array([0xfb, 0xff, 0xbf]));
  assert.equal(encoded, "-_-_");
  assert.deepEqual([...base64urlDecode(encoded)!], [0xfb, 0xff, 0xbf]);
});

test("text that is not base64url is refused, not decoded", () => {
  assert.equal(base64urlDecode("not base64!"), null);
  assert.equal(base64urlDecode("a+b/c"), null, "the standard alphabet is not the url one");
  assert.equal(base64urlDecode("a b"), null);
  assert.equal(base64urlDecode("===="), null);
});

test("a length of one modulo four cannot come from any input", () => {
  assert.equal(base64urlDecode("a"), null);
  assert.equal(base64urlDecode("abcde"), null);
  assert.notEqual(base64urlDecode("ab"), null);
  assert.notEqual(base64urlDecode("abc"), null);
});

test("text that is not UTF-8 is refused by the text decoder", () => {
  const bytes = base64url(new Uint8Array([0xff, 0xfe, 0xfd]));
  assert.notEqual(base64urlDecode(bytes), null, "the bytes are valid base64url");
  assert.equal(base64urlDecodeText(bytes), null, "but they are not text");
  assert.equal(base64urlDecodeText(base64url(utf8("hello\n"))), "hello\n");
});

test("SHA-256 of the empty string is the well-known digest", async () => {
  assert.equal(
    await sha256HexOfText(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("SHA-256 of the abc test vector is the well-known digest", async () => {
  assert.equal(
    await sha256HexOfText("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("the hash of the bytes and the hash of the text agree", async () => {
  const text = "the quick brown fox\n";
  assert.equal(await sha256Hex(utf8(text)), await sha256HexOfText(text));
});

test("the hex is lowercase and two characters per byte", async () => {
  assert.equal(hex(new Uint8Array([0x00, 0x0f, 0xff])), "000fff");
  const digest = await sha256Hex(utf8("x"));
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("the digest comparison does not depend on where the difference is", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  assert.equal(equalHex(a, a), true);
  assert.equal(equalHex(a, b), false);
  assert.equal(equalHex(a, "a".repeat(63)), false, "a different length is a difference");
  assert.equal(equalHex(a, "a".repeat(63) + "A"), false);
});
