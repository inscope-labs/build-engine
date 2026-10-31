/**
 * The TypeScript port of the scheme must reproduce the shared vectors exactly.
 *
 * This is the "any implementation must reproduce the signing vectors" requirement, applied to
 * the production port. The vectors are read from conformance/signing-vectors.json, which is the
 * same file the Python client is checked against, so the two ports cannot drift apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SCHEME,
  base64url,
  canonicalMessage,
  decodeSegment,
  encodePath,
  encodeSegment,
  isKid,
  isOrder,
  isRef,
  isSafePath,
  mint,
  parseLink,
  sign,
  verifySignature,
} from "../../src/scheme.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(
  readFileSync(resolve(HERE, "../../../../../conformance/signing-vectors.json"), "utf-8"),
) as {
  scheme: string;
  vectors: { id: string; name: string; secret: string; kid: string; exp: number; order: string; ref: string; path: string; message: string; message_hex: string; signature: string; url_path: string }[];
  invalid: { id: string; name: string; field: string; value: string; rule: string }[];
};

test("the scheme constant is the one the vectors describe", () => {
  assert.equal(SCHEME, VECTORS.scheme);
  assert.equal(SCHEME, "ctxgate-v1");
});

test("every valid vector is reproduced byte for byte", async () => {
  for (const v of VECTORS.vectors) {
    const message = canonicalMessage(v.kid, v.exp, v.order, v.ref, v.path);
    assert.equal(Buffer.from(message).toString("hex"), v.message_hex, `${v.id} message bytes`);
    assert.equal(new TextDecoder().decode(message), v.message, `${v.id} message`);
    const signature = await sign(v.secret, v.kid, v.exp, v.order, v.ref, v.path);
    assert.equal(signature, v.signature, `${v.id} (${v.name}) signature`);
  }
});

test("every valid vector verifies", async () => {
  for (const v of VECTORS.vectors) {
    assert.equal(
      await verifySignature(v.secret, v.kid, v.exp, v.order, v.ref, v.path, v.signature),
      true,
      `${v.id} should verify`,
    );
  }
});

test("a tampered field never verifies", async () => {
  const v = VECTORS.vectors[0]!;
  assert.equal(await verifySignature(v.secret, v.kid, v.exp, v.order, v.ref, v.path, "A".repeat(43)), false);
  assert.equal(await verifySignature("other", v.kid, v.exp, v.order, v.ref, v.path, v.signature), false);
  assert.equal(await verifySignature(v.secret, "k2", v.exp, v.order, v.ref, v.path, v.signature), false);
  assert.equal(await verifySignature(v.secret, v.kid, v.exp + 1, v.order, v.ref, v.path, v.signature), false);
  assert.equal(await verifySignature(v.secret, v.kid, v.exp, v.order + "X", v.ref, v.path, v.signature), false);
  assert.equal(await verifySignature(v.secret, v.kid, v.exp, v.order, "b".repeat(40), v.path, v.signature), false);
  assert.equal(await verifySignature(v.secret, v.kid, v.exp, v.order, v.ref, v.path + "X", v.signature), false);
});

test("every invalid input is refused", async () => {
  for (const v of VECTORS.invalid) {
    const kid = v.field === "kid" ? v.value : "k1";
    const order = v.field === "order" ? v.value : "10008-S001";
    const ref = v.field === "ref" ? v.value : "a".repeat(40);
    const path = v.field === "path" ? v.value : "amk/spec.md";
    // mint() validates before it signs, exactly as ctxlink.mint does in Python.
    let refused = false;
    try {
      await mint("test-secret", kid, 2000000000, order, ref, path);
    } catch {
      refused = true;
    }
    assert.equal(refused, true, `${v.id} (${v.name}) must be refused: ${v.rule}`);
  }
});

test("the field rules refuse what Python refuses", () => {
  assert.equal(isKid("k1"), true);
  assert.equal(isKid("k 1"), false);
  assert.equal(isKid(""), false);
  assert.equal(isKid("k".repeat(17)), false);
  assert.equal(isKid("k1\n"), false, "a trailing newline must not slip through");

  assert.equal(isOrder("10008-S001"), true);
  assert.equal(isOrder("-lead"), false);
  assert.equal(isOrder("has space"), false);
  assert.equal(isOrder("o".repeat(65)), false);
  assert.equal(isOrder("order\n"), false);

  assert.equal(isRef("a".repeat(40)), true);
  assert.equal(isRef("A".repeat(40)), false, "the ref must be lowercase hex");
  assert.equal(isRef("a".repeat(39)), false);
  assert.equal(isRef("a".repeat(40) + "\n"), false);
});

test("the path rules accept what Python accepts", () => {
  assert.equal(isSafePath("notes/na~me.v1..2.md"), true, "'..' inside a component is legal");
  assert.equal(isSafePath(".hidden.md"), true);
  assert.equal(isSafePath("a+b.md"), true);
  assert.equal(isSafePath("dir with space/é.md"), true);
  assert.equal(isSafePath("../x"), false);
  assert.equal(isSafePath("/abs"), false);
  assert.equal(isSafePath("a//b"), false);
  assert.equal(isSafePath("a/./b"), false);
  assert.equal(isSafePath("a\\b"), false);
  assert.equal(isSafePath(""), false);
  assert.equal(isSafePath("a\nb"), false, "control characters are refused");
  assert.equal(isSafePath("a\x00b"), false);
});

test("the URL form is canonical", () => {
  assert.equal(encodeSegment("a b"), "a%20b");
  assert.equal(encodeSegment("a+b"), "a%2Bb");
  assert.equal(encodeSegment("100%"), "100%25");
  assert.equal(encodeSegment("é"), "%C3%A9");
  assert.equal(encodeSegment("~-_."), "~-_.");
  assert.equal(encodePath("dir with space/é.md"), "dir%20with%20space/%C3%A9.md");
});

test("segments are percent-decoded, never form-decoded", () => {
  assert.equal(decodeSegment("a%20b"), "a b");
  assert.equal(decodeSegment("a%2Bb"), "a+b");
  assert.equal(decodeSegment("a+b"), "a+b", "a literal plus stays a plus");
  assert.equal(decodeSegment("%C3%A9"), "é");
  assert.equal(decodeSegment("100%25"), "100%");
  assert.equal(decodeSegment("%zz"), "%zz", "an invalid escape is left alone");
});

test("parseLink refuses what it must", () => {
  const ok = parseLink("/v1/k1/2000000000/10008-S001/" + "A".repeat(43) + "/" + "a".repeat(40) + "/amk/spec.md");
  assert.equal(ok.ok, true);

  assert.equal(parseLink("/v1/k1/2000000000/10008-S001/AAAA/amk/spec.md").ok, false, "too few segments");
  assert.equal(parseLink("/v2/k1/1/o/sig/ref/amk/spec.md").ok, false, "wrong version");
  assert.equal(parseLink("/v1/k1/2000000000/10008-S001/AAAA/ref/amk%2Fspec.md").ok, false, "encoded separator");
  assert.equal(parseLink("/v1/k1/2000000000/10008-S001/AAAA/ref/amk/spec%00.md").ok, false, "NUL byte");
  assert.equal(parseLink("/v1/k1/not-a-number/10008-S001/AAAA/ref/amk/spec.md").ok, false, "exp is not a number");
  assert.equal(parseLink("/v1/k1/2000000000/10008-S001/AAAA/ref/amk/../spec.md").ok, false, "a '..' component");
});

test("mint reproduces the URL form of the vectors", async () => {
  for (const v of VECTORS.vectors) {
    const m = await mint(v.secret, v.kid, v.exp, v.order, v.ref, v.path);
    assert.equal(m.signature, v.signature, `${v.id} signature`);
    assert.equal(m.urlPath, v.url_path, `${v.id} url path`);
  }
});

test("base64url round trips without padding", () => {
  const bytes = new Uint8Array(32).map((_, i) => i);
  const encoded = base64url(bytes);
  assert.equal(encoded.includes("="), false);
  assert.equal(encoded.length, 43);
});
