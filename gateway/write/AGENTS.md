# ctxwrite — the agent contract

**Protocol version: `ctxwrite-v1`.**

This file is the **index** to the write gateway's contract. It is not the contract itself.

The canonical contract is `ctxwrite-v1`, specified in
[`docs/protocol.md`](docs/protocol.md) and served by the gateway at:

```
{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1
```

Your task's root URL is a **bearer capability**: it is your only secret, and anyone who has it can do what you
can do, for that task, until it expires or is revoked. Treat it accordingly — never paste it into shared text,
never put it in a commit message, never put it in a document anyone else can read.

**The contract URL is also in the `links.contract` field of every response the gateway gives you.** If the URL
below still contains the literal `{{`, the prompt was not substituted: use the `links.contract` value from any
response instead, or ask the operator.

## Section anchors

These anchors are stable. The prompt and every tool link to them, and a link to an anchor that moves is a
defect.

| Anchor | What it covers |
|---|---|
| [`#capability`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#capability) | the root URL, what it authorises, what it does not |
| [`#operations`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#operations) | the routes and their parameters |
| [`#hypermedia`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#hypermedia) | the link rules — follow the links, do not build URLs |
| [`#paths`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#paths) | the path rules for staged files |
| [`#sessions`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#sessions) | the session state machine, one writer, sealed and closed tasks |
| [`#lifecycle`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#lifecycle) | the order of operations |
| [`#quotas`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#quotas) | the quota rules and what frees them |
| [`#type-policy`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#type-policy) | the type rules: text only, allow-list, UTF-8 |
| [`#commit`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#commit) | how a commit works and what it refuses |
| [`#errors`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#errors) | how errors work; the catalogue is [here]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/errors) |
| [`#transport`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#transport) | GET side effects, caching, and what leaks |
| [`#audit`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#audit) | what is recorded about your requests |
| [`#credential-boundary`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#credential-boundary) | where files land, and what the gateway's credential can reach |
| [`#recovery`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#recovery) | what can be lost, and what to do about it |

## The rules that matter most

These are the ones that, broken, either corrupt a deliverable or waste a task.

1. **Follow the links.** Every successful response carries `links.next`. They are root-relative: resolve one as
   `your root URL + href`. Never construct an endpoint from memory.
2. **One writer per task.** A second caller gets `409 writer-conflict`. On that error, **stop** — you are not
   the writer, and retrying will not help.
3. **Content is ephemeral until it is committed.** Staged bytes live in memory and can vanish when the
   gateway's isolate is recycled. If `status` reports a file's content as `missing`, re-create it and send it
   again. See [`#recovery`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1#recovery).
4. **Send `seq` and `hash` with every chunk.** `seq` increases by one per chunk per file. `hash` is the
   lowercase hex SHA-256 of the **decoded** bytes. A repeated `(seq, hash)` is a safe replay; a different
   hash at an old `seq` is refused.
5. **A commit is idempotent, and only for one file list.** Retry a failed commit with the *same* list and the
   *same* idempotency key. Never retry with a different list to "fix" a failure — adjust the staging, then
   commit again.
6. **Seal last.** A seal is irreversible. It requires a successful commit first.
7. **On `410`, stop.** The task is sealed, revoked, or its work order is closed. Further writes are refused.
8. **On `409 reconcile-required`, stop and ask the operator.** It means the gateway could not determine
   whether an earlier commit succeeded. Retrying could produce a second commit.
9. **Never put the root URL in shared text, a commit message, or any file you stage.** The staged files are
   delivered to a repository that people read.
10. **The gateway never creates anything.** It commits into a folder the operator prepared. If a commit fails
    with `404 task-folder-missing`, that is the operator's to fix, not yours.

## What the gateway will not do for you

- It will not choose a repository, a branch or a folder for you. Those come from your capability.
- It will not merge, publish, or push anywhere except the one configured submissions branch.
- It will not give you a repository credential, and it will not ask you for one.
- It will not read, list or modify another task.
- It will not let you choose which files to read from the repository. You read back only what you staged.

## The numbers, in one place

The quota numbers and the allowed file types are published at
[`{{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/quotas`]({{WRITE_GATEWAY_BASE}}/contract/ctxwrite-v1/quotas).
They are in the responses too: the index reports the effective quotas, and `status` reports your current
usage.

## Not implemented

The contract is specified; the gateway is not implemented. The Worker answers `501` to every request. Nothing
on this page claims otherwise — see the protocol's "not implemented" note and the Stage 5.1 closeout for what
exists and what does not.
