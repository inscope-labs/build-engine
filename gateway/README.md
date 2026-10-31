# gateway/

Context gateways for **Class B agents** (agents that can only make HTTPS GET requests). **Nothing in this directory is
ever part of a release.** `release/manifest.txt` does not list it, and `release/verify.sh` rejects any artifact that
contains it (plus Worker-specific deny rules, see `release/forbidden.txt`).

```
gateway/
├── read/                      the READ gateway: serves one file per signed link
│   ├── reference/             tested proof of concept (Python), the executable spec
│   └── production/            the deployable port (structure only; hosting decided: Cloudflare)
│       ├── source-adapter/    GitHub-backed file source
│       ├── rules/             the ten gateway checks, ported to the chosen runtime
│       └── ops/               rate limiting, alerting, retention, key rotation, revoke/audit channel
└── write/                     the WRITE gateway: a Cloudflare Worker for submitting deliverables (scaffold)
```

| Program | Direction | Status |
|---|---|---|
| `read/reference/` | read: verifies signed, expiring links and serves one file per link | reference only, tested locally, not deployed |
| `read/production/` | read: the real deployment of the same rules | implemented (Cloudflare Worker) and proven against `conformance/`; **not deployed**; unsupported in 0.5.0, planned for 0.6.0 |
| `write/` | write: stage and commit task deliverables through one secret root URL | core request/session lifecycle (Stage 5.2), GitHub delivery (Stage 5.3) and audit/privacy/operations (Stage 5.4) implemented; **not deployed**; unsupported in 0.5.0, planned for 0.6.0; see `write/README.md` |

Both gateways use the link scheme in `template/engine/tools/ctxlink.py` (the shipped client side), and any read-gateway
implementation must pass `conformance/`. The write gateway is also called `ctxgate` in its proposal (name still open, see
`write/README.md`).

    python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'
    cd gateway/write && npm ci && npm run typecheck

The end-to-end picture, with what is built and what is not: `docs/END-TO-END.md`.
