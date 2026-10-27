# Context export: signed context links (proof-of-concept overview)

Status of the parts. **Implemented and shipped:** the link scheme, `ctxlink.py` and the work-order integration in `plan_tool.py`.
**Reference only (not shipped, not deployed):** the gateway proof of concept described in section 10. **Not available in this
version:** a deployed gateway, and any agent write path. Hosting and policy decisions are recorded in section 12. Supersedes
nothing automatically; it answers `pending/context-export.md` (see section 9 for what was kept and what changed).

## 1. Verdict

Agents with limited tools can only make plain HTTPS GET requests, and the context they need lives in the private
`PROJECT-dev` repository. The mechanism that solves this with the least new risk is a **signed context gateway**:

- The operator's tooling mints a short-lived, read-only link for each file in a work order. The link is a plain URL.
- A small gateway verifies the link, reads that one file at that one pinned commit from the private repo, and
  returns it. Nothing is copied to third-party storage, and no agent ever holds a repository credential.
- Links expire, can be re-minted without changing the order, can be revoked per order, and every fetch is audited.

What the proof of concept **proves**: the link format, the signing rules, every refusal rule, expiry, revocation,
audit, the integration into work orders, and a plain-GET client fetching real Project files whose hashes match the
order. What it **does not prove**: a deployed gateway, the GitHub-backed file source, and any hosting provider
(sections 10 and 11). The hosting and policy decisions are recorded in section 12.

## 2. The problem, from your answers

