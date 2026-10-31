# The signed context-link scheme, v1 (`ctxgate-v1`)

**Status:** normative. This document defines the wire format that every implementation of the context gateway
must agree on. The shipped client (`template/engine/tools/ctxlink.py`) is the reference implementation of the
*minting* side; `gateway/read/reference/ctxgate.py` is the reference implementation of the *verifying* side.
Where this document and the code disagree, the code is a defect and the conformance suite
(`conformance/test_conformance.py`) will fail.

This document is derived from `template/docs/CONTEXT-EXPORT.md` (sections 5 and 6, and appendix B). It exists
because that document is prose written for a person, and a port in another language needs something a compiler
can check. The two MUST be changed together.

---

## 1. Scope

The scheme covers one thing: a **read-only capability to read exactly one file at exactly one pinned commit**,
carried in a URL that a client with nothing but an HTTP GET can follow.

Out of scope: how the file is stored, which repository it comes from, how the link is revoked, whether the
gateway is deployed. Those are gateway policy (section 9), not scheme.

## 2. Link format

```
{base}/v1/{kid}/{exp}/{order}/{sig}/{ref}/{path...}
```

Everything is in the path, never in the query string, so a GET-only proxy that strips queries still works.

| Segment | Meaning | Rule |
|---|---|---|
| `v1` | scheme version, literal | exactly `v1` |
| `kid` | key id, selects the signing secret | section 4.1 |
| `exp` | expiry, unix seconds, decimal | section 4.2 |
| `order` | work order id | section 4.3 |
| `sig` | signature | section 3.2 |
| `ref` | pinned commit, 40 lowercase hex | section 4.4 |
| `path...` | one or more path segments naming exactly one file | section 5 |

`{path...}` is everything after `ref`, so a path may contain `/` and the file may be at any depth. The path is
URL-encoded per segment (section 6); the segments on the wire are separated by literal `/`.

## 3. Canonical message and signature

### 3.1 The message

The message is exactly these six fields, in this order, separated by a single LF (`0x0A`), with **no trailing
separator**, encoded as UTF-8:

```
ctxgate-v1 \n kid \n exp \n order \n ref \n path
```

Written out, with the separators shown as real line breaks:

```
ctxgate-v1
k1
2000000000
10008-S001
aaaa…aaaa (40 characters)
amk/amk-ssot.md
```

Rules:

- `exp` is the **decimal integer** form of the expiry, with no sign, no leading `+`, and no leading zeros
  (except the value `0` itself). The string used in the message is byte-identical to the `exp` path segment.
- `path` in the message is the **decoded** path (section 6), not the percent-encoded form. The signer signs the
  path as it exists in the repository.
- The first field is the literal ASCII string `ctxgate-v1`. It is the scheme's domain separator: a signature
  produced for this scheme can never be replayed as a signature for anything else.

### 3.2 The signature

```
sig = base64url_nopad( HMAC-SHA256( secret, message_utf8 ) )
```

- The secret is the raw byte string selected by `kid`; it is used as the HMAC key, not hashed first.
- `base64url` is RFC 4648 section 5 (the `-` and `_` alphabet), and the `=` padding is **stripped**. The result
  is 43 characters for a 32-byte HMAC.
- No other transformation is applied to the message or the digest. There is no salt, no prefix, no
  canonicalisation step.

### 3.3 What the signature binds

The signature covers every field, so changing any one of them invalidates it: `kid` (which key), `exp` (how
long), `order` (whose task), `ref` (which content), and `path` (which file). This is the whole of the tamper
resistance of the scheme; there is nothing else to it.

## 4. Field rules

### 4.1 `kid` — key id

Must match `^[A-Za-z0-9_]{1,16}$`.

The kid is a **selector, not a secret**. It names the key so that a key can be rotated: mint with `k2`, and links
signed under `k1` keep working until `k1` is retired. A gateway MUST reject a link whose kid it does not know,
and MUST reject the link before doing any other work with it.

### 4.2 `exp` — expiry

Unix time in seconds. The link is valid while `now <= exp + tolerance`, and refused once
`now > exp + tolerance`. With a tolerance of zero the boundary is **inclusive**: a link is served at exactly
`exp` and refused at `exp + 1`.

