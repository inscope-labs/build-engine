# Error Catalogue

**Status: normative.** This is the authority for the write gateway's error codes, their HTTP statuses, their
retryability and the corrective action each one implies (plan rule G-11: one authoritative definition of
status/error semantics).

The protocol itself is `ctxwrite-v1`, specified in `gateway/write/docs/protocol.md`. Where this document and
that one disagree, that one is the contract and this one is a defect — but they are expected not to disagree,
because the contract's error handling is stated in terms of the codes defined here.

**Every code in this catalogue is implemented except the ones marked otherwise.** The catalogue is the
specification *and* the description of what the gateway does; the code table in
`src/http/status-codes.ts` is its machine-readable form, and a test checks that the two agree.

## How to read this

| Column | Meaning |
|---|---|
| **Code** | The machine-readable string in `error.code`. **This is the authoritative outcome.** Branch on it, never on the HTTP status alone: two codes may share a status. |
| **Status** | The HTTP status, a coarse bucket. |
| **Retryable** | Whether retrying the same request unchanged can succeed. `false` means the client must change something first. |
| **Means** | What the gateway found. |
| **Do** | What the client should do. This is what the agent's tool prompt and the `help` link both point at. |

Every failure response carries `links.help`, the contract URL with this document's anchor for the code:
`{base}/contract/ctxwrite-v1#errors/<code>`.

Two rules shape the whole catalogue:

- **`401` is "no valid capability was presented."** Malformed path, unknown key id, bad signature, wrong
  method on a capability route — all of these return the *same* status and the *same* body. A caller who
  cannot authenticate learns nothing about which check failed, and in particular cannot tell an expired
  capability from a forged one.
- **`403` and `410` are only reachable after a valid signature.** The caller proved possession of the
  capability, so telling it *why* it may not proceed is safe, and is necessary: an agent that is told "your
  link expired" can ask for a new one, while an agent told "someone else is writing" stops, and an agent told
  "this task is finished" stops differently again.

## The catalogue

### 400 — the request is malformed

The request is well-formed HTTP but not a well-formed operation. All of these are the client's fault, all are
non-retryable without a change, and none of them reveal anything about the task's contents.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="unknown-operation"></a>`unknown-operation` | 400 | no | the operation segment is not one of the ten documented operations | use the `links.next` operations from the index; do not guess |
| <a id="unknown-parameter"></a>`unknown-parameter` | 400 | no | a query parameter is not in the contract for that operation | drop it; the gateway ignores nothing |
| <a id="repeated-parameter"></a>`repeated-parameter` | 400 | no | a parameter appeared more than once, or a path appeared twice in a selection | send it once |
| <a id="empty-selection"></a>`empty-selection` | 400 | no | a commit named no files | name at least one staged file |
| <a id="type-mismatch"></a>`type-mismatch` | 400 | no | the `type` parameter disagrees with the file's extension under the type policy | drop the parameter and let the policy decide, or use the extension's type |
| <a id="hash-mismatch"></a>`hash-mismatch` | 400 | no | the `hash` parameter is not the SHA-256 of the decoded chunk | recompute the hash over the **decoded** bytes, lowercase hex |
| <a id="not-utf8"></a>`not-utf8` | 400 | no | the decoded chunk is not valid UTF-8 | this is a text protocol; send text |
| <a id="not-text"></a>`not-text` | 400 | no | the content is binary by the type policy | this is a text protocol; send text |
| <a id="type-not-allowed"></a>`type-not-allowed` | 400 | no | the file's extension is not in the type policy | use an allowed extension; the refusal names the alternatives |
| <a id="schema-invalid"></a>`schema-invalid` | 400 | no | the content fails the type's optional JSON Schema | fix the content; the failing pointer is in the help link |
| <a id="empty-not-allowed"></a>`empty-not-allowed` | 400 | no | the type policy forbids an empty file for this type | write content, or use a type that allows it |
| <a id="destination-not-selectable"></a>`destination-not-selectable` | 400 | no | the request tried to name a repository, a branch or a task folder | the destination comes from the capability; remove the parameter |
| <a id="malformed-path"></a>`malformed-path` | 400 | no | the path fails the path rules | fix the path; the rules are in the contract's path rules, section 5.1 |
| <a id="invalid-parameter"></a>`invalid-parameter` | 400 | no | a required parameter is missing, or a value does not have the required form | send the parameter; the message says which one and what it must look like |

