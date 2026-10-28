/**
 * The error type and the envelope (plan task 5.5.2: the error mapping).
 *
 * A failure carries a **code**, and the code is the authoritative outcome: the status, the
 * retryability and the help link are all derived from it. The catalogue in
 * `src/http/status-codes.ts` is the authority, and `src/http/errors.ts` is the typed form of it.
 *
 * Two properties are checked here:
 *
 *  - a `GatewayError` and the catalogue can never disagree about the status, because the error
 *    takes its status **from** the catalogue;
 *  - the envelope is built from a fixed schema, so a value that is not in the schema has no path
 *    into the body. That is what keeps a capability, a payload or a provider error out of a
 *    response (protocol section 10.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GatewayError,
  NOT_AUTHORISED_MESSAGE,
  fail,
  isGatewayError,
  notAuthorised,
} from "../../../src/http/errors.ts";
import { envelope, errorResponse, jsonResponse } from "../../../src/http/responses.ts";
import { errorSpec, isKnownCode } from "../../../src/http/status-codes.ts";
import { PROTOCOL } from "../../../src/config/constants.ts";

test("an error takes its status and its retryability from the catalogue", () => {
  const error = fail("writer-conflict", "another writer holds this task");
  assert.equal(error.code, "writer-conflict");
  assert.equal(error.status, 409);
  assert.equal(error.retryable, false);
  assert.equal(error.status, errorSpec("writer-conflict").status);

  const retryable = fail("rate-limited", "too many requests");
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.status, 429);
});

test("a failure carries its code, its message and its retryability into the body", () => {
  const body = fail("file-not-found", "no such staged file").toBody();
  assert.deepEqual(body, {
    code: "file-not-found",
    message: "no such staged file",
    retryable: false,
  });
});

test("an unknown code is a server fault, not a code that does not exist", () => {
  const error = fail("no-such-code", "something went wrong");
  assert.equal(error.status, 500, "an unknown code is a 500");
  assert.equal(error.retryable, false);
  assert.equal(isKnownCode("no-such-code"), false);
  assert.equal(isKnownCode("writer-conflict"), true);
});

test("a pre-signature failure is one code and one message", () => {
  const error = notAuthorised();
  assert.equal(error.code, "not-authorised");
  assert.equal(error.status, 401);
  assert.equal(error.message, "not authorised");
  assert.equal(NOT_AUTHORISED_MESSAGE, "not authorised\n");
});

test("a plain error is not a gateway error", () => {
  assert.equal(isGatewayError(fail("not-authorised", "x")), true);
  assert.equal(isGatewayError(new Error("x")), false);
  assert.equal(isGatewayError("x"), false);
  assert.equal(isGatewayError(null), false);
  assert.ok(new GatewayError("not-authorised", "x") instanceof Error);
});

test("the envelope has the contract's shape, and only that shape", () => {
  const body = envelope({
    op: "status",
    task: "10008-1-001-01",
    order: "10008-S001",
    state: "open",
    result: { files: [] },
    next: [],
    error: null,
    base: "https://write.example.internal",
  });

  assert.deepEqual(Object.keys(body).sort(), [
    "error",
    "links",
    "op",
    "order",
    "protocol",
    "result",
    "state",
    "task",
  ]);
  assert.equal(body.protocol, PROTOCOL);
  assert.equal(body.error, null);
  assert.equal(body.links.help, undefined, "a success carries no help link");
  assert.equal(body.links.contract, "https://write.example.internal/contract/ctxwrite-v1");
});

test("a failure carries a help link, and a success does not", () => {
  const failed = envelope({
    op: "read",
    task: "10008-1-001-01",
    order: "10008-S001",
    state: "open",
    result: null,
    next: [],
    error: { code: "file-not-found", message: "no such staged file", retryable: false },
    base: "https://write.example.internal",
  });
  assert.equal(failed.links.help, "https://write.example.internal/contract/ctxwrite-v1/errors#file-not-found");
});

test("a failure response has no result and no next steps", async () => {
  const response = errorResponse("req-3", 409, {
    op: "read",
    task: null,
    order: null,
    state: null,
    base: "https://write.example.internal",
    error: { code: "not-authorised", message: "not authorised", retryable: false },
  });
  const body = (await response.json()) as {
    result: unknown;
    links: { next: unknown[] };
    error: { code: string } | null;
  };
  assert.equal(body.result, null, "a failure carries no result");
  assert.deepEqual(body.links.next, [], "a failure offers no next steps");
  assert.equal(body.error?.code, "not-authorised");
});

test("the JSON response carries the no-store headers and the request id", () => {
  const response = jsonResponse("req-1", 200, {
    protocol: PROTOCOL,
    op: "index",
    task: null,
    order: null,
    state: null,
    result: null,
    links: { contract: "https://write.example.internal/contract/ctxwrite-v1", next: [] },
    error: null,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Request-Id"), "req-1");
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.match(response.headers.get("Pragma") ?? "", /no-cache/);
});

test("a failure response uses the failure's own status", () => {
  const response = errorResponse("req-2", 409, {
    op: "commit",
    task: "10008-1-001-01",
    order: "10008-S001",
    state: "open",
    base: "https://write.example.internal",
    error: { code: "writer-conflict", message: "another writer holds this task", retryable: false },
  });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("X-Request-Id"), "req-2");
});