`tolerance` is the **clock-skew tolerance** of the gateway (section 9): the number of seconds by which the
gateway's clock is assumed to lag the minter's. A gateway MUST apply a fixed, documented tolerance and MUST
NOT widen it silently. The operator's approved ceiling for the tolerance is 120 seconds
(`docs/decisions/0003`); a deployment MUST NOT use a larger one, and the conformance suite enforces that bound.

`exp` is bound into the signature, so it cannot be stretched by editing the URL.

Separately from the expiry, a gateway enforces a maximum lifetime: it refuses any link for which
`exp - now > max_ttl`. This stops a minter from minting a link that lives for a year, whatever the signer
believes. The operator's approved ceiling for `max_ttl` is 72 hours (259200 seconds,
`docs/decisions/0003`).

### 4.3 `order` — work order id

Must match `^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`.

The order is the unit of revocation: revoking an order kills every link minted for it, and no link of any other
order. The order is bound into the signature, so a link cannot be moved to another order.

### 4.4 `ref` — pinned commit

Must match `^[0-9a-f]{40}$`: exactly forty **lowercase** hexadecimal characters.

Lowercase is normative. A gateway MUST reject an uppercase ref even when it denotes the same commit; accepting
both would make the signed bytes depend on the spelling of the ref and split every implementation's vectors in
two. Branches, tags and other movable refs are not accepted: content addressed by commit is what makes a link
replayable-safe for the length of its life.

### 4.5 `path` — see section 5.

## 5. Path rules

A path names **exactly one file** in the repository, relative to the repository root.

The scheme performs **no normalisation**. A path is either already canonical and is accepted exactly as
written, or it is refused. There is no case folding, no Unicode normalisation, no collapsing of separators, no
`.` removal, and no resolution of `..`.

A path is **valid** when all of the following hold:

| Rule | Detail |
|---|---|
| not empty | `""` is refused |
| relative | it must not start with `/` |
| no backslash | `\` is refused anywhere in the path |
| no control characters | no character in `U+0000`–`U+001F` or `U+007F` anywhere in the path |
| no empty component | no `//`, no leading `/`, no trailing `/` |
| no `.` component | a component that is exactly `.` is refused |
| no `..` component | a component that is exactly `..` is refused |

Two consequences worth stating explicitly, because implementations get them wrong:

- **A component may contain `..` as a substring.** `notes/na~me.v1..2.md` is a legal file name and a legal
  path. Only a component that is *exactly* `..` is refused. A gateway MUST NOT implement this as a substring
  test such as `*..*`, which both rejects legal names and can be bypassed by encodings.
- **Unicode is not normalised.** `café/naïve.md` written in NFC and the same text written in NFD are two
  different paths with two different signatures. The signer and the file system must agree on the exact bytes.
  An implementation MUST NOT normalise a path before signing or before verifying.

A path that fails any rule is refused by a gateway, and MUST be refused by a minter.

**What a platform may do to the request before the gateway sees it.** The scheme describes what a
gateway does with the request it receives. Some runtimes resolve `.` and `..` segments in the
request target before the Worker is invoked — the Cloudflare Workers runtime does. A traversal
attempt then arrives as a path that no longer contains the traversal, and it is refused by the
signature check rather than by the path rule. The outcome is the same (403, nothing served) and
the audit reason differs. A conformance case for traversal therefore accepts `malformed` **or**
`bad-signature`: the scheme does not pretend that two platforms produce the same reason.

The rule the scheme does state: the gateway MUST NOT normalise a path itself, and MUST NOT rely
on the platform having normalised one. A gateway that normalises, or that depends on the platform
having done it, is not conformant — the normalisation is not part of the scheme and is not
guaranteed to be present.

## 6. URL encoding

The path travels in the URL, so it is percent-encoded **per segment**:

- The path is split on `/`. Each segment is encoded separately, and `/` is never encoded — it is the separator.
- Within a segment, only `A-Za-z0-9_.-~` (the RFC 3986 unreserved set) stay literal. Every other byte of the
  UTF-8 encoding is written as `%` followed by **two uppercase hex digits**.
- So a space is `%20`, `+` is `%2B`, `%` is `%25`, and `é` is `%C3%A9`.