A `malformed-path` refusal means the path failed one of the **path rules** in the contract's section 5.1. A path
is relative to the task folder, and the scheme performs no normalisation: a path is either already canonical and is
accepted exactly as written, or it is refused. The rules are in the contract, and the contract is the authority —
this catalogue does not repeat them, so that there is one place to change.

### 401 — no valid capability

One body, one status, for every failure before the signature is verified.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="not-authorised"></a>`not-authorised` | 401 | no | the path does not parse as a capability, or the key id is unknown, or the signature is invalid, or the method is not GET | nothing useful: check that the capability URL was copied whole, or ask the operator for a new one |

### 403 — a valid capability that may not proceed

Reachable only with a valid signature, so the details may be given.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="capability-expired"></a>`capability-expired` | 403 | no | `now > exp` | stop; ask the operator for a new capability. The boundary is inclusive: it worked at exactly `exp` |
| <a id="ttl-exceeded"></a>`ttl-exceeded` | 403 | no | the capability's lifetime is longer than the gateway's `max_ttl` | ask the operator to mint one with a shorter lifetime |
| <a id="not-permitted"></a>`not-permitted` | 403 | no | the operation is not permitted for this session | read `state` in the response; it says which transition closed it |

### 404 — after a valid capability, something is not there

Reachable only with a valid signature, so it discloses nothing to a caller who has not proved possession.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="file-not-found"></a>`file-not-found` | 404 | no | the path is not a staged file in this session | `status` for the inventory; create it first |
| <a id="task-folder-missing"></a>`task-folder-missing` | 404 | no | the task folder does not exist on the submissions branch | stop; the **operator** must create the folder (with its `.keep` placeholder) before the task can commit |

### 405 — wrong method

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="method-not-allowed"></a>`method-not-allowed` | 405 | no | the request was not a GET | this is a GET-only protocol; the response carries `Allow: GET` |

### 409 — a conflict with the current state

The request is well formed but disagrees with the session. These are the errors an agent meets in normal use,
and each one says what to do next.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="writer-conflict"></a>`writer-conflict` | 409 | yes, after the other writer finishes | another writer holds the task's lease | **stop**. You are not the writer. Do not retry in a loop |
| <a id="path-exists"></a>`path-exists` | 409 | no | `create` on a path whose content is present | use `replace` to change it, or `delete` then `create` |
| <a id="sequence-gap"></a>`sequence-gap` | 409 | no | `seq` is more than one past the last accepted sequence number | re-read `status` for the last `seq` and continue from there |
| <a id="sequence-conflict"></a>`sequence-conflict` | 409 | no | `seq` is at or before the last accepted one, but the hash does not match the recorded one, or the replay window no longer holds it | re-read the file with `read` and continue from its `last_seq` |
| <a id="idempotency-conflict"></a>`idempotency-conflict` | 409 | no | the same idempotency key was used with a different payload | **stop**; a previous attempt exists. Adjust staging and use a new key |
| <a id="file-not-staged"></a>`file-not-staged` | 409 | no | a selected path is not a live staged file, or was tombstoned, or was lost to eviction | `status` for the inventory; re-stage what is missing and commit again |
| <a id="file-count-exceeded"></a>`file-count-exceeded` | 409 | no | the task already holds the maximum number of live files | `delete` a file you do not need; a tombstone frees its slot |
| <a id="expected-sha-conflict"></a>`expected-sha-conflict` | 409 | no | the submissions branch has moved since the capability was minted | **stop**; a commit happened. Ask the operator to re-mint against the new head |
| <a id="seal-requires-commit"></a>`seal-requires-commit` | 409 | no | `seal` was called before any successful commit | commit first, then seal |
| <a id="reconcile-required"></a>`reconcile-required` | 409 | no | the gateway cannot determine whether an earlier commit succeeded | **stop**; ask the operator. Do not retry: a retry could produce a second commit |
| <a id="not-implemented"></a>`not-implemented` | 501 | no | a route that is specified but not yet implemented | **not currently produced**: every route the contract defines is implemented. It stays in the catalogue so that a 501 is never confused with a protocol error |

