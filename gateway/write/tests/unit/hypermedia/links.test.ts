/**
 * The next-step links (protocol section 4.4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { nextLinks } from "../../../src/hypermedia/links.ts";

test("every success carries next-step links", () => {
  const links = nextLinks({ op: "index", state: "open", committed: false });
  assert.ok(links.length > 0);
  const rels = links.map((link) => link.rel);
  assert.ok(rels.includes("status"));
  assert.ok(rels.includes("create"));
  assert.ok(rels.includes("commit"));
});

test("a link is root-relative and never carries the capability", () => {
  const links = nextLinks({ op: "read", state: "open", committed: false, path: "intro.md" });
  for (const link of links) {
    assert.ok(link.href.startsWith("/"), link.href);
    assert.equal(link.href.includes("/w1/"), false);
    assert.equal(link.href.includes("sig"), false);
  }
});

test("a link that knows its path carries it, and one that does not says what is required", () => {
  const links = nextLinks({ op: "read", state: "open", committed: false, path: "intro.md" });
  const read = links.find((link) => link.rel === "read");
  assert.ok(read !== undefined);
  assert.equal(read.href, "/read?path=intro.md");

  const append = links.find((link) => link.rel === "append");
  assert.ok(append !== undefined);
  // The agent has to supply the chunk, so the link says which parameters are missing.
  assert.equal(append.href, "/append?path=intro.md");
  assert.deepEqual(append.required, ["path", "seq", "hash", "data"]);
});

test("a seal is not offered before there is a commit", () => {
  const before = nextLinks({ op: "index", state: "open", committed: false });
  assert.equal(before.some((link) => link.rel === "seal"), false);

  const after = nextLinks({ op: "index", state: "open", committed: true });
  assert.equal(after.some((link) => link.rel === "seal"), true);
});

test("a sealed task offers nothing, because the only legal next step is to stop", () => {
  const links = nextLinks({ op: "index", state: "sealed", committed: true });
  assert.deepEqual(links, []);
});

test("a path is percent-encoded in a link", () => {
  const links = nextLinks({ op: "read", state: "open", committed: false, path: "a b.md" });
  const read = links.find((link) => link.rel === "read");
  assert.ok(read !== undefined);
  assert.equal(read.href, "/read?path=a%20b.md");
});