The verifier reverses this exactly:

1. Split the raw URL path on `/`.
2. Percent-decode **each segment** as UTF-8. A byte sequence that is not valid UTF-8 is replaced with U+FFFD.
3. Join the decoded segments with `/`.

Two rules that are easy to get wrong:

- **Percent-decode, do not form-decode.** `+` in a URL path is a literal plus, not a space. A verifier that
  treats `+` as a space will reject every link minted for a path containing a plus.
- **Decode each segment, not the whole path.** Decoding the whole path first would turn `%2F` into a separator
  and change the path structure. A gateway MUST additionally refuse a raw path containing `%2F`, `%5C` or `%00`
  (case-insensitive), before decoding anything.

## 7. Verification procedure

A gateway MUST perform these checks in this order, and MUST stop at the first failure. The order is part of the
scheme, because it is what makes enumeration impossible.

| # | Check | Failure |
|---|---|---|
| 1 | the method is `GET` or `HEAD` | 405 |
| 2 | the raw path contains no `%2F`, `%5C`, `%00` | 403 |
| 3 | the path parses into the segments of section 2 | 403 |
| 4 | `kid`, `exp`, `order`, `ref` and `path` are well-formed (sections 4 and 5) | 403 |
| 5 | `kid` is a known key id | 403 |
| 6 | the signature is valid, compared in constant time | 403 |
| 7 | the link is not expired (`now <= exp + tolerance`) | 403 |
| 8 | `exp - now <= max_ttl` | 403 |
| 9 | the order is not revoked | 403 |
| 10 | the path is inside an allowed prefix and matches no deny rule | 403 |
| 11 | read the blob at `ref:path` | 404 not found, 413 too large |

Steps 1 to 10 MUST all return the **same status and the same body**, so that a caller who cannot authenticate
learns nothing at all — not even whether a file exists. Step 11 happens only after a valid signature.

The signature check (6) precedes expiry, TTL, revocation and path policy on purpose: those checks are cheap
rejections, and a forged link must not be able to tell "expired" from "no such file" from "not allowed".

## 8. Responses

**Success (200).** The exact bytes of the file, with:

| Header | Value |
|---|---|
| `Content-Type` | `text/plain; charset=utf-8` |
| `Cache-Control` | `private, no-store` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Content-SHA256` | lowercase hex SHA-256 of the body |
| `X-Ctx-Order` | the order the link was minted for |
| `X-Request-Id` | the per-request correlation id, the same one in the audit record |
| `Content-Length` | the size of the body |

A `HEAD` request returns the same headers with an empty body. `Cache-Control` MUST contain `no-store`: a cached
context file is a leaked context file.

**Refusal (403).** One body for every refusal in steps 1 to 10, so the response says nothing about which check
failed.

**Not found (404)** and **too large (413)** are only reachable after a valid signature, so they disclose the
existence of a file to a caller who has proved it holds a valid link for that exact path.

## 9. Gateway policy (not part of the scheme)

These are deployment decisions. A gateway is free to choose them, and the conformance suite is told what to
expect.

| Setting | Meaning | Reference default | Approved ceiling |
|---|---|---|---|
| `allow_prefixes` | which repository paths may be served at all | `amk/` | operator's choice |
| `deny_regex` | paths that are refused even inside an allowed prefix | `.git`, `.github`, `.env`, `secrets`/`credentials`, `*.pem`/`*.key`/`*.p12` | operator's choice |
| `max_bytes` | largest file that may be served | 1 MB | operator's choice |
| `max_ttl` | longest lifetime a link may have | 7 days | **72 h (259200 s)** — `docs/decisions/0003` |
| `clock_skew_tolerance` | seconds the gateway's clock is assumed to lag the minter's | 0 | **120 s** — `docs/decisions/0003` |
| `revoked_orders` | orders whose links are dead | empty | operator's choice |
| `audit_path` | where request records are written | none | operator's choice |

A gateway MUST NOT serve anything that is not named by a valid link: no directory listing, no search, no branch
switching, no repository API proxying, no write path.

### 9.1 The health endpoint

A gateway MUST expose a health endpoint that reports the **effective** values of the settings that change how
a link is judged, so that a verifier can test the gateway as it is actually configured rather than as it is
assumed to be configured. It reports:

```json
{"status": "ok", "version": "...", "clock_skew_tolerance": 120, "max_ttl": 259200, "max_bytes": 1048576,
 "key_ids": ["k1"], "scheme": "ctxgate-v1"}