| Fact | Consequence |
|---|---|
| Work orders hold only URLs (small orders, agent controls digestion, adjustable during the order's life) | Links must be re-issuable without editing the order |
| The URLs point at the private `PROJECT-dev` repo; agents have no relationship with public `PROJECT` | The source of truth is private; public raw URLs are not an option |
| Class A agents use authenticated git/curl | They can read private raw URLs directly; no export needed |
| Class B agents can only use an HTTPS GET-only gateway | They cannot send an `Authorization` header: the link itself must carry the authority |
| Agents are free to use their capabilities | No closed world; the link grants read access only, nothing else |

Non-goals: write access of any kind, dynamic queries, search, directory listing, serving anything not named in an
order.

## 3. Options considered

| | A. Signed gateway (chosen) | B. Public or unlisted copy | C. Inline content |
|---|---|---|---|
| How it works | Gateway verifies an HMAC link and reads the file from the private repo at a pinned commit | Operator uploads a bundle; agents get presigned (rejected approach) storage URLs | Mirror the files somewhere public | Paste content in the order |
| Private content at rest outside GitHub | No | Yes (until deleted) | Yes, publicly | Only in chat |
| Who holds a GitHub credential | The gateway (read-only, one repo) | The operator only | n/a | n/a |
| Agent-side credential | None | None | None | None |
| Pinned to a commit | Yes, by construction | Yes, by what was exported | Only if you keep versions | Yes |
| Revoke | Per order (instant); key rotation for everything | Delete the object (presigned (rejected approach) URLs cannot be revoked individually) | Not possible | Not possible |
| Extra moving parts | One small service | Storage + presigning client + upload step + cleanup | Hosting | None |
| Orders stay small / adjustable | Yes | Yes | Yes | No (rejected by you) |
| Main risk | Gateway holds a read-only token; a leaked link exposes one file until it expires | Third-party copy of private content; operator must clean up | Disclosure | Violates your requirement |

Why A: it never copies private content, needs no upload or cleanup step, gives per-order revocation, and the
gateway is stateless apart from a revocation list and an audit log. The rejected object-storage approach was considered and has been rejected.

C and D are rejected. Option "give class B agents a token" does not exist: they cannot send one.

## 4. Architecture and end-to-end flow

```
  operator (Termux)                         gateway (small service)               private repo
  -------------------                       ------------------------               ------------
  plan_tool.py order ... ----mint----+
   (needs signing secret)            |
                                     v
   WORK ORDER text with links  ---->  agent --- plain GET {base}/v1/... --->  verify link
   (orders/<id>.json stores                                                     read file at pinned commit  --->  contents
    NO signed link)                                                             audit line, return text + sha256
  plan_tool.py links <order>  (re-mint when links expire)
  ctxgate.py revoke <order>   (when the task is done)    ctxgate.py audit <order>  (what was fetched)
```

Trust boundaries: the signing secret lives only on the operator machine and in the gateway's secret store; the repo
credential lives only in the gateway; agents hold neither. A leaked link grants read access to exactly one file at
one commit until it expires.

Numbered flow:

1. **Setup (once).** Generate a signing secret per key id (`k1`). Configure the gateway with the secrets, allowed
   path prefixes and a read-only repository credential. Put the gateway base URL in `engine.json`
   (`context.gateway`). The secret is exported as `CTXGATE_SECRET` when ordering and never stored in the repo.
2. **Order.** `plan_tool.py order <plan> <ids> --target <PROJECT-dev main checkout> --write --start`. The engine
   builds the context list (pinned commit, repository path, sha256), writes the order file *without* signed links,
   and prints the work order with a signed link beside each file.
3. **Hand over.** The operator gives the printed order to the agent.
4. **Fetch.** A class B agent does a plain GET on each link. A class A agent may ignore the links and use the
   `url` fields with its own credentials.
5. **Verify (optional, agent side).** The response carries `X-Content-SHA256`; the order carries the expected
   `sha256`. An agent that can hash can confirm it read exactly what the plan intended.
6. **Adjust during the order.** Links expire (default 24 h). `plan_tool.py links <plan> <order>` re-prints the same
   order with fresh links; the order file does not change. Context that must change is edited in the plan and
   re-ordered as a rework.
7. **Complete.** After the submission is uploaded, the operator revokes the order (`ctxgate.py revoke`); every
   link minted for it dies at once.
8. **Audit.** `ctxgate.py audit --order <id> --expect <paths>` lists files served, files never fetched, and
   refused attempts (bad signature, expired, revoked, denied path). Unexpected reads are visible.

## 5. Link format and signing (v1)

```
{base}/v1/{kid}/{exp}/{order}/{sig}/{ref}/{path...}
```

| Part | Meaning |
|---|---|
| `kid` | key id selecting the signing secret (allows rotation) |
| `exp` | expiry, unix seconds |
| `order` | work order id the link was minted for (`10008-S001`) |
| `sig` | base64url (no padding) of HMAC-SHA256(secret, message) |
| `ref` | 40-hex commit sha: content is immutable, branches are not accepted |
| `path` | repository-relative path of one file, percent-encoded per segment |

`message = "ctxgate-v1\n" + kid + "\n" + exp + "\n" + order + "\n" + ref + "\n" + path` (UTF-8). Everything is in the
path, not the query string, so a GET-only proxy that strips queries still works.

Compatibility vector (any implementation must reproduce it): secret `test-secret`, kid `k1`, exp `2000000000`,
order `10008-S001`, ref forty `a`, path `amk/amk-ssot.md` gives
`b5aVA1G6MJDhZy5mkIkSFeUMFBM0W-tixIb2w4XHEU8`. A second vector with a space and a non-ASCII character is in
`engine/tools/test_ctxlink.py`.

## 6. Gateway rules

Checks run in this order; the first failure ends the request. Every outcome is written to the audit log.

| # | Check | Result |
|---|---|---|
| 1 | Method is GET or HEAD | else 405 |
| 2 | No encoded separators (`%2f`, `%5c`, `%00`) | else 403 |
| 3 | Link parses; `kid`, `order`, `ref`, `exp` well-formed; path has no `..`, `.`, empty or absolute parts | else 403 |
| 4 | `kid` known | else 403 |
| 5 | Signature valid (constant-time compare). **Before anything else is revealed** | else 403 |
| 6 | Not expired | else 403 |
| 7 | `exp - now <= max_ttl` (a minter cannot mint forever) | else 403 |
| 8 | Order not revoked | else 403 |
| 9 | Path inside an allowed prefix and not matching the deny list (`.git`, `.github`, `.env`, secrets, keys) | else 403 |
| 10 | Read the blob at `ref:path` (blobs only) | 404 not found, 413 over `max_bytes` |

All failures before step 10 return the same 403 body so an unauthenticated caller learns nothing, including
whether a file exists. Success returns 200, `text/plain`, `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, `X-Content-SHA256`, `X-Ctx-Order`. There is no listing, search or write path.

Configuration: signing keys, allowed prefixes, deny patterns, `max_bytes` (default 1 MB), `max_ttl` (default 7 days),
audit log, revocation list.

## 7. Integration with work orders

Each context item in an order carries: `url` (private raw URL, for class A), `ref`, `repo_path`, `sha256`, `role`
(`read` or `edit`). Gateway links (`gateway_url`) are added **only when printing**.

- `engine.json` `context.gateway`: `{"base": "...", "kid": "k1", "ttl_seconds": 86400, "secret_env": "CTXGATE_SECRET"}`.
- If the gateway is configured and the secret is missing, `order` refuses rather than printing unsigned links.
- `orders/<id>.json` never contains a signed link (tested). The committed record holds only non-secret facts.
- `plan_tool.py links <plan> <order>` re-mints links; with `--json` it prints the machine form.
- A legacy `gateway_template` (an unsigned URL template) still works for a gateway that authenticates by other means.

## 8. Security analysis

| Threat | Mitigation | Residual risk |
|---|---|---|
| Link leaked (chat log, transcript) | Read-only, one file, one commit, expires (24 h default), revocable per order, audited | Whoever has the link can read that file until expiry or revocation |
| Link tampered (other file, other order, longer expiry) | Signature binds kid, exp, order, ref and path | None found in tests |
| Signing secret stolen | Held only on the operator machine and in the gateway; rotate by adding `k2`, retiring `k1` | Attacker can mint links within allowed prefixes and `max_ttl` until rotation |
| Gateway's repository token stolen | Fine-grained, read-only, one repository, short expiry, stored as a secret | Attacker can read that repository |
| Path abuse (`..`, encoded slashes, dotfiles, workflows) | Parse rules, encoded-separator ban, allowed prefixes, deny list, blobs only | Allow-lists must be kept current |
| Enumeration (is this file there?) | Uniform 403 before authentication; 404 only after a valid signature | None found |
| Replay after the task | Per-order revocation; short expiry | Window until revoked |
| Denial of service | Size cap; rate limiting is a production requirement (not in the proof of concept) | Open until implemented |
| Content tampering in transit | HTTPS in production; hash header and order sha256 let an agent verify | Agents that cannot hash cannot verify |
| Gateway logs leak links | Log fields exclude the signature; the path and order are logged | Log retention policy needed |

## 9. What was kept and changed from `pending/context-export.md`

| Your proposal | Here |
|---|---|
| Read-only, operator-initiated, no write path, no expansion of agent credentials | Kept |
| Static export to R2 with signed URLs | Kept as the fallback variant (appendix A); the recommended variant avoids the copy |
| Manifest with per-file sha256 | Kept: the order carries `sha256` per item; the gateway returns the hash |
| Audit log kept by the operator | Kept: the gateway logs every request and `audit` compares it with the order |
| `export-context` and `cbridge export-context` commands | Replaced by minting at order time and `plan_tool.py links` (no upload step) |
| Exclude `engine/`, `plans/`, `.github/` | Replaced by allowed prefixes plus a deny list (the old list excluded files tasks legitimately need) |
| Local mirror under `plans/<id>/context/` | Dropped (it would be committed by `git add -A`) |
| Secrets in the cbridge config | Dropped: the signing secret is an environment variable on the operator machine |
| Revoke by revoking URLs | Revoke by order (gateway) or by deleting objects (variant) |

## 10. The proof of concept

Two programs, split on purpose. **Shipped with every release:** `engine/tools/ctxlink.py` (the link scheme and `mint`) with
`test_ctxlink.py`, and the work-order integration in `plan_tool.py` (with tests). **Not shipped:** the gateway itself,
`ctxgate.py` (gateway rules, a local-git file source, a runnable HTTP server, `serve`, `revoke`, `audit`) with its tests,
lives only in the build-engine source repository under `gateway/read/reference/`. Run the `ctxgate.py` commands below from a checkout
of that repository.

End-to-end run on the real Project plan (task `10008-1-102-00`), real Project files as the source, a plain `curl`
client with no credentials, links with a 4-second lifetime:

```
order: 8 context items (7 read, 1 edit)
GET each gateway link        -> 200 MATCH (8 of 8 files, sha256 equals the order)
tampered path / other file   -> 403 / 403        POST -> 405       no token -> 403      ../ traversal -> 403
after 5 seconds              -> 403 (expired)
plan_tool.py links           -> order file hash unchanged; fresh link -> 200
ctxgate.py revoke 10008-S001 -> same link now 403
audit                        -> served 8, never fetched 0, refused: bad-signature 2, expired 1, malformed 1, revoked 1
signed links stored in the committed order file: 0
```

Not proven (and not claimed): a deployed gateway on any provider; the GitHub-backed source adapter (the proof of
concept reads a local git repository); rate limiting; behaviour behind your agents' actual GET-only proxy; the
rejected object-storage approach.

## 11. Production path

| Step | What | Done when |
|---|---|---|
| 1 | Decide where the gateway runs (section 12) | Done: Cloudflare Workers, operator-owned |
| 2 | Source adapter: read `GET /repos/{slug}/contents/{path}?ref={sha}` raw with a read-only, single-repo, short-lived token | Adapter passes the gateway behaviours in appendix B against a scratch private repo |
| 3 | Port the gateway rules to the chosen runtime | Reproduces the signing vectors and passes appendix B |
| 4 | Rate limiting, alerting on repeated refusals, log retention | Documented limits; alert fires in a test |
| 5 | Pilot: one real task, one class B agent, end to end including revoke and audit | Task submitted; audit shows only expected reads |

## 12. Decisions (recorded 2026-10-26)

1. **Where the gateway runs:** Cloudflare Workers, operator-owned and single-tenant. The rules need no database beyond a
   revocation list and an audit log.
2. **Proxy reachability:** the agents' GET-only proxy is restricted to the host or hosts named in the approved work order.
   The gateway base URL in minted links must be a host the agent's proxy may contact for that order; the gateway host is
   part of the work-order contract.
3. **Link lifetime:** 24 hours by default (`ttl_seconds` 86400) and 72 hours at most. Re-minting is always allowed.
4. **Served prefixes:** a per-deployment allow-list set by the operator (the reference design suggests `amk/` and
   `plans/*/package/` as starting values for one repository layout), a fixed deny list (`.git`, `.github`, `.env`, secret-like
   names, traversal after normalisation), and commit SHAs only, never moving refs.
5. **Class A agents:** the private raw `url` fields are enough, with the agent's own credentials. Class A and Class B remain
   separate trust paths.

These decisions describe what the production gateway must do. The production gateway is not yet built.


## Appendix B: gateway behaviours a production port must pass

Each is covered by `gateway/read/reference/test_ctxgate.py` in the build-engine source repository:

1. Valid link returns the exact bytes, correct hash header, `no-store`.
2. HEAD returns headers and no body; POST, PUT, DELETE, PATCH return 405.
3. Expired link refused; expiry boundary is inclusive (valid at `exp`, refused at `exp + 1`).
4. Tampering with any of kid, exp, order, sig, ref or path is refused.
5. A link whose lifetime exceeds `max_ttl` is refused.
6. Revoking an order kills its links and no one else's.
7. A validly signed link to a denied or out-of-prefix path is refused.
8. `..`, encoded slashes and NUL bytes are refused.
9. Not-found and too-large appear only after a valid signature; forged links never learn existence.
10. Every request writes one audit record; `audit` reports served, never-fetched and refused.
11. The signing vectors reproduce exactly.
