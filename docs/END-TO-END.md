# End to end

How the parts fit, and what exists. **Status words** (used the same way everywhere): **implemented** (built, tested, ships in the artifact); **reference only** (working proof of concept in this source repository; never shipped, not deployed); **scaffold** (structure and stubs, no working behaviour); **not started**; **not deployed** (code exists, no running service); **unsupported** (not part of this release).

```
 operator                    read gateway               agent (Class B)           submission               upstream
 ----------                  ------------               ---------------           ----------               --------
 plan_tool order  --mint-->  (verifies link,   <--GET--  fetches context   --deliverable-->  operator: cbridge upload
 plan_tool links              serves one file)           per work order            or  write gateway (required)
 revoke / audit  ---------->  revocation, audit                                              |
                                                                                             v
                                                                              cbridge publish / reconcile -> public repo
```

| Stage | Component | Where | Status |
|---|---|---|---|
| Plan and order | `plan_tool.py order`, work orders, plan templates | `template/engine/` | implemented |
| Mint links | `ctxlink.py`, `plan_tool.py links` | `template/engine/tools/` | implemented |
| Serve context | read gateway, reference | `gateway/read/reference/` | reference only, not deployed |
| Serve context | read gateway, production | `gateway/read/production/` | not started; decisions 0001 to 0004 recorded (Cloudflare, host named in the work order, 24 h default and 72 h maximum link life, configurable prefix allow-list); required for 0.5.0 (Phase 4) |
| Acceptance of any gateway | signing vectors, B1 to B11 | `conformance/` | behaviours written; vectors empty, harness not started (Phase 4.1) |
| Submit deliverables, operator route | `cbridge upload` | `template/operator/` | implemented |
| Submit deliverables, agent route | write gateway | `gateway/write/` | scaffold only: 46 of 48 source files are stubs, the Worker answers 501, all tests are stubs; decisions recorded in `docs/release/PHASE-1.4-WRITE-GATEWAY-DECISIONS.md`; required for 0.5.0 (Phase 5) |
| Move accepted submissions into the consumer repository | not designed | not in the plan yet | not started (register R0-011): the isolated submissions repository decided in Stage 1.4.6 needs a transfer step and pre-creation of the branch and task folder |
| Publish upstream | `cbridge publish`, `reconcile` | `template/operator/` | implemented |
| Revoke and audit | `ctxgate.py revoke`, `audit` | `gateway/read/reference/` only | reference only; a remote channel is required for 0.5.0 (Phases 4 and 5) |
| Release and install | package, verify, update | `release/`, `template/engine/bin/` | implemented; hardening items in the register (Phases 2 and 3) |
| Pilot | one real task end to end | `docs/pilot/` | not started (Phase 6) |

Class A agents (authenticated git or curl) bypass the gateways and read private raw URLs directly (decision 0005).

Where each document lives: design of the read path `template/docs/CONTEXT-EXPORT.md` (shipped); decisions
`docs/decisions/`; this repository's layout `docs/ARCHITECTURE.md`; how to release `docs/RELEASING.md`.
