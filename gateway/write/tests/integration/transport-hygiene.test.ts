/**
 * Transport hygiene (plan task 5.4.3, protocol section 10.1).
 *
 * The contract's mitigations for a mutating GET are all things the gateway does at the edge, and
 * all of them are checkable:
 *
 *  - **no caching** — every response carries `no-store` and the rest of the set;
 *  - **no redirects** — the gateway MUST NOT answer with a 3xx on any route, because a redirect
 *    would turn a mutating GET into a second request;
 *  - **no referrer leakage** — `no-referrer`, because the capability is in a path;
 *  - **no content sniffing, no indexing**;
 *  - **no echo** — a failure response must not contain the query string or any value the client
 *    supplied.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryNamespace, capabilityFields, signedCapability, testEnv, type Capability } from "../helpers/mock-worker.ts";

const BASE = "https://write.example.internal";

/** Every route, with a request that reaches it. */
async function routes(): Promise<{ name: string; response: Response }[]> {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  const { default: worker } = await import("../../src/index.ts");
  const { capability } = await signedCapability(capabilityFields());

  const path = (cap: Capability, operation?: string): string =>
    `/w1/${cap.kid}/${cap.exp}/${cap.order}/${cap.plan}` +
    `/${cap.task}/${cap.writer}/${cap.head}/${cap.sig}${operation ?? ""}`;

  const cases: [string, Request][] = [
    ["the contract document", new Request(`${BASE}/contract/ctxwrite-v1`)],
    ["the error catalogue", new Request(`${BASE}/contract/ctxwrite-v1/errors`)],
    ["the quotas", new Request(`${BASE}/contract/ctxwrite-v1/quotas`)],
    ["the health endpoint", new Request(`${BASE}/healthz`)],
    ["the index", new Request(`${BASE}${path(capability)}`)],
    ["the status", new Request(`${BASE}${path(capability, "/status")}`)],
    ["a refusal", new Request(`${BASE}/w1/nonsense`)],
    ["the operator channel, unauthorised", new Request(`${BASE}/admin/metrics`)],
  ];

  const out: { name: string; response: Response }[] = [];
  for (const [name, request] of cases) {
    out.push({ name, response: await worker.fetch(request, env) });
  }
  return out;
}

test("every response carries the whole no-store header set", async () => {
  for (const { name, response } of await routes()) {
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0, must-revalidate", name);
    assert.equal(response.headers.get("CDN-Cache-Control"), "no-store", name);
    assert.equal(response.headers.get("Pragma"), "no-cache", name);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", name);
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer", name);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive", name);
    assert.ok(response.headers.get("X-Request-Id") !== null, name);
  }
});

test("no route ever answers with a redirect", async () => {
  for (const { name, response } of await routes()) {
    assert.ok(response.status < 300 || response.status >= 400, `${name} answered ${response.status}`);
    assert.equal(response.headers.get("Location"), null, name);
  }
});

test("the responses are not documents: no HTML, and nothing a browser would fetch", async () => {
  for (const { name, response } of await routes()) {
    const type = response.headers.get("Content-Type") ?? "";
    assert.ok(
      type.startsWith("application/json") || type.startsWith("text/plain") || type.startsWith("text/markdown"),
      `${name} answered ${type}`,
    );
    const body = await response.text();
    assert.ok(!/<html|<script|<form/i.test(body), name);
  }
});

test("a failure body contains neither the query string nor a value the client supplied", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  const { default: worker } = await import("../../src/index.ts");
  const { capability } = await signedCapability(capabilityFields());

  const secretish = "sentinel-query-value-0123456789";
  const path =
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

  // A parameter the operation does not define, a repeated parameter, a parameter that tries to
  // choose the destination, and a missing one. Each is a failure, and each must not echo.
  const failures = [
    `${path}/status?${secretish}=1`,
    `${path}/status?${secretish}=1&${secretish}=2`,
    `${path}/commit?files=a.md&branch=main`,
    `${path}/commit`,
  ];
  for (const failure of failures) {
    const response = await worker.fetch(new Request(`${BASE}${failure}`), env);
    assert.ok(response.status >= 400, failure);
    const body = await response.text();
    assert.ok(!body.includes(secretish), `the failure echoed the query value: ${failure}`);
    assert.ok(!body.includes("?"), "the failure echoed a query string");
  }
});

test("the capability path is never echoed in a response", async () => {
  const namespace = new MemoryNamespace();
  const env = testEnv(namespace) as never;
  const { default: worker } = await import("../../src/index.ts");
  const { capability } = await signedCapability(capabilityFields());

  const path =
    `/w1/${capability.kid}/${capability.exp}/${capability.order}/${capability.plan}` +
    `/${capability.task}/${capability.writer}/${capability.head}/${capability.sig}`;

  for (const suffix of ["", "/status", "/read?path=intro.md"]) {
    const response = await worker.fetch(new Request(`${BASE}${path}${suffix}`), env);
    const body = await response.text();
    assert.ok(!body.includes(capability.sig), "the response echoed the signature");
    assert.ok(!body.includes("/w1/"), "the response echoed the capability prefix");
  }
});
