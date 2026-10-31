# gateway/read

The read gateway lets an agent that can only make plain HTTPS GET requests fetch the files of its work order from the
private repository, with no credential of its own. The operator's tooling mints a short-lived signed link per file; the
gateway verifies the link, reads that one file at one pinned commit, and returns it. Design, link format, the ten
checks, threat analysis: `template/docs/CONTEXT-EXPORT.md` (a shipped document).

| Directory | What it is | Status |
|---|---|---|
| `reference/` | Python proof of concept: signing, rules, a local-git file source, an HTTP server, `serve`, `revoke`, `audit`, with tests | reference only: tested locally, not deployed |
| `production/` | The deployable gateway (Cloudflare, decision 0001): a Worker that verifies a signed link and serves one file at one pinned commit | implemented: proven against `conformance/`, with the deployment surface, the deploy gate and the operator runbook (Stage 4.3). **Not deployed** - no environment has been published; unsupported in 0.5.0, planned for 0.6.0 |

The client half (minting links) is not here: it ships as `template/engine/tools/ctxlink.py` and is used by
`plan_tool.py order` and `plan_tool.py links`. Acceptance for any implementation is `conformance/`.
