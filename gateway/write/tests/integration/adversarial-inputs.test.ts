/**
 * The adversarial inputs (plan task 5.5.4).
 *
 * The protocol is an interface with an untrusted caller on the other side of it, so the question
 * this suite answers is: **what does the gateway do with a request that is wrong?**
 *
 * The cases are grouped by what they attack:
 *
 *  - the **path rules** (protocol section 5.1) — the paths an agent sends are the paths the
 *    gateway acts on, and a path that fails a rule is refused by the operation that carries it,
 *    not three steps later at the commit;
 *  - the **task binding** — a capability is bound to one task, and a task's files are not another
 *    task's files;
 *  - the **parameters** — a malformed value is refused, and an unknown parameter is never
 *    ignored;
 *  - the **configuration** — a gateway that is not configured correctly serves nothing;
 *  - the **content** — binary content and content that is too large are refused.
 *
 * The rules come from the contract, and every code asserted here is one the error catalogue
 * defines.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../../src/index.ts";
import {
  MemoryNamespace,
  capabilityFields,
  signedCapability,
  testEnv,
  type Capability,
} from "../helpers/mock-worker.ts";
import { base64url } from "../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../src/util/hash.ts";

const BASE = "https://write.example.internal";

/** The path of a capability. */
function pathOf(capability: Capability): string {
  return (
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`
  );
}

/** A driver over one namespace. */
function driver() {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  return {
    namespace,
    env,
    async get(
      capability: Capability,
      operation: string,
      query?: Record<string, string | undefined> | string,
    ) {
      // A query may be given as a raw string, so that a test can control the encoding exactly:
      // `URLSearchParams` writes a space as `+`, and the contract says a `+` is a literal plus
      // and is never form-decoded.
      const search =
        query === undefined
          ? ""
          : `?${typeof query === "string" ? query : new URLSearchParams(
              Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][],
            ).toString()}`;
      const response = await worker.fetch(
        new Request(`${BASE}${pathOf(capability)}${operation === "" ? "" : `/${operation}`}${search}`),
        env,
      );
      return { response, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

/** The code of a failure. */
function codeOf(body: Record<string, unknown>): string {
  return (body.error as { code: string }).code;
}

// ---------------------------------------------------------------------------
// The path rules
// ---------------------------------------------------------------------------

/** The paths the contract's section 5.1 refuses. */
const BAD_PATHS: [string, string][] = [
  ["", "empty"],
  ["/absolute.md", "absolute"],
  ["a\\b.md", "backslash"],
  ["a//b.md", "an empty component"],
  ["./a.md", "a dot component"],
  ["../escape.md", "a dotdot component"],
  ["a/../../b.md", "a dotdot component in the middle"],
  [".git/config.md", "a hidden component"],
  [".keep", "the placeholder"],
  ["notes/.env", "a hidden component in the middle"],
  ["CON", "a Windows device name"],
  ["notes/trailing.", "a trailing dot"],
  ["notes/trailing ", "a trailing space"],
];

/** The paths the contract's section 5.1 accepts. */
const GOOD_PATHS: string[] = [
  "a.md",
  "notes/na~me.v1..2.md",
  "notes/deep/nested/file.md",
  "dots.in.the.name.v1..2.md",
];

test("a path that fails the path rules is refused by the operation that carries it", async () => {
  for (const [path, why] of BAD_PATHS) {
    const d = driver();
    const { capability } = await signedCapability();

    // Every operation that carries a path refuses it — not only the commit, three steps later.
    for (const operation of ["create", "append", "replace", "read", "delete"]) {
      // The path is percent-encoded on its own, so that a space is a space and not a `+`.
      const encoded = encodeURIComponent(path);
      const query =
        operation === "append" || operation === "replace"
          ? `path=${encoded}&seq=1&hash=${"a".repeat(64)}&data=${base64url(utf8("x\n"))}`
          : `path=${encoded}`;
      const { response, body } = await d.get(capability, operation, query);
      assert.equal(
        response.status,
        400,
        `${operation} of "${path}" (${why}) is refused, not ${response.status}: ${JSON.stringify(body.error)}`,
      );
      assert.equal(codeOf(body), "malformed-path", `${operation} of "${path}" (${why})`);
    }
  }
});

test("a path that satisfies the path rules is accepted", async () => {
  for (const path of GOOD_PATHS) {
    const d = driver();
    const { capability } = await signedCapability();
    const { response, body } = await d.get(capability, "create", { path });
    assert.equal(response.status, 200, `create of "${path}": ${JSON.stringify(body.error)}`);
  }
});

test("a path that fails the path rules takes no quota and leaves no file behind", async () => {
  const d = driver();
  const { capability } = await signedCapability();

  const refused = await d.get(capability, "create", { path: "../escape.md" });
  assert.equal(refused.response.status, 400);

  const status = await d.get(capability, "status", {});
  const files = (status.body.result as { files: unknown[] }).files;
  assert.deepEqual(files, [], "nothing was staged");
  const quota = (status.body.result as { quota: { live_files: number } }).quota;
  assert.equal(quota.live_files, 0, "and no slot was taken");
});

// ---------------------------------------------------------------------------
// The task binding
// ---------------------------------------------------------------------------

test("a task's files are not another task's files", async () => {
  const d = driver();
  const first = (await signedCapability(capabilityFields({ task: "10008-1-001-01" }))).capability;
  const second = (await signedCapability(capabilityFields({ task: "10008-1-002-01" }))).capability;

  await d.get(first, "create", { path: "secret.md" });

  // The second task's read of the first task's file finds nothing.
  const read = await d.get(second, "read", { path: "secret.md" });
  assert.equal(read.response.status, 404);
  assert.equal(codeOf(read.body), "file-not-found");

  // And its own inventory holds nothing.
  const status = await d.get(second, "status", {});
  assert.deepEqual((status.body.result as { files: unknown[] }).files, []);

  // The first task's file is untouched by the second task's attempt.
  const own = await d.get(first, "read", { path: "secret.md" });
  assert.equal(own.response.status, 200);
});

test("a task's files are not another task's files, even with the same writer and the same order", async () => {
  // The same writer and the same order are not enough: the **task** is the unit, and the session
  // is keyed on it.
  const d = driver();
  const first = (await signedCapability(capabilityFields({ task: "10008-1-001-01" }))).capability;
  const second = (await signedCapability(capabilityFields({ task: "10008-1-002-01" }))).capability;

  await d.get(first, "create", { path: "notes.md" });
  const read = await d.get(second, "read", { path: "notes.md" });
  assert.equal(read.response.status, 404);
  assert.equal(codeOf(read.body), "file-not-found");
});

test("a capability cannot be moved to another order or another plan", async () => {
  // The order and the plan are in the signature, so a capability cannot be re-pointed at another
  // order: the signature would not verify.
  const d = driver();
  const { capability } = await signedCapability(capabilityFields({ order: "10008-S001" }));
  const forged = { ...capability, order: "10008-S002" };

  const { response, body } = await d.get(forged, "status", {});
  assert.equal(response.status, 401, "the same body as every other pre-signature failure");
  assert.equal(codeOf(body), "not-authorised");
});

// ---------------------------------------------------------------------------
// The parameters
// ---------------------------------------------------------------------------

test("a malformed parameter is refused, and the code is the catalogue's", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const valid = { path: "a.md", seq: "1", hash: "a".repeat(64), data: base64url(utf8("x\n")) };
  const cases: [string, Record<string, string>, string][] = [
    ["append", { ...valid, seq: "0" }, "invalid-parameter"],
    ["append", { ...valid, seq: "-1" }, "invalid-parameter"],
    ["append", { ...valid, seq: "one" }, "invalid-parameter"],
    ["append", { ...valid, hash: "z".repeat(64) }, "invalid-parameter"],
    ["append", { ...valid, hash: "abc" }, "invalid-parameter"],
    ["append", { ...valid, data: "not%20base64url%21" }, "invalid-parameter"],
    ["seal", { idem: "short" }, "invalid-parameter"],
    ["seal", { idem: "has a space" }, "invalid-parameter"],
    ["commit", { files: "" }, "empty-selection"],
  ];
  for (const [operation, query, code] of cases) {
    const { response, body } = await d.get(capability, operation, query);
    assert.equal(response.status, 400, `${operation} ${JSON.stringify(query)}: ${JSON.stringify(body.error)}`);
    assert.equal(codeOf(body), code, `${operation} ${JSON.stringify(query)}`);
  }
});

test("an unknown parameter is refused, and never ignored", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const { response, body } = await d.get(capability, "status", { nonsense: "1" });
  assert.equal(response.status, 400);
  assert.equal(codeOf(body), "unknown-parameter");
});

test("a repeated parameter is refused", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const response = await worker.fetch(
    new Request(`${BASE}${pathOf(capability)}/read?path=a.md&path=b.md`),
    d.env,
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "repeated-parameter");
});

test("a parameter that tries to choose the destination has its own code", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  for (const name of ["repo", "branch", "folder", "path_prefix"]) {
    const { response, body } = await d.get(capability, "create", { path: "a.md", [name]: "elsewhere" });
    assert.equal(response.status, 400, name);
    assert.equal(codeOf(body), "destination-not-selectable", name);
  }
});

test("a hash that does not match the data is refused", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const bytes = utf8("hello\n");
  const { response, body } = await d.get(capability, "append", {
    path: "a.md",
    seq: "1",
    hash: await sha256Hex(utf8("something else\n")),
    data: base64url(bytes),
  });
  assert.equal(response.status, 400);
  assert.equal(codeOf(body), "hash-mismatch");
});

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

test("a gateway with a missing setting serves nothing and names the setting", async () => {
  for (const setting of [
    "SIGNING_KEYS",
    "SUBMISSIONS_REPO",
    "SUBMISSIONS_BRANCH",
    "SUBMISSIONS_FOLDER_TEMPLATE",
    "GITHUB_TOKEN",
    "OPERATOR_TOKEN",
  ]) {
    const namespace = new MemoryNamespace();
    const env = testEnv(namespace, { [setting]: "" }) as never;
    const response = await worker.fetch(new Request(`${BASE}/healthz`), env);
    assert.equal(response.status, 503, `${setting} is required`);
    const text = await response.text();
    assert.ok(text.includes(setting), `the message names ${setting}: ${text}`);
    assert.ok(!text.includes("test-only-signing-secret"), "the message never carries a value");
  }
});

test("a gateway with a broken setting serves nothing either", async () => {
  const cases: [string, unknown][] = [
    ["SUBMISSIONS_REPO", "not-a-repository"],
    ["SUBMISSIONS_BRANCH", "branch with spaces"],
    ["SUBMISSIONS_FOLDER_TEMPLATE", "plans/{unknown}/{order}"],
    ["SIGNING_KEYS", "not json"],
    ["MAX_TTL_SECONDS", "-1"],
    ["GITHUB_API_BASE", "http://example.com"],
  ];
  for (const [setting, value] of cases) {
    const namespace = new MemoryNamespace();
    const env = testEnv(namespace, { [setting]: value }) as never;
    const response = await worker.fetch(new Request(`${BASE}/healthz`), env);
    assert.equal(response.status, 503, `${setting}=${String(value)} is refused`);
    const text = await response.text();
    assert.ok(text.includes(setting), `the message names ${setting}: ${text}`);
  }
});

// ---------------------------------------------------------------------------
// The content
// ---------------------------------------------------------------------------

test("binary content is refused, with the catalogue's code", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const bytes = new Uint8Array([0x68, 0x69, 0x00, 0x21]);
  const { response, body } = await d.get(capability, "append", {
    path: "a.md",
    seq: "1",
    hash: await sha256Hex(bytes),
    data: base64url(bytes),
  });
  assert.equal(response.status, 400);
  assert.equal(codeOf(body), "not-text", "the policy's own reason is mapped into the catalogue");
});

test("content that is not UTF-8 is refused", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
  const { response, body } = await d.get(capability, "append", {
    path: "a.md",
    seq: "1",
    hash: await sha256Hex(bytes),
    data: base64url(bytes),
  });
  assert.equal(response.status, 400);
  assert.equal(codeOf(body), "not-utf8");
});

test("content that is too large is refused", async () => {
  const d = driver();
  const { capability } = await signedCapability();
  const bytes = utf8("x".repeat(12_289));
  const { response, body } = await d.get(capability, "append", {
    path: "a.md",
    seq: "1",
    hash: await sha256Hex(bytes),
    data: base64url(bytes),
  });
  assert.equal(response.status, 413);
  assert.equal(codeOf(body), "file-too-large");
});
