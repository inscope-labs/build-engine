# gateway/read/reference

The executable specification of the read gateway: `ctxgate.py` (`serve`, `revoke`, `audit`) over a local git repository,
and `test_ctxgate.py`. It imports the link scheme from `template/engine/tools/ctxlink.py` so there is one definition.
Minting is not here; it is `ctxlink.py mint` (shipped).

    python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'
    python3 gateway/read/reference/ctxgate.py --help

Not proven by it (and not claimed): a deployed gateway, the GitHub-backed source, rate limiting, behaviour behind the
agents' real GET-only proxy. Those are `../production/`. Never part of a release.
