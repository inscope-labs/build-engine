#!/usr/bin/env python3
"""ctxlink - the signed context-link scheme, client side (minting only).

This is the part of the context-gateway design that ships in every release: it lets plan_tool.py and the
operator mint signed, expiring, read-only links for agents that can only make HTTPS GET requests. It holds
the wire format and nothing else. The gateway that VERIFIES and serves these links is a separate program
(`gateway/` in the build-engine source repository) and is deliberately not part of any release.

Link format (all parts are path segments, so GET-only proxies that drop query strings still work):

    {base}/v1/{kid}/{exp}/{order}/{sig}/{ref}/{path...}

    kid    key id (selects the signing secret)             exp    unix seconds, link is dead after this
    order  work order id the link was minted for           ref    40-hex commit sha (immutable content)
    sig    base64url(HMAC-SHA256(secret, message))         path   repo-relative path of ONE file

    message = "ctxgate-v1\\n" + kid + "\\n" + exp + "\\n" + order + "\\n" + ref + "\\n" + path   (UTF-8)

Command:
  mint --base URL --kid K --order ID --ref SHA [--ttl S] PATH...     (secret from $CTXGATE_SECRET)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import os
import re
import sys
import time
from urllib.parse import quote

SCHEME = "ctxgate-v1"
REF_RE = re.compile(r"[0-9a-f]{40}")
ORDER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,63}")
KID_RE = re.compile(r"[A-Za-z0-9_]{1,16}")
MAX_TTL = 259200  # 72 hours: the hard maximum link lifetime (decision 0003)


def now():
    # CTXGATE_NOW is a test hook (fixed clock for reproducible vectors); do not set it when minting real links.
    return int(os.environ.get("CTXGATE_NOW") or time.time())


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def message(kid, exp, order, ref, path):
    return "\n".join([SCHEME, kid, str(exp), order, ref, path]).encode("utf-8")


def sign(secret, kid, exp, order, ref, path):
    return b64u(hmac.new(secret, message(kid, exp, order, ref, path), hashlib.sha256).digest())


def safe_path(path):
    if not path or path.startswith("/") or "\\" in path or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path):
        return False
    return all(p not in ("", ".", "..") for p in path.split("/"))


def mint(base, secret, kid, order, ref, paths, ttl=86400, at=None):
    """Return one signed URL per path. Pure function: no network, no state."""
    if not (KID_RE.fullmatch(kid) and ORDER_RE.fullmatch(order) and REF_RE.fullmatch(ref)):
        raise ValueError("bad kid, order or ref")
    ttl = int(ttl)
    if not 1 <= ttl <= MAX_TTL:
        raise ValueError("ttl must be between 1 and %d seconds" % MAX_TTL)
    exp = (now() if at is None else at) + ttl
    urls = []
    for p in paths:
        if not safe_path(p):
            raise ValueError("unsafe path: %r" % p)
        sig = sign(secret, kid, exp, order, ref, p)
        urls.append("%s/v1/%s/%d/%s/%s/%s/%s" % (base.rstrip("/"), kid, exp, order, sig, ref, "/".join(quote(x, safe="") for x in p.split("/"))))
    return urls


def main(argv=None):
    p = argparse.ArgumentParser(prog="ctxlink.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("mint"); s.add_argument("--base", required=True); s.add_argument("--kid", default="k1")
    s.add_argument("--order", required=True); s.add_argument("--ref", required=True); s.add_argument("--ttl", type=int, default=86400)
    s.add_argument("paths", nargs="+")
    a = p.parse_args(argv)
    secret = os.environ.get("CTXGATE_SECRET")
    if not secret:
        sys.exit("ERROR: set CTXGATE_SECRET")
    try:
        print("\n".join(mint(a.base, secret.encode(), a.kid, a.order, a.ref, a.paths, a.ttl)))
    except ValueError as e:
        sys.exit("ERROR: %s" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
