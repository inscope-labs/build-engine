# Decisions

Decisions that block structure or code, taken from section 12 of `template/docs/CONTEXT-EXPORT.md`. One file each:
the question, what the design proposes (or the final decision), what it blocks. Status values: `open`, `decided`
(record the answer and the date in the file). The write gateway keeps its own ADRs in `gateway/write/docs/adr/`.

| # | Decision | Status | Blocks |
|---|---|---|---|
| 0001 | Where the read gateway runs | **decided** (2026-10-26) | production path; ops channel for revoke and audit |
| 0002 | Can the agents' GET-only proxy reach an arbitrary HTTPS host | **decided** (2026-10-26) | 0001; write-gateway reachability |
| 0003 | Default and maximum link lifetime | **decided** (2026-10-26) | gateway config; `engine.json` `ttl_seconds` |
| 0004 | Which path prefixes may be served | **decided** (2026-10-26) | gateway config; deny list; conformance B7 |
| 0005 | Are private raw URLs enough for Class A agents | **decided** (2026-10-26) | whether Class A needs anything built |
| 0006 | The next release is 0.6.0 Standard (label, protocol identifier, cbridge scope, task state) | **decided** (2026-11-02) | release metadata; BE-0 documents; operator-console scope |
| 0007 | Acceptance of Class B residual risks R0-005 and R0-007 | **decided** (2026-11-02) | Standard residual-risk blocker |
| 0008 | Hosting scope, hostnames and repositories (amends 0001) | **decided** (2026-11-02), open items DX-1, DX-2 | gate change; production deploy |
| 0009 | Repository protection | **decided** (2026-11-02) | R0-004 |
