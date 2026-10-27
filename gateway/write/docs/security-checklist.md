# Security Checklist

**Status: the contract's security requirements, collected. The Phase 6 sign-off is Stage 6, and it requires a
deployed gateway and evidence that these requirements hold at runtime.**

Stage 5.1 specified the security properties of the write protocol. This file gathers them in one place so that
the Phase 6 sign-off has a list to check. It is a **pointer**, not a second source of truth: every row names
the section of the contract that states the rule, and the contract is where the rule lives.

| # | Requirement | Contract |
|---|---|---|
| 1 | The root URL is a bearer capability; it authenticates the holder and nothing else | 2.2 |
| 2 | The capability authenticates in the **path**, never in the query string, so a query-stripping proxy still works | 2.1 |
| 3 | The signature is a domain-separated HMAC (`ctxwrite-v1`), constant-time compared, and distinct from the read scheme's `ctxgate-v1` | 3.2, 3.11 |
| 4 | Every capability field is bound into the signature: kid, exp, order, plan, task, writer, head | 3.10 |
| 5 | The signature is verified **before** expiry, lifetime, revocation and policy, so a forgery learns nothing | 14.3 |
| 6 | All pre-signature failures return the **same** status and the **same** body | 9 |
| 7 | The expiry is inclusive at the boundary and enforced by the gateway's own clock, with a maximum TTL the minter cannot exceed | 3.4 |
| 8 | The task folder is **derived** from the signed ids and the configured template; no request can choose a repository, a branch or a path | 2.4, 12.2 |
| 9 | Paths are validated without normalisation: no `..` component, no hidden component, no control characters, no reserved names | 5.1 |
| 10 | `..` as a **substring** is a legal file name; only a component that is exactly `..` is refused | 5.1 |
| 11 | One writer per task, enforced by a durable lease; a second writer is refused | 2.5 |
| 12 | The agent never holds a repository credential; the gateway holds it and never exposes it | 1, 12.1 |
| 13 | The gateway's credential is scoped to the **submissions repository only** and cannot reach the consumer repository | 12.1 |
| 14 | The residual risk of a repository-scoped (not path-scoped) credential is stated plainly, not minimised | 12.4 |
| 15 | The gateway never creates a repository, a branch or a folder, and never merges or publishes upstream | 8.1, 12.1 |
| 16 | The commit parent is the expected head pinned in the capability; a moved branch is refused | 3.9, 8.1 |
| 17 | Content is text only, UTF-8 only, allow-listed by extension, and size-capped at write time | 7.2 |
| 18 | Staged content is never written to durable storage, disk or a third-party object store | ADR 0002 |
| 19 | Every response is `no-store`, with no redirects, `nosniff`, `no-referrer` and `noindex` | 10.1 |
| 20 | No response body contains the capability, the query string, the payload, the signature, the token, or the repository | 10.3 |
| 21 | Links are root-relative and never echo the capability | 4.4 |
| 22 | The audit record is built field by field from a fixed schema; a secret has no path into it | 11 |
| 23 | The audit is tested by sentinel injection | 5.5.6 |
| 24 | The operator channel has its own credential, separate from the signing keys | 10.4 |
| 25 | The state channel fails **closed**: if the Durable Object cannot be read, the gateway serves nothing | 13, 9 |
| 26 | Quotas count live state, so an eviction cannot be used to inflate the deliverable | 7.1 |
| 27 | Deployment defaults are pinned: no `workers.dev`, explicit routes, secrets out of the repository | 12.5 |
| 28 | Deployment credentials are absent from pull-request jobs | 12.5 |
| 29 | The gateway never echoes a provider's error body | 10.3 |
| 30 | The gateway's own health and admin routes are not reachable by the agent | 10.4 |

## What Stage 5.2 implemented

Of the thirty requirements above, the ones that belong to the core request and session lifecycle are
implemented and tested. The rest are Stage 5.3, 5.4 or 5.5.

## What Stage 5.3 implemented

The delivery. These are the requirements the commit path owns.

| # | Requirement | Stage 5.3 |
|---|---|---|
| 8 | the task folder is derived, never supplied | implemented: the folder comes from the template and the signed ids, and the commit resolves every selected path **inside** it; a path that would resolve outside is refused |
| 12 | the agent never holds a repository credential | implemented: the credential is a Worker secret, read by the Durable Object at the point of use and never written into a response, a log line or an audit record |
| 13 | the credential is scoped to the submissions repository | implemented in the code: the client has no parameter that could name another repository or another branch. The **scope of the token itself** is still the operator's, and `scripts/check-token-scope.ts` is Stage 5.5 |
| 15 | the gateway never creates or merges anything | implemented and tested: the client has no method that creates a repository, a branch or a folder, merges, opens a pull request, deletes, or force-pushes. The ref update is `force: false` |
| 16 | the commit parent is the expected head | implemented and tested: the branch head is read before anything is created and compared with the capability's `head`; a moved branch is `409 expected-sha-conflict` |
| 20 | no response body contains the capability, the query, the payload or the credential | implemented: the provider's status and body are never read, and the gateway's own codes replace them |
| 22 | the audit record is built field by field from a fixed schema | implemented: the commit's sha and the digest of its selection are two named fields; the selected **paths** are not in the audit record, only in the session's commit record |
| 29 | the gateway never echoes a provider's error body | implemented and tested: the provider's body is never read, and the client asserts that its error message does not quote it |
| — | the gateway never guesses whether a commit happened | implemented and tested: a delivery whose outcome is unknown is resolved by **looking at the branch**, and the answer is `409 reconcile-required` — never a second commit |
| — | the commit writes only the selected files | implemented and tested: the tree is the base tree plus the selected files, and the rest of the repository is carried over untouched |
| — | the folder is not created by the gateway | implemented and tested: the commit walks the tree to the task folder first, and refuses with `404 task-folder-missing` when it is not there |

