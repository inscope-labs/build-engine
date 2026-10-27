# Operator Runbook

**Status: not written yet. The procedures below are specified; the runbook that will execute them is Stage
5.4.4, and the operational sign-off is Stage 6.**

Stage 5.1 specified the procedures this runbook will document. The normative text is in
[`protocol.md`](protocol.md); the error semantics are in [`error-catalog.md`](error-catalog.md). What is missing
is the operator-facing procedure: the exact commands, the order to do them in, and what to do when each of them
fails.

## What Stage 5.1 specified, and where it is written

| Procedure | Specification | Runbook stage |
|---|---|---|
| mint a capability for a task | protocol 2, 3 | 5.4.4 / 6 |
| monitor a running task | protocol 4.6, 5.2 | 5.4.4 |
| revoke a task | protocol 10.4, 12.2 | 5.4.4 |
| close a work order | protocol 5.2, 10.4 | 5.4.4 |
| reset a task's quota after an eviction | protocol 13.2, 10.4 | 5.4.4 |
| read the audit trail | protocol 11 | 5.4.4 |
| rotate a signing key | protocol 3.3, 3.4 | 5.4.5 |
| rotate the GitHub credential | protocol 12.1 | 5.4.5 |
| deploy, and the deployment defaults | protocol 12.5 | 5.4.6 |
| respond to an incident | — | 6 |

## The operator-only routes

These are specified; the procedures that call them are not written yet. They are **not** part of the agent
protocol, are not hypermedia, and are not linked from any agent response.

| Route | Method | Effect |
|---|---|---|
| `{base}/healthz` | GET | liveness, version, protocol version, effective policy, whether the test clock is on |
| `{base}/admin/revoke` | POST | revoke an order or a task |
| `{base}/admin/close` | POST | close a work order |
| `{base}/admin/reset-quota` | POST | reset a task's quota ledger after an eviction |
| `{base}/admin/audit` | GET | the redacted audit stream for an order |
| `{base}/admin/metrics` | GET | counters only |
| `{base}/admin/mint` | POST | mint a capability |

They are authenticated with `OPERATOR_TOKEN`, which is a **different secret** from the signing keys. Holding a
signing key does not grant operator rights, and holding the operator token does not mint capabilities.

## Two things an operator must do before the first task

Both are stated in the contract because they are part of the credential boundary, not because the procedure is
written here.

1. **Prepare the destination.** The submissions branch and the task folder must exist before the work order is
   issued, with a `.keep` placeholder committed into the folder (git does not store empty folders). The
   gateway never creates a branch or a folder. If the folder is missing at commit time, the commit fails with
   `404 task-folder-missing` and only the operator can fix it.
2. **Accept the residual transport risk in writing.** The transport is a GET with side effects, and the
   residual risk of caching, prefetching and intermediary logging of the request URL is **accepted, not
   eliminated** (ADR 0003, protocol 10.1). The deployment must also be configured so that the platform's own
   logs do not retain the capability path prefix. The acceptance is a process step, because it is the only
   honest way to discharge a risk the protocol cannot remove.

## Not implemented

The routes above do not exist yet. The Worker answers `501` to every request, including `/healthz` and
`/admin/*`. Nothing in this document may be read as a claim that a runbook procedure is executable today.
