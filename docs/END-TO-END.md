# End to end

How the parts fit, and what exists for **0.5.0 Basic (Class A-only)**. Class B gateways are **not included in 0.5.0**; they are planned for **0.6.0 Standard**.

**Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

```
 operator                    (no gateway in 0.5.0)      agent (Class A)          submission               upstream
 ----------                                              ---------------          ----------               --------
 plan_tool order  --raw URLs-->                          authenticated           operator: cbridge upload
 plan_tool links   (Class B path                         fetch (task-scoped      or documented Class A
                    unsupported in 0.5.0)                 credential)             path
 revoke / audit    (remote channel                       |                       |
                    unsupported in 0.5.0)                                         v
                                                                      cbridge publish / reconcile -> public repo
```

| Stage | Component | Where | Status (0.5.0 Basic) |
|---|---|---|---|
| Plan and order | `plan_tool.py order`, work orders, plan templates | `template/engine/` | **implemented** |
| Mint links | `ctxlink.py`, `plan_tool.py links` | `template/engine/tools/` | **implemented** (links may be minted; no production gateway serves them in 0.5.0) |
| Serve context | read gateway, reference | `gateway/read/reference/` | reference only, not deployed |
| Serve context | read gateway, production | `gateway/read/production/` | built (Cloudflare Worker, Stage 4.2) and passes the shared conformance suite over real HTTP, 58 cases, 0 failed. **Not deployed; unsupported** in 0.5.0, planned for 0.6.0. Route, environment separation, deploy gate and runbook are Stage 4.3 |
| Acceptance of any gateway | signing vectors, B1–B11 | `conformance/` | **implemented**: 17 valid + 19 invalid vectors, 53 executable cases, a runner and a CI gate (Stage 4.1); **unsupported** against a live deployment in 0.5.0, planned for 0.6.0 |
| Submit deliverables, operator route | `cbridge upload` | `template/operator/` | **implemented** (Class A delivery route) |
| Submit deliverables, agent route | write gateway | `gateway/write/` | **unsupported** in 0.5.0; code on branches; planned for 0.6.0 |
| Move accepted submissions into the consumer repository | transfer path | — | R0-011; deferred unless Class A depends on it |
| Publish upstream | `cbridge publish`, `reconcile` | `template/operator/` | **implemented** |
| Revoke and audit | `ctxgate.py revoke`, `audit` (reference); the production operator channel | `gateway/read/reference/`, `gateway/read/production/` | revoke and audit work in both gateways locally (the production gateway revokes by order over an authenticated admin channel and keeps a bounded audit trail); the remote operator channel is **unsupported** in 0.5.0, planned for 0.6.0: no gateway is deployed |
| Release and install | package, verify, update | `release/`, `template/engine/bin/` | **implemented** (static verification from Stage 3.2) |
| Pilot | full Class B workflow | `docs/pilot/` | **unsupported** in 0.5.0; planned for 0.6.0 |

Class A agents (authenticated git or curl) bypass the gateways and read private raw URLs directly (decision 0005). That is the supported path in 0.5.0.

Where each document lives: product contract `docs/release/PHASE-1.1-PRODUCT-CONTRACT.md` (Basic redesignation 2026-10-29); design of the read path `template/docs/CONTEXT-EXPORT.md` (shipped; already disclaims deployed gateway); decisions `docs/decisions/`; this repository's layout `docs/ARCHITECTURE.md`; how to release `docs/RELEASING.md`.
