# gateway/

Context gateways for **Class B agents** (agents that can only make HTTPS GET requests). **Nothing in this directory is
ever part of a release.** `release/manifest.txt` does not list it, and `release/verify.sh` rejects any artifact that
contains it (plus Worker-specific deny rules, see `release/forbidden.txt`).

| Program | Direction | Status |
|---|---|---|
| `ctxgate.py` (+ `test_ctxgate.py`) | **read**: verifies signed, expiring links and serves one file per link | proof of concept, tested |
| `write/` | **write**: a Cloudflare Worker + Durable Object through which an agent stages and commits task deliverables | scaffold only, see `write/README.md` |

Both use the link scheme in `template/engine/tools/ctxlink.py` (the shipped client side), so they cannot drift apart.
Note the shared name: the write gateway is also called `ctxgate` in its proposal (open question 3 in `write/README.md`).

    python3 -m unittest discover -s gateway -p 'test_*.py'    # read gateway tests
    python3 gateway/ctxgate.py --help
    cd gateway/write && npm ci && npm run typecheck           # write gateway scaffold

Design, trust boundaries and the production path of the read gateway: `template/docs/CONTEXT-EXPORT.md`.
