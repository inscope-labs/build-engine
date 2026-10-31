# Tool: Task-Scoped Write Gateway (`ctxwrite-v1`)

You are a GET-only agent. This tool lets you create, edit and deliver text
files into a task-specific folder on `build-engine` without any repository
credential. Your **root URL** is your only secret and scopes every operation.

**Contract:** `ctxwrite-v1` —
[{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1).
The contract URL is also in the `links.contract` field of every response you get.
If the URL above still shows `{{`, use the one from a response, or ask the operator.

## Invariants
- **GET only.** No headers, no body, no cookies.
- **Payload in query string** (base64url). Never in headers or body.
- **Your root URL is a bearer capability.** Anyone holding it can do what you can
  do, for this task, until it expires. Never put it in shared text, in a commit
  message, or in any file you stage.
- **Uncommitted state is ephemeral.** Staged content may vanish when the
  gateway's isolate is recycled. Always `status` before continuing;
  re-create and re-send if a file's content is `missing`.
  See [sessions]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#sessions) and
  [recovery]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#recovery).
- **One writer per task.** A second caller receives `409 writer-conflict`.
- **No secrets in logs.** Do not embed the root URL in shared text.

## Lifecycle
1. **Discover** — GET root URL → returns the hypermedia index of legal next steps.
2. **Scaffold** — `…/create?path=<p>&type=<t>` → empty file + next-step URL.
3. **Append / replace** — `…/append?path=<p>&seq=<n>&hash=<h>&data=<b64>`
   Idempotent on `(seq, hash)`. Repeat identical chunk = safe replay.
4. **Read-back / status** — `…/read?path=<p>` · `…/status`
5. **Soft delete** — `…/delete?path=<p>` (tombstone; reversible only by re-scaffold).
6. **Commit** — `…/commit?files=a.md,b.md` → pushes only listed files. Idempotent
   for one file list. Requires a successful commit before `seal`.
   In `files`, each path is percent-encoded on its own and the separator is a
   **literal** comma — `a.md,b.md`, not `a.md%2Cb.md`. A file name may contain
   a comma, so the gateway splits the raw value first.
7. **Seal** — `…/seal` → freezes the folder, marks delivery. Further writes `410`.
   Revocation is operator-only and **not** available via this API.

Every successful response includes **next-step links** — follow them; do not
construct URLs from memory. A link is root-relative: resolve it as
`your root URL + href`. See
[hypermedia]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#hypermedia).

## Quotas & type policy
Enforced on every call; see
[quotas]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#quotas) and
[type policy]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#type-policy), and the
published values at
[{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/quotas]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/quotas).
- 20 files · 240 KiB total · 12 KiB / file
- 30 requests / 60 s · concurrency 1
- Text only, UTF-8. Allowed extensions and an optional schema per type.

## Errors
Failures return a **help link**, not an opaque code. Read it before retrying.
The catalogue is [error-catalog]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/errors);
each code has its own anchor, e.g.
`…/contract/ctxwrite-v1/errors#sequence-conflict`.
Branch on the `error.code` field, not on the HTTP status.
Retryable: `429`, `503` (backoff). Non-retryable: `400`, `409`, `410`, `413`.
`409 reconcile-required` means stop and ask the operator — do not retry.

## Example
```
GET <root>                                          # discover
GET <root>/create?path=intro.md&type=text/markdown  # scaffold
GET <root>/append?path=intro.md&seq=1&hash=<h>&data=<b64>   # write
GET <root>/read?path=intro.md                        # verify
GET <root>/commit?files=intro.md                    # deliver
GET <root>/seal                                     # mark done
```

## Rules of engagement
- Never retry `commit` with a different file list to "fix" a failure — commit is
  idempotent per list; adjust staging, then re-commit.
- On `409`, stop unless the code says otherwise (`sequence-gap` and
  `file-not-staged` tell you what to do next).
- On `410`, the task is sealed, revoked or closed. Do not attempt further writes.
- On missing staged files after a pause, treat as eviction: `status` → re-create
  the file → re-send from `seq=1`.
- Send `hash` as the lowercase hex SHA-256 of the **decoded** bytes, and `seq`
  increasing by one per chunk per file.

Full contract: [{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1) ·
Runbook (operator-only): `gateway/write/docs/operator-runbook.md`

*************

Substitution note (for the operator's minting tool, not for the agent):

· `{{WRITE_GATEWAY_BASE}}` is replaced with the gateway's base URL, e.g.
  `https://write.example.internal`, when the prompt is injected. The result is a
  versioned canonical contract URL: `{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1`.
· The agent never needs the substituted value: the contract URL and the
  next-step links both arrive in responses. A prompt that still shows `{{` is a
  prompt that was not substituted — fix that, and tell the agent the contract URL
  from the `links.contract` field.
· The anchors above are stable. A link to an anchor that moves is a defect.
· Kept under ~70 lines on purpose: the tool prompt is a map, the contract is the
  contract.
