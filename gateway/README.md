# gateway/

The signed-link context gateway (proof of concept): `ctxgate.py serve | revoke | audit`, with tests.

**This directory is never part of a release.** `release/manifest.txt` does not list it, and `release/verify.sh`
rejects any artifact containing it. It imports the link scheme from `template/engine/tools/ctxlink.py` (the shipped
client side), so gateway and clients cannot drift apart.

    python3 -m unittest discover -s gateway -p 'test_*.py'
    python3 gateway/ctxgate.py --help

Design, trust boundaries and the production path: `template/docs/CONTEXT-EXPORT.md`.
