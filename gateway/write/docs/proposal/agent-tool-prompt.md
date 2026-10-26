
# Tool: Task-Scoped Write Gateway (`ctxgate`)

You are a GET-only agent. This tool lets you create, edit, and deliver text
files into a task-specific folder on `build-engine` without any repository
credential. Your **root URL** is your only secret and scopes every operation.

## Invariants
- **GET only.** No headers, no body, no cookies.
- **Payload in query string** (base64url). Never in headers or body.
- **Uncommitted state is ephemeral.** Staged content may vanish on isolate
  eviction. Always `list` before continuing; re-scaffold/re-append if missing.
  See [session semantics](https://example/AGENTS.md#sessions).
- **One writer per task.** A second caller receives `409`.
- **No secrets in logs.** Do not embed the root URL in shared text.

## Lifecycle
1. **Discover** — GET root URL → returns hypermedia index of legal next steps.
2. **Scaffold** — `…/op=create&path=<p>&type=<t>` → empty file + next-step URL.
3. **Append / replace** — `…/op=append&path=<p>&seq=<n>&hash=<h>&data=<b64>`
   Idempotent on `(seq, hash)`. Repeat identical chunk = safe replay.
4. **Read-back / status** — `…/op=read&path=<p>` · `…/op=status`
5. **Soft delete** — `…/op=delete&path=<p>` (tombstone; reversible only by re-scaffold).
6. **Commit** — `…/commit?files=a.md,b.md` → pushes only listed files. Idempotent.
7. **Seal** — `…/seal` → freezes the folder, marks delivery. Further writes `410`.
   Revocation is operator-only and **not** available via this API.

Every successful response includes **next-step links** — follow them; do not
construct URLs from memory. See [hypermedia contract](https://example/AGENTS.md#hypermedia).

## Quotas & type policy
Enforced on every call; see [quotas](https://example/AGENTS.md#quotas) and
[type policy](https://example/AGENTS.md#type-policy).
- 20 files · 240 KB total · 12 KB / file
- 30 requests / 60 s · concurrency 1
- Allowed extensions and optional schema per `type-policy.json`

## Errors
Failures return a **help link**, not an opaque code. Read it before retrying.
Catalog: [error-catalog.md](https://example/docs/error-catalog.md).
Retryable: `429`, `503` (backoff). Non-retryable: `400`, `409`, `410`, `413`.

## Example
```

GET <root>                                          # discover
GET <root>/op=create&path=intro.md&type=text/md     # scaffold
GET <root>/op=append&path=intro.md&seq=1&hash=<h>&data=<b64>   # write
GET <root>/op=read&path=intro.md                    # verify
GET <root>/commit?files=intro.md                    # deliver
GET <root>/seal                                     # mark done

```

## Rules of engagement
- Never retry `commit` with a different file list to "fix" a failure — commit is
  idempotent per list; adjust staging, then re-commit.
- On `409`, stop. You are not the writer.
- On `410`, the task is sealed. Do not attempt further writes.
- On missing staged files after a pause, treat as eviction: list → re-scaffold.

Full contract: [AGENTS.md](https://example/AGENTS.md) ·
Runbook: [operator-runbook.md](https://example/docs/operator-runbook.md)


*************


Drop-in notes:

· Replace https://example/... with the published AGENTS.md / docs base URL.
· #sessions, #hypermedia, #quotas, #type-policy are section anchors — keep AGENTS.md headings stable so these resolve.
· Kept under ~60 lines on purpose; the tool prompt is a map, AGENTS.md is the contract.