```

It MUST NOT report the allowed prefixes, the deny patterns, the repository, the signing secrets, the revocation
list or the audit contents. Those are protected state; the health endpoint is not the place for them.

## 10. Audit record

Every request writes exactly one record. The reference format is one JSON object per line:

```json
{"ts": 1700000000, "status": 200, "reason": "ok", "kid": "k1", "order": "10008-S001",
 "ref": "aaaa…", "path": "amk/spec.md", "bytes": 16, "request_id": "9f2c1a7e4b8d0356"}
```

- `status` is the HTTP status returned to the caller.
- `reason` is a short machine-readable cause (`ok`, `method`, `encoded-separator`, `malformed`, `unknown-key`,
  `bad-signature`, `expired`, `ttl-too-long`, `revoked`, `path-denied`, `not-found`, `too-large`).
- `request_id` is a per-request correlation id. It is unique per request, so an operator can follow one
  request through the gateway's own logs, and it appears in the response headers as `X-Request-Id`.
- `sig` is **never** recorded, and neither is the secret, nor the file content, nor the raw URL.

A summary over the log reports, for one order: the paths **served**, the paths **never fetched**, and the
requests **refused**.

## 11. Conformance requirements

An implementation is conformant when it passes `conformance/test_conformance.py`, which runs:

- `conformance/signing-vectors.json` — every valid vector reproduced byte for byte, every invalid input
  rejected;
- `conformance/cases/behaviours.json` — the behaviours B1 to B10, as executable cases.

The harness reads the gateway's **effective** `clock_skew_tolerance` and `max_ttl` from the health endpoint
(section 9.1) and judges the expiry and lifetime behaviours against those values, so a deployment is tested
as it is configured. It additionally asserts that both values are within the operator's approved ceilings
(120 seconds and 72 hours): a gateway that is more permissive than the policy fails even if every other
case passes.

**Audit records.** A conformant gateway writes exactly one audit record per request, with exactly the fields
of section 10 — including `request_id`, which is unique per request — and records no signature, no secret and
no file content.

**Test clock.** Behaviours B3 and B5 are about the exact comparison against `exp`, so the gateway under test
needs a controllable notion of "now". A conformant implementation MUST provide one. The reference uses the
environment variable `CTXGATE_NOW`, re-read on every request, and additionally honours a per-request override
header `X-Conformance-Now` **only** when the process was started with `CTXGATE_TEST_CLOCK=1`. That switch is a
test-mode switch: a production deployment MUST NOT set it, because the override header would let a caller
extend the life of an expired link.

**Operator channel.** A conformant gateway MUST expose an operator channel for revocation and for reading
the audit trail, authenticated separately from the signing keys. Without it, a remote gateway cannot be
revoked and the operator cannot see what was fetched.

**Signer contract.** To be driven by the harness, a signer may be exposed as a program that reads one JSON
object per line on stdin and writes one JSON object per line on stdout:

```
in : {"op":"sign","secret":"...","kid":"k1","exp":2000000000,"order":"10008-S001","ref":"…","path":"…"}
out: {"signature":"…","url_path":"/v1/k1/2000000000/10008-S001/…/…"}
out: {"error":"…"}          (instead of a signature, when the input is invalid)
```

`conformance/harness/signer_adapter.py` is a working example of that contract over the shipped client. A port
in another language writes its own adapter; the harness does not care what language it is written in, and the
gateway is driven over plain HTTP so that it does not either.

## 12. Changing the scheme

The scheme version is in the path (`/v1/…`) and in the domain separator (`ctxgate-v1`). A change to the
message layout, the signature, the field rules, the path rules or the encoding rules is a **new scheme
version**: a new path prefix, a new domain separator, and a new set of vectors. Existing links keep their
version and keep working.

Adding a key id, an order, a path, an expiry, or a gateway policy setting is not a scheme change.
