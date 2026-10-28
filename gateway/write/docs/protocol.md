# ctxwrite-v1 — the write-gateway protocol contract

**Status: normative.** This document defines the wire format and the security contract of the task-scoped
write gateway. It is the single authoritative definition of the write protocol (plan rule G-11).

Where this document and the code disagree, **the code is a defect**. The conformance suite added in Stage 5.5
drives a gateway over this contract; a gateway that cannot be driven by it is not conformant.

This is the write-side counterpart of `conformance/SCHEME.md` (the read side, `ctxgate-v1`). The two schemes
share a shape and a signing discipline, and they are **not** interchangeable: their domain separators differ,
so a signature minted for one can never be replayed against the other (section 3.4).

**Stage 5.1 wrote this document. Stage 5.1 wrote no implementation.** Every route, code and limit below is
*specified*; none of it is *implemented*. The enforcement lands in Stages 5.2 (core and session), 5.3 (commit and
delivery), 5.4 (audit and operations) and 5.5 (tests). Nothing in this document may be read as a claim that a
running service exists.

---

## 0. Scope, and what this document is not

The scheme covers one thing: **a capability to create, edit and deliver text files into exactly one task
folder of one submissions repository, for one writer, carried in a URL that a client with nothing but an HTTP GET
can follow.**

In scope: routes, query parameters, request and response schemas, the capability format and its signature, key
rotation, revocation, the task and writer binding, the session state machine, staging semantics, quotas, the
type policy, the error catalogue, the commit and seal contract, the credential boundary, and the recovery model.

Out of scope, because they are deployment or operator policy rather than protocol: which host the gateway runs
on, which GitHub organisation hosts the submissions repository, how the operator mints capabilities, and how
accepted files are moved from the submissions repository into the private consumer repository (register R0-011).

### 0.1 Sources of truth

G-11 requires one authoritative definition per concern. This is the map. Where two files disagree, the one in
the right-hand column wins.

| Concern | Authority | Published / machine-readable view |
|---|---|---|
| Routes, parameters, envelope, state machine, capability format, signature, recovery | **this document** | `gateway/write/docs/protocol.md` |
| Error codes, statuses, retryability, meaning | `gateway/write/docs/error-catalog.md` | — |
| Quota numbers | `src/config/quotas.json` | `gateway/write/docs/quotas-and-type-policy.md` (mirrors it) |
| Type policy (extensions, media types, per-type limits) | `src/config/type-policy.json` | `gateway/write/docs/quotas-and-type-policy.md` (mirrors it) |
| ADRs (durable/ephemeral split, content handling, GET side effects, log hygiene) | `gateway/write/docs/adr/0001`..`0004` | — |
| Operator decisions (transport, DO, content, GET risk, audit, credential scope, quotas, types) | `docs/release/PHASE-1.4-WRITE-GATEWAY-DECISIONS.md` | — |

The two mirrors in the table are copies for human readers. A CI check that diffs them against the JSON is a
Stage 5.5.8 item; until that check exists, the JSON is the authority and a drift between them is a defect in
the document, not a change of policy.

### 0.2 Conventions

`MUST`, `MUST NOT`, `SHOULD` and `MAY` are used in the RFC 2119 sense. "the gateway" means a deployed
implementation of this contract. "the agent" means the Class B client that holds the capability.

---

## 1. Actors and trust boundaries

| Actor | Holds | Can do |
|---|---|---|
| **Operator** | signing secrets, the GitHub credential, the deployment | mint capabilities, open/close/revoke tasks, reset quota, read audit, deploy |
| **Agent (Class B)** | exactly one capability URL, no credentials | issue GET requests under that capability |
| **Gateway** | the signing secrets, the GitHub credential, the Durable Object namespace | verify capabilities, stage content, commit, seal, audit |
| **Submissions repository** | the deliverables of every task that uses it | — |
| **Consumer repository** | the shipped product | — |

Two boundaries carry the whole design:

1. **The agent never holds a repository credential.** The gateway holds the GitHub credential; the agent holds
   a capability that names one task folder. This is the Class A / Class B split recorded in the Stage 1.4
   closeout: the operator path stays operator-driven, and the Class B path is gateway-mediated.
2. **The gateway never reaches the consumer repository.** Its credential is scoped to the submissions
   repository, and the submissions repository is a *different* repository from the private consumer repository.
   The gateway can therefore only ever damage submissions, never the shipped product. Section 12 spells out
   what "damage" means, because the honest answer is wider than "this task's folder".

The agent is assumed **hostile but not omniscient**: it may send malformed requests, attempt traversal, replay
old chunks, race itself, and try to reach another task. It is not assumed to be able to forge a signature.

---

<a id="capability"></a>

## 2. The root capability

### 2.1 Format

```
{base}/w1/{kid}/{exp}/{order}/{plan}/{task}/{writer}/{head}/{sig}
```

Everything that authenticates the request is **in the path**, never in the query string, so a GET-only proxy
that strips query strings still works — the same property the read scheme was built on.

| Segment | Meaning | Rule |
|---|---|---|
| `w1` | scheme version, literal | exactly `w1` |
| `kid` | key id, selects the signing secret | section 3.3 |
| `exp` | expiry, unix seconds, decimal | section 3.4 |
| `order` | work order id (the submission id) | section 3.5 |
| `plan` | plan id | section 3.6 |
| `task` | task id | section 3.7 |
| `writer` | writer id | section 3.8 |
| `head` | expected head of the submissions branch, 40 lowercase hex | section 3.9 |
| `sig` | signature | section 3.2 |

The path is **fixed-arity**: the first nine segments are the capability, and segment ten (if present) is the
operation (section 4.1). There is no other path shape. A request path that does not parse as
`w1/{kid}/{exp}/{order}/{plan}/{task}/{writer}/{head}/{sig}[/{op}]` is not a capability request and is refused
as such (401).

`{base}` is the gateway origin, fixed by the operator at mint time. It is **not** signed: the signature covers
identity and scope, not the host. A capability presented to a different host is still a valid capability; what
that host does with it is that host's business. Deployments MUST NOT rely on host binding, and MUST NOT accept
a capability at a host other than the one it was minted for as a matter of policy. (Section 2.1 note: the
gateway MAY additionally pin the expected host in configuration and refuse a mismatched `Host`, which is a
deployment control, not part of the scheme.)

### 2.2 The root is a bearer capability

**The root URL is the secret.** Anyone who holds it can perform every operation the contract allows for that
task, within the task folder, until the capability expires or is revoked. There is no second factor. The
`writer` segment is an *identity*, not a secret: it is bound into the signature so that the gateway can
attribute writes and enforce a single writer, but it is readable by anyone holding the root, and copying it
along with the root copies the whole authority. The contract says so here because a capability that is
mistaken for a two-factor credential is a capability that is copied to the wrong place.

Consequences that follow from this and that the rest of the document assumes:

- The root URL MUST be transported over TLS only. A gateway MUST refuse to serve a capability over plaintext
  HTTP (a deployment control; a conformance environment may set a flag to test it).
- The root URL MUST NOT appear in logs, metrics, traces, error bodies, analytics, referrer headers, or any
  third-party sink. Section 10 and ADR 0004 say how.
- The root URL MUST NOT be embedded in shared text, issue trackers, or commit messages, and MUST NOT be
  published anywhere the agent's output is visible. The tool prompt says this to the agent directly.
- A capability MUST be minted with the **shortest TTL that lets the task finish**, and the gateway enforces a
  maximum TTL independently of the minter (section 3.4).
- Rotation is cheap: mint a new capability and let the old one expire. Nothing in the task depends on the
  capability surviving.

### 2.3 What the capability authorises

Exactly one thing: staging text files into **one task folder**, and committing **that folder's staged files** to
**one configured branch** of **one configured repository**, and then sealing it.

The capability does **not** authorise, and there is no route that can:

- reading any repository content other than the agent's own staged files;
- choosing a repository, a branch, a commit parent, or a path outside the task folder;
- creating, deleting or merging a branch, a repository, or a folder;
- publishing, releasing, or pushing anywhere except the configured submissions branch;
- reading the audit stream, the operator channel, the health endpoint's sensitive fields, or another task.

