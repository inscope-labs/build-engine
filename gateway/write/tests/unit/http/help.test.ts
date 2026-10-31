/**
 * The corrective-help links (protocol section 4.3, 4.5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { contractUrl, errorsUrl, helpUrl, originOf } from "../../../src/http/help.ts";
import { ROUTE_CONTRACT, ROUTE_ERRORS, ROUTE_QUOTAS } from "../../../src/config/constants.ts";

test("the origin is taken from the request URL, without a trailing slash", () => {
  assert.equal(originOf("https://write.example.internal/w1/x"), "https://write.example.internal");
  assert.equal(originOf("http://localhost:8787/w1/x"), "http://localhost:8787");
});

test("the contract URL is the versioned canonical one", () => {
  assert.equal(contractUrl("https://write.example.internal"), `https://write.example.internal${ROUTE_CONTRACT}`);
  assert.equal(errorsUrl("https://write.example.internal"), `https://write.example.internal${ROUTE_ERRORS}`);
});

test("a help link points at the catalogue's anchor for the code", () => {
  assert.equal(
    helpUrl("https://write.example.internal", "sequence-conflict"),
    "https://write.example.internal/contract/ctxwrite-v1/errors#sequence-conflict",
  );
});

test("the quota policy is served from a sibling path", () => {
  assert.equal(ROUTE_QUOTAS, "/contract/ctxwrite-v1/quotas");
});
