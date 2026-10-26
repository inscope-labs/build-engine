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