### 2.4 The task folder is derived, never supplied

The task folder is computed by the gateway from the **signed** `plan`, `order` and `task` segments and the
**configured** folder template (section 12.2):

```
folder = SUBMISSIONS_FOLDER_TEMPLATE.format(plan=plan, order=order, task=task)
```

`SUBMISSIONS_FOLDER_TEMPLATE` is fixed at deployment, for example
`plans/{plan}/submissions/{order}/{task}`. No request parameter, header or body can influence it, and a
request that tries to name a destination is refused (400 `destination-not-selectable`).

This is the direct answer to plan task 5.1.4: **an operation is bound to one task folder and one authorised
writer, and no request may choose an arbitrary repository, branch or path.** The `path` parameter of a staging
operation is always **relative to the task folder** and is always resolved inside it.

### 2.5 The writer

`writer` names the party authorised to write. It is bound into the signature, so a capability cannot be
re-pointed at a different writer without invalidating.

The gateway enforces **one writer per task at a time** with a lease held in the Durable Object (ADR 0001):

- The first request under a capability claims the lease for that capability's `writer`.
- A later request under a capability with the **same** `writer` continues the session.
- A request under a different capability for the **same task** (a different `writer`) is refused with
  `409 writer-conflict`. The agent is not the writer; it stops.
- The lease expires after a bounded interval. While it is active, a lease held by a *different* writer is not
  reclaimable by the holder of a second capability. **An expired lease may be taken by any writer** —
  otherwise a writer that crashed would deadlock its task forever, which is exactly what the expiry
  exists to prevent.

Because the lease is keyed on the writer identity, a capability that is *stolen* is indistinguishable from the
original writer. That is what bearer means; it is stated in section 2.2 and is not mitigated by the lease.

---

## 3. Canonical message and signature

### 3.1 The message

The message is exactly these eight fields, in this order, separated by a single LF (`0x0A`), with **no trailing
separator**, encoded as UTF-8:

```
ctxwrite-v1 \n kid \n exp \n order \n plan \n task \n writer \n head
```

Written out with the separators as real line breaks:

```
ctxwrite-v1
k1
2000000000
10008-S001
castiel-dev
10008-1-001-01
agent-7
a3f1…c9 (40 characters)
```

Rules:

- `exp` is the **decimal integer** form of the expiry, with no sign, no leading `+`, and no leading zeros
  (except the value `0` itself). The string used in the message is byte-identical to the `exp` path segment.
- The first field is the literal ASCII string `ctxwrite-v1`. It is the scheme's domain separator.
- The message contains **no** path, no file, no payload and no query parameter. The capability authorises a
  *scope*; what is done inside that scope is authorised by the session state and the policy, not by the
  signature. This is deliberate: the signature cannot cover a payload that arrives after minting, so covering
  the scope instead is what actually constrains the request.

### 3.2 The signature

```
sig = base64url_nopad( HMAC-SHA256( secret, message_utf8 ) )
```

- The secret is the raw byte string selected by `kid`; it is the HMAC key, not hashed first.
- `base64url` is RFC 4648 section 5 (the `-` and `_` alphabet) with the `=` padding **stripped**. The result is
  43 characters for a 32-byte HMAC.
- No other transformation is applied to the message or the digest: no salt, no prefix, no canonicalisation
  step.
- The comparison MUST be constant-time.

### 3.3 `kid` — key id

Must match `^[A-Za-z0-9_]{1,16}$`.

The kid is a **selector, not a secret**. It names the key so a key can be rotated: mint with `k2`, and
capabilities signed under `k1` keep working until `k1` is retired. A gateway MUST reject a capability whose kid
it does not know, and MUST reject it before doing any other work with it.

Several key ids MAY be served at once. The gateway MUST accept any key id it currently knows, and MUST NOT
accept one it has retired.

### 3.4 `exp` — expiry

Unix time in seconds. The capability is valid while `now <= exp`, and refused once `now > exp`. The boundary is
**inclusive**: it is served at exactly `exp` and refused at `exp + 1`.

`exp` is bound into the signature, so it cannot be stretched by editing the URL.

Separately, the gateway enforces a maximum lifetime: it refuses any capability for which `exp - now > max_ttl`.
This stops a minter — or a stolen minter key — from minting a capability that lives for a year. The default
`max_ttl` is 7 days (604800 seconds), the same default as the read side, and the write side's value is a
deployment parameter.

### 3.5 `order` — work order id

Must match `^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`.