| # | Requirement | Stage 5.2 |
|---|---|---|
| 1 | the root URL is a bearer capability | implemented and documented |
| 2 | the capability authenticates in the path | implemented |
| 3 | the signature is domain-separated and constant-time compared | implemented, and the read side's separator cannot be replayed against it |
| 4 | every capability field is bound into the signature | implemented |
| 5 | the signature is verified before expiry, lifetime and revocation | implemented, in that order |
| 6 | all pre-signature failures return the same status and body | implemented and tested |
| 7 | the expiry is inclusive and the maximum TTL is enforced | implemented and tested |
| 8 | the task folder is derived, never supplied | implemented; a request that tries is refused with `destination-not-selectable` |
| 9 | paths are validated without normalisation | implemented and tested, including the `..`-as-a-substring case |
| 10 | `..` as a substring is a legal file name | implemented and tested |
| 11 | one writer per task, enforced by a durable lease | implemented and tested |
| 12 | the agent never holds a repository credential | implemented: the credential is a Worker secret |
| 13 | the credential is scoped to the submissions repository | configured; the scope itself is the operator's (Stage 5.3 checks it) |
| 14 | the residual risk of a repository-scoped credential is stated plainly | documented |
| 15 | the gateway never creates or merges anything | implemented for everything Stage 5.2 owns; the commit path is Stage 5.3 |
| 16 | the commit parent is the expected head | specified and bound into the capability; the check is Stage 5.3 |
| 17 | text only, UTF-8, allow-listed, size-capped at write time | implemented and tested |
| 18 | staged content is never written to durable storage | implemented: the contents live in the instance's memory only |
| 19 | every response is no-store, with no redirects | implemented and tested |
| 20 | no response body contains the capability, the query or the payload | implemented: the envelope is built field by field, and the links are root-relative |
| 21 | links are root-relative and never echo the capability | implemented and tested |
| 22 | the audit record is built field by field from a fixed schema | implemented and tested with sentinels |
| 23 | the audit is tested by sentinel injection | the redaction unit test is the sentinel injection; the full capture test is Stage 5.5.6 |
| 24 | the operator channel has its own credential | implemented and tested |
| 25 | the state channel fails closed | implemented: an unreadable session answers `503 state-unavailable` and serves nothing |
| 26 | quotas count live state | implemented and tested |
| 27 | the deployment defaults are pinned | `workers_dev = false` is set; the routes and the environments are Stage 5.4.6 |
| 28 | deployment credentials are absent from pull-request jobs | Stage 5.5.8 |
| 29 | the gateway never echoes a provider's error body | implemented for everything Stage 5.2 owns; the provider mapping is Stage 5.3 |
| 30 | the health and admin routes are not reachable by the agent | implemented: they are a separate namespace with a separate credential |

## What Stage 5.4 implemented

The audit, the privacy and the operations.

| # | Requirement | Stage 5.4 |
|---|---|---|
| 20 | no response body contains the capability, the query, the payload or the credential | implemented: a failure body names a parameter only when the **contract** defines it, never one the client invented; the provider's body is never read |
| 22 | the audit record is built field by field from a fixed schema | implemented and hardened: the Durable Object that holds the durable stream **rebuilds** every record from the fields it is handed, through the same gate, and refuses a record that still looks like it holds a secret |
| 23 | the audit is tested by sentinel injection | implemented: the sentinels are planted in the signing secret, the provider token, the operator token, the capability, the signature, the file's content, its base64 and a file name, and the gateway is driven through the whole protocol and the failure paths with them in place. The same driver backs the test and the deploy gate |
| 29 | the gateway never echoes a provider's error body | implemented and tested: the body is not read, and the client asserts that its error message does not quote it |
| 25 | the state channel fails closed | implemented, and the audit channel fails the same way: an unreadable audit stream answers `503` and serves nothing |
| 27 | the deployment defaults are pinned | implemented: `workers_dev = false`, the secrets are `wrangler secret put`, and the deployment workflow holds no credential in a pull-request-triggered job |
| 28 | deployment credentials are absent from pull-request jobs | implemented **and checked**: the deploy gate reads every workflow and fails if one that a pull request can trigger references a deployment credential. The deploy workflow is triggered by a push to `main` or by hand, and its credentials come from a protected environment |

## What is checked, and when

| Check | Stage |
|---|---|
| the signing vectors, valid and invalid | 5.5.2 |
| the path rules, including the `..`-substring case and the encoding cases | 5.5.4 |
| the sequence, replay and idempotency rules | 5.5.2, 5.5.4 |
| the quota, type and size rules | 5.5.4 |
| the cross-task access attempts | 5.5.4 |
| the response headers, the redirects and the caches | 5.4.3, 5.5.4 |
| the log hygiene, by sentinel injection | 5.5.6 |
| the credential scope, by checking the configured repository against the token's scope | 5.5 (`scripts/check-token-scope.ts`) |
| the eviction, restart and "committed but the response was lost" recovery | 5.5.5 |
| the concurrent writers and the quota boundary | 5.5.7 |
| the CI gates that run all of the above on a pull request | 5.5.8 |
| the deploy gate: the sentinel injection, the static credential scan, the logging check and the workflow check | 5.4.6 (implemented, and it runs in the deploy workflow) |
| the deployed system's own sign-off | 6 |

## Not implemented

The rows that Stage 5.4 and Stage 5.5 own are not yet enforced by code. The Worker answers `501` to
nothing; every route in the contract either works or answers with a documented error. This list is
the specification the Stage 5.5 suite and the Stage 6 sign-off will be written against.