### 410 — the task's write path is closed

The three closed states are distinct, because the operator's response to each is different.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="task-sealed"></a>`task-sealed` | 410 | no | the agent sealed the folder; the task is complete | stop; the deliverable is delivered |
| <a id="task-revoked"></a>`task-revoked` | 410 | no | the operator revoked the capability | stop; ask the operator why |
| <a id="order-closed"></a>`order-closed` | 410 | no | the operator closed the work order | stop; the work order is over |

### 413 — a size quota

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="file-too-large"></a>`file-too-large` | 413 | no | the chunk would take one file over the per-file limit | split the content across chunks with `append`, or shrink it |
| <a id="total-bytes-exceeded"></a>`total-bytes-exceeded` | 413 | no | the chunk would take the task over the total-bytes limit | `delete` a file you do not need; a tombstone frees its bytes |

### 429 — a rate quota

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="rate-limited"></a>`rate-limited` | 429 | yes, after `Retry-After` | too many requests in the rate window | wait for the `Retry-After` seconds, then retry |
| <a id="provider-rate-limited"></a>`provider-rate-limited` | 429 | yes, with backoff | the **provider** is rate limiting the gateway, not the agent | wait and retry; the gateway's own limit is not the thing that was hit |

### 502 — the provider refused

The gateway reached the provider and the provider said no. These are not the gateway's own failures, and the
distinction is the operator's first question: a `502` means the gateway is healthy and the far side is not
answering, or is answering wrongly.

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="provider-rejected"></a>`provider-rejected` | 502 | no | the provider refused the request in a way the gateway cannot map more precisely | ask the operator; the provider's own answer is never shown to the agent |
| <a id="provider-credential-invalid"></a>`provider-credential-invalid` | 502 | no | the provider refused the gateway's credential | ask the operator; the credential has to be fixed, and a retry cannot fix it |

### 503 — the gateway cannot serve the request

| Code | Status | Retryable | Means | Do |
|---|---|---|---|---|
| <a id="gateway-misconfigured"></a>`gateway-misconfigured` | 503 | no, until the operator fixes it | the gateway's configuration is missing or invalid; it has failed closed and served nothing | ask the operator; the message names the setting, and never a secret |
| <a id="state-unavailable"></a>`state-unavailable` | 503 | yes, with backoff | the Durable Object could not be reached or read | retry with backoff; if it persists, ask the operator |
| <a id="provider-unavailable"></a>`provider-unavailable` | 503 | yes, with backoff | the provider did not complete the request: a timeout, a network failure, or a 5xx it retried | retry with backoff; if it persists, ask the operator |

`state-unavailable` is the read gateway's fail-closed behaviour applied to the write gateway: when the state
channel cannot be read, the gateway **fails closed** and serves nothing. It never falls back to "allow".

## Codes that must never appear

A response MUST NOT contain any of the following, in any field, in any status:

- the capability prefix, in whole or in part;
- the raw query string, or a query value echoed verbatim;
- the decoded or encoded payload, or any fragment of file content;
- the signature, the signing secret, the `kid`, or the expected head;
- the GitHub credential, the repository, the branch, or a provider's response body;
- an absolute path on the runtime.

The error body is built field by field from the envelope schema for exactly this reason. A field that is not in
the schema has no path into the body.
