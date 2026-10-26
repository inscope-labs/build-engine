# Decisions

Open decisions that block structure or code, taken from section 12 of `template/docs/CONTEXT-EXPORT.md`. One file each:
the question, what the design proposes, what it blocks. Status values: `open`, `decided` (record the answer and the
date in the file). The write gateway keeps its own ADRs in `gateway/write/docs/adr/`.

| # | Decision | Status | Blocks |
|---|---|---|---|
| 0001 | Where the read gateway runs | open | production path steps 2 to 4; ops channel for revoke and audit |
| 0002 | Can the agents' GET-only proxy reach an arbitrary HTTPS host | open | 0001 |
| 0003 | Default and maximum link lifetime | open | gateway config; `engine.json` `ttl_seconds` |
| 0004 | Which path prefixes may be served | open | gateway config; deny list |
| 0005 | Are private raw URLs enough for Class A agents | open | whether Class A needs anything built |