The order is the unit of revocation and of the quota ledger. It is the submission id of the work order
(`^[0-9]{5}-S[0-9]{3,}$` in the plan tooling; the protocol permits the wider form so that the gateway is not
coupled to one tool's id shape).

### 3.6 `plan` — plan id

Must match `^[a-z0-9][a-z0-9-]{0,63}$`.

The plan id selects the folder template inputs (section 2.4). It is part of the signature so a capability
cannot be moved to another plan's folder.

### 3.7 `task` — task id

Must match `^[0-9]{5}-[1-9][0-9]*-[0-9]{3}-[0-9]{2}$`, the task id pattern of the plan tooling
(`template/engine/schemas/task.schema.json`).

### 3.8 `writer` — writer id

Must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.

It identifies the authorised writer for audit and lease purposes (section 2.5). It is not a secret and carries
no authority on its own.

### 3.9 `head` — expected branch head

Must match `^[0-9a-f]{40}$`: exactly forty **lowercase** hexadecimal characters.

`head` is the commit the submissions branch is expected to be at when the task's commit happens. It is bound
into the capability, and the gateway MUST verify it against the branch head **at commit time**:

- if the branch head still equals `head`, the commit proceeds and becomes the new branch head;
- if the branch head has moved, the commit is refused with `409 expected-sha-conflict`.

This is what makes a commit safe against a concurrent writer and what makes a repeat commit detectable. It is
the same expected-SHA discipline the read side uses to pin content, applied to the write side's destination.

Lowercase is normative, for the same reason as in the read scheme: accepting both spellings would make the
signed bytes depend on the spelling and split every implementation's vectors in two.

### 3.10 What the signature binds

The signature covers every capability field, so changing any one of them invalidates it: `kid` (which key),
`exp` (how long), `order` (whose work order), `plan` and `task` (which folder), `writer` (who may write) and
`head` (what the destination must look like). This is the whole of the tamper resistance of the scheme.

### 3.11 Cross-scheme replay

The read scheme's domain separator is `ctxgate-v1`; this one is `ctxwrite-v1`. A signature computed for one is
therefore never a valid signature for the other, and a read link can never be presented as a write capability
or the reverse. The two gateways MUST NOT share a signing secret for the same `kid`, because doing so would not
break this property (the domain separator still differs) but would make a leak of one key a leak of both.
Separate keys are the rule; the domain separator is the backstop.

---

<a id="operations"></a>

## 4. Operations

### 4.1 Route table

Every operation is a `GET`. There is no other method, and a gateway MUST refuse a non-GET request with
`405 method-not-allowed` and an `Allow: GET` header.

The root path with no operation segment is the **index** (discovery). The operation segment is a path segment
appended to the capability; its parameters are query parameters.

| Route | Parameters | Effect |
|---|---|---|
| `{root}` | — | index: the hypermedia description of the session and its legal next steps |
| `{root}/index` | — | the same index, explicitly |
| `{root}/status` | — | session state, staged file inventory, quota usage, lease state |
| `{root}/create` | `path`, `type?` | scaffold a file |
| `{root}/append` | `path`, `seq`, `hash`, `data` | append one chunk |
| `{root}/replace` | `path`, `seq`, `hash`, `data` | replace the whole file with one chunk |
| `{root}/read` | `path` | read back staged content |
| `{root}/delete` | `path` | soft delete (tombstone) |
| `{root}/commit` | `files`, `idem?` | commit the selected staged files |
| `{root}/seal` | `idem?` | freeze the task folder |

The operation segment MUST be one of the ten names above, matched exactly. Anything else is
`400 unknown-operation`. There is no route for listing other tasks, for reading the audit, for revocation, for
quotas, for creating a folder, or for any repository operation: those are the operator channel (section 14) or
they do not exist.

### 4.2 Parameters

#### Common

| Parameter | Rule |
|---|---|
| encoding | percent-encoding, per RFC 3986, applied to the UTF-8 bytes of the value |
| `+` | a literal plus, **not** a space. A gateway MUST NOT form-decode query values. |
| `%2C` | a literal comma. It is special only in `files`, where the gateway splits the **raw** value on commas and decodes each element afterwards (section 4.2.7). Everywhere else it decodes to a comma like any other character. |
| unknown parameters | refused with `400 unknown-parameter`. A gateway MUST NOT ignore a parameter it does not understand: an ignored parameter is how a client ends up believing it set something it did not. |
| destination parameters | refused with `400 destination-not-selectable`. The parameters that would try to choose the destination — `repo`, `repository`, `branch`, `ref`, `folder`, `dir`, `directory`, `path_prefix`, `submissions_repo`, `submissions_branch`, `task_folder` — get their own code, because an agent that tried one needs to be told that it is not allowed to, not that it spelled something wrong. |
| missing or malformed values | refused with `400 invalid-parameter`. A required parameter that is absent, and a value that does not have the required form, are both this code. |
| repeated parameters | refused with `400 repeated-parameter`, except where the parameter is documented as repeatable (none are). |

#### `path` (create, append, replace, read, delete)

The path of one file, **relative to the task folder**. It is validated by the path rules in section 5.1. It
never starts with the task folder, and it never contains it.

#### `type` (create, optional)

The media type of the file, e.g. `text/markdown`. When absent, the type is derived from the extension by the
type policy (section 7.2). When present, it MUST agree with the extension under the type policy, or the
request is refused with `400 type-mismatch`. The parameter exists so that a file with no extension, or one
whose extension is ambiguous, can still be typed explicitly.

#### `seq` (append, replace)

A positive integer, the **content sequence number** of the file. Rules in section 6.2. Decimal digits only, no
sign, no leading zeros (except `0` is not allowed either: the first chunk is `1`).

#### `hash` (append, replace)

The lowercase hex SHA-256 of the **decoded** chunk bytes: 64 characters, `^[0-9a-f]{64}$`. The gateway
recomputes it and refuses a mismatch with `400 hash-mismatch`. The hash is what makes a replay distinguishable
from a divergent write (section 6.3).

#### `data` (append, replace)

The chunk content, base64url-encoded, padding stripped. The gateway decodes it, checks that it is valid UTF-8
(`400 not-utf8`), checks its decoded byte length against the limits (section 7.1), and never writes it
anywhere durable (ADR 0002).

#### `files` (commit)

A comma-separated list of relative paths, each percent-encoded. The gateway splits on raw `,` **first** and
percent-decodes each element afterwards, so a path whose name contains a comma is unambiguous: the comma in the
name is `%2C`. An empty list is refused with `400 empty-selection`.

#### `idem` (commit, seal, optional)

An idempotency key, `^[A-Za-z0-9_-]{8,64}$`. When absent, the gateway derives a deterministic key from the
request (section 6.3). An explicit key lets an agent retry a commit whose *selection* changed — which then
fails as an idempotency conflict rather than as a second commit.

### 4.3 Response envelope

Every response, success or failure, is a JSON object with the same top-level shape. A gateway MUST NOT return
a bare string, an HTML page, or a different shape per operation.

```json
{
  "protocol": "ctxwrite-v1",
  "op": "append",
  "task": "10008-1-001-01",
  "order": "10008-S001",
  "state": "open",
  "result": { "...": "operation-specific" },
  "links": {
    "contract": "https://write.example.internal/contract/ctxwrite-v1",
    "next": [
      { "rel": "read", "op": "read", "href": "/read?path=intro.md", "required": [] },
      { "rel": "commit", "op": "commit", "href": "/commit", "required": ["files"] }
    ]
  },
  "error": null
}
```

On failure, `result` is `null` and `error` is populated:

```json
{
  "protocol": "ctxwrite-v1",
  "op": "commit",
  "task": "10008-1-001-01",
  "order": "10008-S001",
  "state": "open",
  "result": null,
  "links": {
    "contract": "https://write.example.internal/contract/ctxwrite-v1",
    "help": "https://write.example.internal/contract/ctxwrite-v1/errors#expected-sha-conflict",
    "next": []
  },
  "error": {
    "code": "expected-sha-conflict",
    "message": "the submissions branch has moved since this capability was minted",
    "retryable": false
  }
}
```

Rules:

- `task` and `order` are `null` when the request did not parse far enough to learn them — which
  happens only on a refusal that precedes the capability being read.
- `state` is the session state (section 5.2) as of the response.
- `error.code` is the **authoritative** machine-readable outcome. The HTTP status is a coarse bucket; two
  different codes may share a status. Clients MUST branch on `code`, never on the status alone.
- `error.message` is a short, fixed, human-readable sentence. It MUST NOT contain the request URL, the query
  string, the capability, the payload, file content, or any provider detail.
- `error.retryable` is the client's routing hint. It agrees with the catalogue's retryability column.
- `result.replayed` is `true` when the request was an idempotent replay. The contract's rule is
  that a replay returns the original outcome, and the flag is how the client tells the two apart.
- `links.contract` is the **absolute** URL of this document at the serving gateway (section 4.5).
- `links.help` is present exactly when `error` is present. It is the error catalogue's URL with the error's
  anchor.

<a id="hypermedia"></a>

### 4.4 Hypermedia

> **Links.** Every success response carries next-step links. Agents follow them and never construct URLs from
> memory.

The rules, precisely:

1. Every successful response carries `links.next`, an array of the legal next steps. A gateway MUST NOT return
   an empty `links.next` for a success response, except in the `sealed` state, where the only legal next step
   is to stop.
2. A link is `{ "rel", "op", "href", "required" }`:
   - `rel` is a stable machine-readable name (`index`, `status`, `create`, `append`, `replace`, `read`,
     `delete`, `commit`, `seal`);
   - `op` is the operation name;
   - `href` is **root-relative**: the path and query *after* the capability prefix, always beginning with `/`;
   - `required` lists the parameters the agent must supply, for the operations where they cannot be known in
     advance (`append` and `replace` need `data` and its `hash`; `commit` needs `files`).
3. **A link never contains the capability.** The capability prefix is not echoed in any response body, because
   the agent already holds it and because a body that carries the capability is a body that gets logged
   (ADR 0004, section 10.3). The agent resolves a link as `root + href`.
4. The gateway MUST NOT invent a link to an operation that is not legal in the current state. A `commit` link
   is not offered after a seal; a `seal` link is not offered before a successful commit.
5. A link's `href` MUST NOT contain a parameter value the agent has not been told. Where a value is unknown,
   the parameter is listed in `required` instead.

### 4.5 The contract URL

The canonical contract for this protocol is served by the gateway itself. Three documents are served, and
their URLs are stable and versioned:

| URL | Document |
|---|---|
| `{base}/contract/ctxwrite-v1` | this document — the protocol contract |
| `{base}/contract/ctxwrite-v1/errors` | the error catalogue |
| `{base}/contract/ctxwrite-v1/quotas` | the published quota and type policy |

The **absolute** contract URL is in `links.contract` of every response, so an agent never has to know where the
contract lives and never has to construct it. The operator's minting tool also substitutes it into the tool
prompt at mint time (section 10.5).

### 4.5.1 Section anchors

The anchors below are **stable**: the tool prompt links to them, and a link to an anchor that moves is a
defect. The heading text may be edited; the anchor may not.

| Anchor | Section |
|---|---|
| `#capability` | the root capability: format, bearer semantics, what it authorises |
| `#operations` | the route table and the parameters |
| `#hypermedia` | the link rules |
| `#paths` | the path rules |
| `#sessions` | the session state machine |
| `#lifecycle` | the operation sequence |
| `#quotas` | the quota rules |
| `#type-policy` | the type policy rules |
| `#commit` | the commit contract |
| `#errors` | how errors work; the catalogue is a separate document |
| `#transport` | GET side effects, caching, leakage |
| `#audit` | the audit record |
| `#credential-boundary` | the submissions repository, the credential, the blast radius |
| `#recovery` | what can be lost, and what the agent does about it |

The version is in the path and in the domain separator. A change to the message layout, the signature, the
field rules, the route set, the parameter rules or the envelope is a **new protocol version**: a new path
prefix (`/w2/`), a new domain separator (`ctxwrite-v2`), and a new set of vectors. Existing capabilities keep
their version and keep working. Adding a key id, an operation parameter, an error code, or a link relation is
**not** a version change.

### 4.6 Index (discovery)

`GET {root}` returns the index. It is the first thing an agent sees and the only thing it needs in order to
know what it may do.

```json
{
  "protocol": "ctxwrite-v1",
  "op": "index",
  "task": "10008-1-001-01",
  "order": "10008-S001",
  "state": "open",
  "result": {
    "writer": "agent-7",
    "expires_at": 2000000000,
    "folder": "plans/castiel-dev/submissions/10008-S001/10008-1-001-01",
    "quotas": { "max_files": 20, "max_total_bytes": 245760, "max_file_bytes": 12288,
                "rate_limit": { "requests": 30, "window_seconds": 60 }, "max_concurrency": 1 },
    "type_policy_digest": "sha256:…",
    "committed": null
  },
  "links": { "contract": "…", "next": [ … ] },
  "error": null
}
```

The index MAY report the folder, because the agent's own folder is not a secret to the agent. It MUST NOT
report the repository, the branch, the credential, the `head`, the `kid`, or the `sig`.

---

## 5. Paths, session state, and lifecycle

<a id="paths"></a>

### 5.1 Path rules

A path is **relative to the task folder** and names exactly one file.

The scheme performs **no normalisation**. A path is either already canonical and is accepted exactly as
written, or it is refused. There is no case folding, no Unicode normalisation, no collapsing of separators, no
`.` removal and no resolution of `..`.

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
| no hidden component | a component beginning with `.` is refused (`.git`, `.env`, `.keep`) |
| no Windows reserved name | `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, in any case |
| no trailing dot or space | a component ending in `.` or a space is refused |
| bounded length | at most 240 characters and at most 8 components |

Two consequences worth stating explicitly, because implementations get them wrong:

- **A component may contain `..` as a substring.** `notes/na~me.v1..2.md` is a legal file name and a legal
  path. Only a component that is *exactly* `..` is refused. A gateway MUST NOT implement this as a substring
  test such as `*..*`, which both rejects legal names and can be bypassed by encodings.
- **Unicode is not normalised.** `café/naïve.md` written in NFC and the same text written in NFD are two
  different paths. The signer and the file system must agree on the exact bytes. An implementation MUST NOT
  normalise a path before signing or before verifying.

A path that fails any rule is refused, and MUST be refused by the minter.

**Where the rules are enforced.** A path arrives with every operation that carries one — `create`, `append`,
`replace`, `read` and `delete` (section 4.2) — and the gateway MUST check it against these rules **at that
operation**, and refuse it there with `400 malformed-path`. Two reasons, and the second is the one that matters:

- the path is not part of the capability, so the signature does not cover it and the minter cannot have checked
  it on the agent's behalf. The minter's check is a courtesy; the gateway's check is the rule;
- a path that fails a rule cannot be committed (section 8.2), so a gateway that accepted it at staging time would
  let the agent spend a file slot and a byte budget on a file that can never be delivered, and would only tell it
  at the commit, three steps later.

The failure message MUST NOT echo the path: it is client-supplied text, and the rule that keeps client-supplied
text out of a response body is section 10.3.

<a id="sessions"></a>

### 5.2 Session state

The session is the Durable Object instance for one task. It has exactly one state:

```
open  ──seal──▶  sealed
  │                 │
  ├──revoke──▶ revoked ◀──revoke──┘
  └──close───▶ closed  ◀──close──┘
```

| State | Meaning | Effect on writes |
|---|---|---|
| `open` | the task accepts staging and commits | — |
| `sealed` | the agent declared the folder complete; the folder is frozen | every write is `410 task-sealed` |
| `revoked` | the operator revoked the capability | every write is `410 task-revoked` |
| `closed` | the operator closed the work order | every write is `410 order-closed` |

Rules:

- `sealed` is **irreversible** by the agent. There is no unseal operation. Reopening is an operator action
  (a new capability in a new session, after an operator reset).
- `revoked` and `closed` are **operator-only** transitions. They are not reachable through any agent route,
  and the existence of the operator channel (section 14) is the only way to reach them.
- These three transitions are **distinct state transitions**, not one "closed" flag. A sealed task is complete;
  a revoked task is hostile and was torn down; a closed task simply ran out of its work order. They are
  reported distinctly in `state` and in the audit, and they get distinct error codes, because the operator's
  response to each is different.
- A `committed` fact is **not** a state. It is a durable record inside the session (`committed: {sha, paths,
  hashes, at}`), and it coexists with `open`. A task that has committed is still `open` until it is sealed.

<a id="lifecycle"></a>

### 5.3 Lifecycle

```
discover → create → append… → read-back → commit → seal
             ▲         │                     │
             └─────────┘  (append is replay-safe)
```

1. **Discover.** `GET {root}` returns the index and the legal next steps.
2. **Scaffold.** `create` makes an empty file and reserves its slot in the quota ledger.
3. **Append.** `append` adds one chunk. `replace` sets the whole file to one chunk. Both carry `seq` and
   `hash`.
4. **Read back.** `read` returns the staged bytes, their hash and their sequence number.
5. **Status.** `status` returns the inventory, the quota usage and the session state.
6. **Commit.** `commit` delivers the selected staged files to the configured branch.
7. **Seal.** `seal` freezes the folder. Further writes are `410`.

The agent MAY skip `create` and use `append` or `replace` on a path that does not exist yet; the
gateway creates the file. The two behave the same way, so there is one rule to remember.
It MUST NOT use `read` on a path it has not written and expect content.

---

## 6. Staging: sequence, hashes, idempotency

### 6.1 The chunk identity rule

Every content mutation carries `(path, seq, hash)`. The gateway stores, per file: the last accepted `seq`, the
SHA-256 of the **whole file**, and a bounded replay window of the most recent `(seq, hash)` pairs (16 entries;
the window is bounded because the Durable Object's memory is bounded).

- `seq` is strictly increasing per file. The first chunk of a file is `seq=1`.
- `hash` is the SHA-256 of the chunk's decoded bytes, not of the file. For `replace`, the chunk *is* the whole
  file, so its hash is the file's hash.

### 6.2 Sequence rules

| Situation | Outcome |
|---|---|
| `seq == last_seq + 1` | accepted, the file grows by one chunk |
| `seq <= last_seq` and `(seq, hash)` is in the replay window and the hash matches | **replay**: the original outcome is returned, with `result.replayed = true`. No state changes. |
| `seq <= last_seq` and the hash does not match | `409 sequence-conflict` — a divergent write at an old sequence number |
| `seq <= last_seq` and the pair is outside the replay window | `409 sequence-conflict` — the gateway cannot prove it is a replay, and it fails closed |
| `seq > last_seq + 1` | `409 sequence-gap` — the agent skipped a sequence number |

The gateway does **not** normalise, reorder or buffer out-of-order chunks. A gap is an error, not a queue.

### 6.3 Idempotency

Idempotency applies at two levels.

**Chunk level.** As above: a repeated `(path, seq, hash)` is a replay and returns the original result. This is
what makes `append` safe to retry after a timeout.

**Operation level.** For `commit` and `seal`, the gateway records an idempotency key together with the outcome
and a digest of the logical payload of the request.

- The key is the `idem` parameter when supplied; otherwise it is derived deterministically:
  `auto:<sha256(selection + per-file content hash)>`. The derived key makes a plain retry of the same commit
  idempotent without the agent having to think about it.
- **Same key, same logical payload** → the recorded outcome is returned again, with `result.replayed = true`.
  This is the "commit succeeded but the response was lost" case (section 13.3).
- **Same key, different logical payload** → `409 idempotency-conflict`. Never a second commit, never a silent
  overwrite.
- The key is scoped to the task and the operation.

The key and its outcome are **durable** (ADR 0001). This is the one piece of state that must survive isolate
eviction, because it is the only thing that can prove a commit already happened.

---

## 7. Quotas and the type policy

<a id="quotas"></a>

### 7.1 Quotas

The authoritative numbers are in `src/config/quotas.json`; the published view is
`gateway/write/docs/quotas-and-type-policy.md`. The units are fixed: **binary KiB = 1024 bytes, and bytes are
authoritative.** The "KB is undefined" note that the scaffold file carried is resolved by Stage 1.4.8 and
removed in Stage 5.1.

What the numbers mean, which is the part the JSON cannot say:

| Limit | Accounting | Freed by |
|---|---|---|
| `max_files` | **live** file slots: files that exist and are not tombstoned | a tombstone (`delete`) |
| `max_total_bytes` | **live** staged bytes: the sum of the current byte length of every live file | a tombstone, or content lost to eviction (the bytes are gone) |
| `max_file_bytes` | the byte length of any single file | — |
| `rate_limit` | requests per rolling window, per task | the window |
| `max_concurrency` | concurrent writers per task | — |

**Live, not cumulative.** The quota bounds the size of the *deliverable*, which is what protects the repository
and the reviewer. A tombstone frees a slot and its bytes, so an agent that staged the wrong file can recover.
Content lost to eviction also frees its bytes, because the bytes are genuinely gone; the cumulative count of
bytes ever accepted is reported separately as `bytes_accepted_total`, and the amount lost as `bytes_lost`, so
the operator can see that an eviction happened rather than discovering it in the audit trail.

The **commit** re-validates the selection against the limits. A file that is staged but not selected is not
committed, and the limits apply to the selected set as well as to the staged set.

Quota outcomes:

| Condition | Outcome |
|---|---|
| a chunk would take one file over `max_file_bytes` | `413 file-too-large` |
| a chunk would take the task over `max_total_bytes` | `413 total-bytes-exceeded` |
| the task already holds `max_files` live files | `409 file-count-exceeded` |
| more than `rate_limit.requests` requests in `rate_limit.window_seconds` | `429 rate-limited`, with `Retry-After` |

`409 file-count-exceeded` shares a status with the state conflicts because it is a conflict with the session's
file registry, and the client branches on `code` in any case (section 4.3). The `help` link says what to do
about it, which is the whole point of the catalogue.

<a id="type-policy"></a>

### 7.2 Type policy

The authoritative policy is in `src/config/type-policy.json`; the published view is
`gateway/write/docs/quotas-and-type-policy.md`.

- **Text only.** A file is accepted only if its bytes are valid UTF-8 and its type is allowed. Binary content is
  refused with `400 not-text` (a NUL byte, or a type the policy does not allow).
- Each allowed type declares: the extensions that map to it, its media type, a per-type byte ceiling (never
  above the global `max_file_bytes`), whether an empty file is allowed, and an optional JSON Schema for the
  content.
- A file whose extension is not allowed is refused with `400 type-not-allowed`. The refusal names the allowed
  extensions for that kind of file, because an agent that cannot write `.md` needs to know that `.markdown` is
  the alternative.
- The `type` parameter, when supplied, MUST agree with the extension (`400 type-mismatch`).
- An optional schema is validated when the file is written. A schema failure is `400 schema-invalid`, with the
  failing pointer, and it happens **at write time**, not at commit time: an agent must learn that its file is
  malformed while it can still fix it.
- Empty files are allowed unless the type says otherwise (`400 empty-not-allowed`).

---

<a id="commit"></a>

## 8. Commit, seal, and delivery

### 8.1 Commit

`GET {root}/commit?files=…[&idem=…]`

The commit is the only operation that leaves the gateway's own state and touches the outside world. It is
therefore the most tightly specified operation in this document.

Preconditions, checked in this order, each with its own code:

| # | Check | Failure |
|---|---|---|
| 0 | the idempotency key is **new**, or is being replayed with the same payload | `409 idempotency-conflict` |
| 1 | the session is `open` | `410 task-sealed` / `410 task-revoked` / `410 order-closed` |
| 2 | the selection is not empty | `400 empty-selection` |
| 3 | every selected path is a live staged file | `409 file-not-staged` |
| 4 | every selected file passes the type policy and the size limits | `400 type-not-allowed` / `413 file-too-large` |
| 5 | the selection does not contain a tombstoned path | `409 file-not-staged` |
| 6 | the submissions branch head still equals the capability's `head` | `409 expected-sha-conflict` |

**Check 0 comes first, and that is a correction.** The table used to put the idempotency check
last, and the order it gave was wrong: a commit that succeeded has, by definition, moved the
branch, so a replay would have failed check 6 with `409 expected-sha-conflict` and the agent
would have had no way to find out that its commit had landed. A **replay is not a new commit**,
and none of a new commit's preconditions apply to it — not the branch head, and not the state of
the selection. So the key is looked up first: a key that is not in use continues to the other
checks, a key that is being replayed with the same payload returns the recorded outcome with
`result.replayed = true`, and a key that is being reused with a *different* payload is
`409 idempotency-conflict`. Only then are the other six checked.

**One capability, one commit.** Check 6 pins the commit's parent to the head the capability was
minted against, so a capability authorises exactly one commit: the first commit moves the branch,
and a second commit under the same capability finds a head that no longer matches. A task that
needs two commits needs two capabilities, each minted against the head the other one produced.
This is a consequence of the precondition, not a separate rule, and it is the reason the
idempotent replay has to be checked first.

On success the gateway:

1. writes **only** the selected files, **only** into the task folder, on the configured branch, with the
   configured credential;
2. creates exactly one commit, whose parent is the expected head, with a fixed commit message
   (section 8.3);
3. records the commit durably: sha, selected paths, per-file content hashes, the actor and task binding, the
   result and the timestamp (section 11);
4. returns the commit sha and the selection in `result`.

The gateway MUST NOT, under any circumstance: create a repository, create a branch, create a folder, merge,
open a pull request, push to a second branch, push to the consumer repository, delete anything, or force-push.
A commit is one commit to one branch, on top of one expected parent.

The commit is made in two steps, and the split is what makes the failure modes answerable:

1. the **objects** — a blob per file, a tree, and a commit whose parent is the expected head. None
   of them is referenced by anything, so a failure here leaves nothing on the branch and the whole
   step may be repeated safely;
2. the **delivery** — the branch is moved to that commit, in one call, which is never repeated
   blindly. If that call fails in a way that leaves the outcome unknown, the gateway **looks at
   the branch** and decides from what it finds: the branch is at the commit, so it landed; the
   branch is still at the expected head, so it did not, and the call is repeated; the branch is
   somewhere else, so the gateway **cannot tell**, and the answer is `409 reconcile-required` and
   a human. The gateway never guesses, and never issues a second commit to find out (section
   13.3).

**What the agent sees when the provider fails.** The provider's own status and body are never
passed through; they become the gateway's codes.

| The provider did | The agent gets | Retryable |
|---|---|---|
| refuse the credential (401, 403) | `502 provider-credential-invalid` | no — an operator has to fix it |
| refuse the request otherwise (400, 404) | `502 provider-rejected` | no |
| rate limit the gateway (429) | `429 provider-rate-limited` | yes, with backoff |
| fail or time out (5xx, a timeout, a network failure) | `503 provider-unavailable` | yes, with backoff |
| refuse the reference update (409, 422) | `409 expected-sha-conflict` | no |
| leave the outcome unknown | `409 reconcile-required` | no — stop and ask the operator |

`provider-rate-limited` is the **provider's** limit on the gateway, and it is a different code
from `rate-limited`, which is the gateway's own limit on the agent. An agent that sees the
latter is being throttled for asking too often; an agent that sees the former is being throttled
for the gateway's account, and only the operator can fix that.

### 8.2 Selection rules

- The selection names files **relative to the task folder**; the folder prefix is added by the gateway.
- A selected path that is not staged, or that is tombstoned, is refused. The gateway does not silently drop it:
  a commit that contains fewer files than were asked for is a surprising commit.
- A file that was staged and then lost to eviction is **not** committable. The agent must re-stage it. A
  commit of a partly-lost selection is refused with `409 file-not-staged`, and the `help` link says to run
  `status`.
- The **placeholder file** (section 12.3) is never committable and never appears in a selection.
- The selection is a set, not a list: a repeated path is refused with `400 repeated-parameter`.
- The **separator** between paths is a literal comma, and each path is percent-encoded on its
  own. A caller that percent-encodes the separator as well sends one path with a comma in it; the
  refusal names that mistake, because the file-not-staged code on its own would not.

### 8.3 Commit message

Fixed, generated by the gateway, never supplied by the request:

```
ctxwrite-v1: <task> (<order>)
```

followed by a blank line and a body listing the selected paths, one per line, as relative paths. The message
format is a constant in `src/config/constants.ts` and MUST NOT be influenced by a request.

The commit's **author and committer** are the gateway itself, and not the agent: a commit that
carried the agent's identity could not be told apart from a commit a person made by hand, and
telling them apart is the whole point of the operator's review surface. The identity is
configuration (`GITHUB_COMMIT_AUTHOR`), never a request parameter, and its default names the
gateway.

### 8.4 Seal

`GET {root}/seal[&idem=…]`

- Seal requires a successful commit to exist. A seal without one is refused with
  `409 seal-requires-commit`. This is plan task 5.3.7: "Seal only after the contract-defined successful
  commit/delivery state."
- Seal is idempotent: sealing an already-sealed session returns the recorded outcome, and the state stays
  `sealed`. A repeated seal is not an error.
- Seal is irreversible for the agent. There is no unseal route.
- After a seal, every write, read, status and commit is `410 task-sealed`. The index still answers, so the
  agent can learn *why* it stopped.

### 8.5 Commit and seal are different things

Plan task 5.2.9 requires that seal, work-order closure and operator revocation be distinct state transitions.
They are (section 5.2), and the distinction is preserved in the error codes:

| Event | `state` | Error code on a later write |
|---|---|---|
| the agent sealed the folder | `sealed` | `410 task-sealed` |
| the operator revoked the capability | `revoked` | `410 task-revoked` |
| the operator closed the work order | `closed` | `410 order-closed` |

A commit is not a seal: a commit is a fact, a seal is a transition.

---

<a id="errors"></a>

## 9. Errors

The authoritative catalogue is `gateway/write/docs/error-catalog.md`: every code, its status, its
retryability, what it means and what the client should do. The status codes in use are `400`, `401`, `403`,
`404`, `405`, `409`, `410`, `413`, `429`, `503`.

The two rules that matter most:

- **`401` means "no valid capability was presented"** — malformed path, unknown `kid`, bad signature, or a
  non-GET method on a capability route. Every one of these returns **the same status and the same body**, so a
  caller who cannot authenticate learns nothing about why.
- **`403` means "your capability is valid, and you may not do this"** — expired, over the maximum lifetime, or
  the operation is not permitted for a session in this state. These are distinguishable because the caller
  proved possession of the capability.

`401` and `403` are used in the write protocol in the standard sense, which differs from the read scheme's
"403 for everything". The reason is that the write protocol must give an agent an *actionable* answer — "your
link expired, ask for a new one" versus "someone else is writing" versus "this task is finished" — and that
information is only given to a caller who has already proved possession. The read scheme does not need to
distinguish, because a read link either works or does not.

---

<a id="transport"></a>

## 10. Transport hygiene

### 10.1 The transport, honestly

The transport is **GET with side effects**. This was adopted with the residual risk explicitly accepted
(ADR 0003, plan decision 1.4.1, register R0-005). It is a compatibility constraint for Class B agents that can
only issue HTTPS GET, **not** a claim that GET is semantically safe for mutation, and not a recommendation to
anyone else.

The residual risks that are **not** eliminated by this contract:

- An intermediary, a TLS-terminating proxy, a corporate proxy, or the platform's own request log may retain the
  **full request URL**, path and query. The payload travels in the query string, so it will be visible to them.
- A cache, a prefetcher, a link scanner, a security appliance or a browser extension may issue the request
  without the agent intending it.
- The request may be replayed. The idempotency rules (section 6.3) make a replayed *chunk* harmless and a
  replayed *commit* harmless, but a replayed *seal* is a real action, and the mitigation is the same as for any
  replay: the capability is short-lived and the work order is checked.

What the contract requires, and what the mitigations are:

| Mitigation | Requirement |
|---|---|
| no caching | every response carries `Cache-Control: private, no-store, max-age=0, must-revalidate`, `CDN-Cache-Control: no-store` and `Pragma: no-cache` |
| no redirects | the gateway MUST NOT answer with a 3xx on any route. A redirect would turn a mutating GET into a second request. |
| no referrer leakage | every response carries `Referrer-Policy: no-referrer` |
| no content sniffing | every response carries `X-Content-Type-Options: nosniff` |
| no indexing | every response carries `X-Robots-Tag: noindex, nofollow, noarchive` |
| not a document | responses are JSON or plain text; the gateway never renders HTML and never emits a link the agent's browser might prefetch |
| no echo | a response MUST NOT contain the capability, the raw query string, the payload, or the provider's error text (section 10.3) |
| short life | the capability expires, and the gateway enforces `max_ttl` regardless of the minter (section 3.4) |
| one writer | a second writer is refused, so a replayed request from a different agent cannot corrupt the deliverable (section 2.5) |

### 10.2 Caching and prefetch in practice

`no-store` is a request to a compliant cache, not a guarantee. A proxy that ignores it, or a platform that
logs before the application sees the request, is outside the gateway's control. The contract therefore also
requires that the **deployment** configure the platform's log sampling and retention so that the capability
path prefix is not retained, and that the operator accept the residual risk in writing at deployment time
(section 12.5).

### 10.3 The gateway never echoes what it must not

A failure response, and the audit record, MUST NOT contain:

- the capability prefix, in whole or in part — not in `links.self`, not in an error message, not in a header;
- the raw query string, or any query value that the client supplied verbatim;
- the decoded or encoded payload, or any fragment of file content;
- the signature, the signing secret, the `kid`, or the `head`;
- the GitHub credential, the repository, the branch, or the provider's response body;
- any absolute filesystem path of the runtime.

The envelope (section 4.3) is built field by field for this reason: a field that is not in the schema has no
path into the body.

**A failure body may name a parameter, but only one the contract defines.** A message that says which
parameter is wrong is useful, and the parameter names the contract defines are a fixed set. A name the client
invented is client-supplied text, and the stricter reading of "any query value that the client supplied
verbatim" includes it. So `unknown-parameter` names the operation's own parameters — which the contract
fixes — and never the one that was refused, and `repeated-parameter` names the repeated parameter only when
the contract defines it.

### 10.4 Operator channel

The operator channel is a **separate route namespace with a separate credential**, exactly as on the read side:
`{base}/admin/…`, authenticated with `OPERATOR_TOKEN`, which is a different secret from the signing keys.
Holding a signing key MUST NOT grant operator rights, and holding the operator token MUST NOT mint
capabilities.

| Route | Method | Effect |
|---|---|---|
| `{base}/healthz` | GET | liveness, version, protocol version, effective policy, whether the test clock is on. No protected state. |
| `{base}/admin/revoke` | POST | revoke an order or a task: tear the session down and refuse its capability from then on |
| `{base}/admin/close` | POST | close a work order: state `closed` |
| `{base}/admin/reset-quota` | POST | reset a task's quota ledger after an eviction (section 13.2) |
| `{base}/admin/audit` | GET | read the redacted audit stream for an order |
| `{base}/admin/metrics` | GET | counters only |
| `{base}/admin/mint` | POST | mint a capability for a task, subject to the operator policy |

The operator channel is **not** part of the agent protocol. It is not hypermedia, it is not linked from agent
responses, and the agent has no credential for it. An agent that guesses the path is refused with `401`.

### 10.5 The tool prompt

The agent-facing tool prompt is `gateway/write/docs/proposal/agent-tool-prompt.md`. It is a **map**, not the
contract: the contract is this document, and the prompt says so.

The prompt contains no hard-coded host. Where it refers to the contract it uses the template token
`{{WRITE_GATEWAY_BASE}}`, which the operator's minting tool substitutes with the gateway's base URL at mint
time, producing a versioned canonical contract URL of the form
`{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#sessions`.

A prompt that still contains the literal token `{{` is a prompt that was not substituted, and the agent is
told to ask the operator for the contract URL — which it can also read from the `links.contract` field of any
response. The agent never has to construct an endpoint from memory: the contract URL and the next-step links
both come to it in responses.

---

<a id="audit"></a>

## 11. Audit record

Every request writes exactly one audit record, after the outcome is known, so that it carries the final status.
The record is one JSON object per line. The format is the same shape as the read gateway's, so that an
operator can read both streams with the same eyes.

```json
{"ts": 1700000000, "status": 200, "reason": "ok", "op": "append", "kid": "k1",
 "order": "10008-S001", "task": "10008-1-001-01", "writer": "agent-7",
 "bytes": 128, "files": 1, "replayed": false, "request_id": "…"}
```

- `status` is the HTTP status returned.
- `reason` is the machine-readable cause, and is the same string as `error.code` on a failure.
- `kid` is recorded because it is a selector, not a secret. `sig`, the secret and the `head` are **never**
  recorded.
- `bytes` and `files` are counts, never content.
- `replayed` distinguishes an idempotent replay from a fresh write.

The record is built field by field from a fixed schema (ADR 0004: `src/audit/redaction.ts` is a hard gate for
every log line). A signature, a secret, a payload, a file's content, a raw URL and a query string have **no
path into it**. This is tested with sentinel injection (Stage 5.4.2 implemented the check; Stage 5.5.6 adds the
full capture test).

**Two copies of the stream, and the difference between them.** The **platform's log** is the complete
stream: every request writes exactly one line there, including the requests that never authenticated, and the
operator's log retention decides how long it is kept. The **durable stream** at `{base}/admin/audit` is the
queryable copy of the records that belong to **one order**; it survives a log pipeline that samples, and it is
bounded, because an unbounded audit log is a disk-filling denial of service. A request that never
authenticated has no order, and an order's stream is about that order: those refusals are counted in the
metrics and appear in the platform's log, which is where an operator watches for abuse.

The durable copy is **not trusted**. The Durable Object that holds it rebuilds every record from the fields
it is handed, through the same fixed-schema gate the platform's log uses, and refuses to store a record that
still contains something that looks like a secret. A bug in the Worker, or a compromised one, cannot put a
capability into the durable stream.

Retention and access are operator-controlled. Only the operator, or systems the operator designates, may query
the stream.

---

<a id="credential-boundary"></a>

## 12. The submissions repository and the credential boundary

### 12.1 The decision

Per the amended Stage 1.4.6 (operator decision, 2026-10-26), the gateway writes to a **dedicated, isolated
submissions repository** on an **isolated branch** in it. The earlier choice — the existing private
repository, with path allow-listing only — was withdrawn.

The consequences are not optional, so they are stated here as contract requirements:

- The gateway holds a credential scoped to the **submissions repository only**. That credential has **no access
  to the private consumer repository**. A leak of the credential cannot reach the shipped product.
- Deliverables land in the submissions repository, **not** in the consumer repository. Moving accepted files
  into the consumer repository is an **operator** action, outside this protocol. The transfer path and the
  pre-creation tooling are register entry R0-011, and they are not yet designed.
- The gateway **never** creates a repository, a branch or a folder. The submissions branch and the task folder
  exist before the work order is issued.

### 12.2 Configuration

The destination is entirely configuration. No request can influence any of it.

| Setting | Meaning |
|---|---|
| `SUBMISSIONS_REPO` | `owner/name` of the submissions repository. Fixed at deployment. |
| `SUBMISSIONS_BRANCH` | the isolated branch. Fixed at deployment. |
| `SUBMISSIONS_FOLDER_TEMPLATE` | the folder template, e.g. `plans/{plan}/submissions/{order}/{task}` |
| `GITHUB_TOKEN` | the credential. A secret. Never in `wrangler.toml`. |

The folder is `SUBMISSIONS_FOLDER_TEMPLATE` with `{plan}`, `{order}` and `{task}` filled from the **signed**
capability. A template that does not contain a placeholder, or that contains an unknown one, is a
configuration error and the gateway fails closed (503 `gateway-misconfigured`), exactly as the read gateway
does.

### 12.3 The placeholder file

Git does not store empty folders. For the task folder to exist before the work order is issued, the operator
commits a placeholder file into it. The gateway therefore has to know what to do with it, and this is the
definition that Stage 1.4.6 left to Stage 5.1.

- The placeholder is named `.keep`.
- It is **never** staged, **never** committed, **never** returned by `read`, and **never** listed in `status` as
  a deliverable. It is invisible to the agent.
- The gateway never deletes it. It is the operator's file, and the operator's to remove.
- A `create` of `.keep`, or of any hidden path, is refused by the path rules (section 5.1) — independently of
  this rule.
- The gateway does **not** create the folder. If the task folder does not exist on the branch at commit time,
  the commit is refused with `404 task-folder-missing`, and the agent is told to ask the operator to create it.
  This is the error the Stage 1.4.6 closeout asked Stage 5.1 to define.

### 12.4 The blast radius, stated plainly

The credential is **repository-scoped, not path-scoped**. The gateway's own path checks confine what it will
*choose* to write; they do not narrow what the credential itself *could* do if it leaked.

A leaked credential could, in the submissions repository and nothing else:

- modify or delete any task's submissions, on any branch of that repository;
- read the contents of that repository.

A leaked credential could **not**:

- reach the private consumer repository, in any way — that is the point of the isolated repository;
- reach any other repository;
- create a release, publish a package, or merge a pull request, if the credential is scoped to
  `contents: write` on one repository only.

This is the residual risk of R0-006, restated for the operator. The documentation MUST NOT describe the
credential as path-scoped. The mitigation for the *other* tasks' submissions is review before transfer, not
credential granularity: GitHub does not offer path-scoped write tokens.

### 12.5 Deployment defaults

The deployment is part of the credential boundary, and the defaults are pinned rather than left to a default
(register R0-008):

| Setting | Required value | Why |
|---|---|---|
| `workers_dev` | `false` | a first deploy must not silently expose a public `*.workers.dev` URL |
| `routes` | explicit, operator-named | the gateway must be on a host the operator controls |
| `compatibility_date` | pinned, and reviewed on a deliberate bump | a pinned-but-stale date is its own risk |
| secrets | `wrangler secret put`, never in `wrangler.toml` | G-08 |
| deployment credentials | absent from pull-request jobs | deploy only from protected, reviewed refs (plan 5.4.6) |

The operator accepts the residual transport risk in section 10.1 in writing at deployment time. That is a
process requirement, but it is the only honest way to discharge a risk this contract cannot remove.

---

<a id="recovery"></a>

## 13. Recovery: what can be lost, and what happens then

Plan task 5.1.7 requires this section to be honest. The split is ADR 0001's.

### 13.1 Durable and ephemeral

| Durable — survives isolate eviction, restart and redeploy | Ephemeral — may be lost |
|---|---|
| the writer lease | **file contents**: staged bytes and partial chunks |
| the session state (`open` / `sealed` / `revoked` / `closed`) | the in-flight buffer of a chunk being written |
| idempotency keys and their outcomes | |
| sequence metadata (last `seq`, whole-file hash, replay window) | |
| the quota ledger | |
| the commit record (sha, paths, hashes, at) | |
| the tombstone set | |

The consequence, stated plainly: **the inventory of a task is durable; the content of a task is not.** A
restart can leave the gateway knowing that `intro.md` exists, is 1.2 KiB, ends at `seq=3` and hashes to
`…`, while the bytes themselves are gone.

### 13.2 What the agent sees, and what it can do

`status` reports the difference, per file, and the totals:

```json
{ "path": "intro.md", "content": "missing", "last_seq": 3, "bytes": 0,
  "hash": "…", "tombstoned": false }
```

`content` is `present`, `missing` (durable metadata, ephemeral bytes) or `tombstoned`. The status also reports
`bytes_lost` — the cumulative number of bytes accepted and then lost — and `bytes_accepted_total`.

The recovery path is:

1. `status` shows `content: missing`.
2. The agent issues `create` for that path. Because the content is missing, `create` **resets** the file:
   `last_seq` returns to 0, the file is empty, and the response says `result.resurrected = true`.
3. The agent re-appends the content from `seq=1`.

A `create` on a path whose content is **present** is refused with `409 path-exists` — the gateway does not
silently discard work. A `create` on a tombstoned path resurrects it, which is the "soft delete is reversible
only by re-scaffold" rule the tool prompt states.

Because the quota counts **live** bytes, lost content does not consume budget permanently; it is reported
instead. An operator who wants the task's budget restored in full may use `admin/reset-quota`, which is
recorded in the audit as an operator action.

### 13.3 The commit outcomes

| Situation | What the agent sees | What it should do |
|---|---|---|
| not committed | `404`/`409` on commit, or a commit error | fix staging, commit again |
| committed, response lost | the retry with the same idempotency key returns the **same success**, `result.replayed = true` | nothing |
| same key, different content | `409 idempotency-conflict` | **stop**; ask the operator |
| outcome indeterminate | `409 reconcile-required` | **stop**; ask the operator |
| the provider is slow or down | `503 provider-unavailable`, `429 provider-rate-limited` | retry, with backoff |
| the provider refused the gateway's credential | `502 provider-credential-invalid` | **stop**; ask the operator |
| the branch moved | `409 expected-sha-conflict` | **stop**; the capability is stale, ask for a new one |
| sealed | `410 task-sealed` | stop |
| revoked | `410 task-revoked` | stop |

`reconcile-required` is the honest answer to "I cannot tell whether the commit happened". The gateway MUST NOT
guess, and MUST NOT issue a second commit to find out. It is the state register entry R0-007 asks for, and it
is the one state that needs a human.

---

## 14. Versioning and conformance

### 14.1 Versioning

The protocol version is `ctxwrite-v1`. It appears in the path prefix (`/w1/`), in the domain separator
(`ctxwrite-v1`), in the `protocol` field of every envelope, and in the contract URL.

A change to the message layout, the signature, the field rules, the route set, the parameter rules, the
envelope shape or the state machine is a **new version**: a new path prefix, a new domain separator, a new set
of conformance vectors, and both versions served during a migration. Existing capabilities keep their version
and keep working.

Adding a key id, a link relation, an error code, a type-policy entry or a quota value is **not** a version
change. A quota or type-policy change is a **policy** change and is versioned with the deployment, not with the
protocol.

### 14.2 Conformance

A gateway is conformant when it passes the write conformance suite added in Stage 5.5, which drives it over
plain HTTP, exactly as the read suite drives the read gateway. The suite must cover at least:

- the signing vectors: every valid capability reproduced byte for byte, every invalid one rejected;
- the verification order of section 14.3, including that a forged capability is recorded as a forgery and
  reveals nothing;
- the path rules of section 5.1, including the `..`-as-a-substring case and the percent-encoding cases;
- the sequence and replay rules of section 6.2;
- the idempotency rules of section 6.3;
- the quota and type rules of section 7;
- the commit preconditions of section 8.1, including the expected-SHA conflict;
- the state transitions of section 5.2, including that no agent route can reach `revoked` or `closed`;
- the response headers of section 10.1;
- the log hygiene of section 11, by sentinel injection.

### 14.3 Verification order

A gateway MUST perform these checks in this order, and MUST stop at the first failure. The order is part of
the contract, because it is what makes enumeration impossible.

| # | Check | Failure |
|---|---|---|
| 1 | the method is `GET` | `405 method-not-allowed` |
| 2 | the path parses into the capability (and optionally the operation) | `401 not-authorised` |
| 3 | `kid` is a known key id | `401 not-authorised` |
| 4 | the signature is valid, compared in constant time | `401 not-authorised` |
| 5 | the capability is not expired (`now <= exp`) | `403 capability-expired` |
| 6 | `exp - now <= max_ttl` | `403 ttl-exceeded` |
| 7 | the task is not revoked and the work order is not closed | `410 task-revoked` / `410 order-closed` |
| 8 | the session is `open` (for a write) | `410 task-sealed` |
| 9 | the operation is known | `400 unknown-operation` |
| 10 | the parameters are well formed | `400 …` |
| 11 | the operation is permitted for this session | `409 …` / `413 …` / `429 …` |
| 12 | perform the operation | — |

Steps 2 to 4 MUST all return the **same status and the same body** (`401`), so a caller who cannot
authenticate learns nothing at all. The signature check (4) precedes expiry, lifetime and revocation (5 to 7)
on purpose: a forged capability must not be able to tell "expired" from "revoked" from "sealed".

**The rate limit is not in this table.** It is a resource control, and it runs *before* the ordered
checks, for the same reason the read gateway's abuse gate runs first: a flood must be bounded before
any other work is done. A rate-limited request answers `429` with a `Retry-After`, and it is the only
refusal that is retryable without changing anything.

The health endpoint and the operator channel are outside this table; they have their own authentication.

### 14.4 Test clock

A conformant implementation MUST provide a controllable notion of "now", because the exact comparison against
`exp` is part of the contract. The reference pattern is the read gateway's: an environment variable
`CTXGATE_TEST_CLOCK` (a fixed timestamp) re-read on every request, and a per-request override header honoured
**only** when the process was started with a test-mode switch.

A production deployment MUST NOT enable the test clock, because the override would let a caller extend the life
of an expired capability. The health endpoint reports whether the test clock is on.

---

## 15. Open questions and items this stage defers

Named here rather than left implicit, because the plan's rule G-03 requires unresolved questions to be
recorded.

| # | Question | Owner | Stage |
|---|---|---|---|
| 1 | The submissions-to-consumer transfer path and the pre-creation tooling are undefined. R0-011. The operator must decide whether they are added to the plan. | operator | 5.1.6 / 2.3 / 6.2 |
| 2 | The folder template `SUBMISSIONS_FOLDER_TEMPLATE` must be fixed against a real submissions repository before the pilot. | operator | 6.1 |
| 3 | The read side has a `conformance/` suite; the write side has none. This document is written to be the thing a suite is derived from, but the suite does not exist. | implementation | 5.5 |
| 4 | The write gateway's name is still open (`ctxgate` names the read gateway too). | operator | — |
| 5 | The per-type JSON Schemas are optional and none are specified yet. The policy allows the field; the values are not yet decided. | implementation | 5.2.7 / 6.1 |
| 6 | The default `max_ttl` of 7 days is the read side's default, carried over. The write side may want a shorter one, because a write capability is worth more than a read one. | operator | 5.2.2 / 6.1 |
| 7 | The lease duration is unspecified here; it must be long enough for a slow agent and short enough to recover a dead session. | implementation | 5.2.3 |

---

## 16. Change control

This document is normative and changes only by a reviewed pull request, like any other contract in this
repository. A change to sections 3 (capability and signature), 4 (routes and envelope) or 5.2 (state machine)
requires a protocol version bump and a new set of conformance vectors. A change to the quota or type policy
changes the JSON, and this document is updated to match.

Where this document and an ADR disagree, the ADR records the decision and this document records its
implementation; the disagreement is a defect in one of them and is fixed like any other defect.
