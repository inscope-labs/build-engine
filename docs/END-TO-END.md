# End to end

How the parts fit, and what exists. Status words: **built** (code and tests), **scaffold** (structure only),
**not started**, **open** (blocked on a decision).

```
 operator                    read gateway               agent (Class B)           submission               upstream
 ----------                  ------------               ---------------           ----------               --------
 plan_tool order  --mint-->  (verifies link,   <--GET--  fetches context   --deliverable-->  operator: cbridge upload
 plan_tool links              serves one file)           per work order            or  write gateway (proposed)
 revoke / audit  ---------->  revocation, audit                                              |
                                                                                             v
                                                                              cbridge publish / reconcile -> public repo
```

| Stage | Component | Where | Status |
|---|---|---|---|
| Plan and order | `plan_tool.py order`, work orders, plan templates | `template/engine/` | built |
| Mint links | `ctxlink.py`, `plan_tool.py links` | `template/engine/tools/` | built |
| Serve context | read gateway, reference | `gateway/read/reference/` | built (proof of concept), not deployed |
| Serve context | read gateway, production | `gateway/read/production/` | not started; open: decisions 0001 to 0004 |
| Acceptance of any gateway | signing vectors, B1 to B11 | `conformance/` | behaviours written; vectors and harness not started |
| Fallback read path | object-storage variant | `variants/object-storage/` | design only |
| Submit deliverables, operator route | `cbridge upload` | `template/operator/` | built |
| Submit deliverables, agent route | write gateway | `gateway/write/` | scaffold; open design questions in its README |
| Publish upstream | `cbridge publish`, `reconcile` | `template/operator/` | built |
| Revoke and audit | `ctxgate.py revoke`, `audit` | `gateway/read/reference/` only | **gap**: not in a release, no remote channel (`gateway/read/production/ops/`) |
| Release and install | package, verify, update | `release/`, `template/engine/bin/` | built |
| Pilot | one real task end to end | `docs/pilot/` | not started |

Class A agents (authenticated git or curl) bypass the gateways and read private raw URLs directly (decision 0005).

Where each document lives: design of the read path `template/docs/CONTEXT-EXPORT.md` (shipped); decisions
`docs/decisions/`; this repository's layout `docs/ARCHITECTURE.md`; how to release `docs/RELEASING.md`.
