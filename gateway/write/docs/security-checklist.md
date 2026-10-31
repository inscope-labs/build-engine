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
| the deployed system's own sign-off | 6 |

## Not implemented

None of the rows above are currently enforced by code. The Worker answers `501` to every request. This list is
the specification the Stage 5.5 suite and the Stage 6 sign-off will be written against.
