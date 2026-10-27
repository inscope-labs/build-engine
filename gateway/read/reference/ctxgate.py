#!/usr/bin/env python3
"""ctxgate - the context GATEWAY: verifies signed links and serves one file per link.

PROOF OF CONCEPT. NOT PART OF ANY RELEASE: this program lives only in the build-engine source repository
(`gateway/read/reference/`). The link scheme it enforces is defined once, in `template/engine/tools/ctxlink.py`, which is what
ships and what mints links. The production source adapter (GitHub contents API) is described in
docs/CONTEXT-EXPORT.md and is NOT implemented here.

Commands:
  serve    --config gw.json --repo GIT_DIR [--host H] [--port P]         (reference gateway over a local git repo)
  revoke   --config gw.json ORDER                                         (kill every link minted for an order)
  audit    --log FILE --order ID [--expect PATH...]                       (what was fetched, what was refused)

Minting is done with `ctxlink.py mint` (shipped) or plan_tool.py.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "template" / "engine" / "tools"))
# mint is re-exported: the reference tests mint links through this module. SCHEME and now are
# used by the health payload and the test clock.
from ctxlink import KID_RE, ORDER_RE, REF_RE, SCHEME, mint, now, safe_path, sign  # noqa: E402,F401  (single source of truth for the scheme)

DEFAULT_DENY = [r"(^|/)\.git(/|$)", r"(^|/)\.github/", r"(^|/)\.env", r"(?i)(^|/)(secrets?|credentials?)(\.|/|$)", r"\.(pem|key|p12)$"]


class NotFound(Exception):
    pass


class TooLarge(Exception):
    pass


class GitSource:
    """Reads one blob at an immutable commit from a local git repository (PoC stand-in for the GitHub source)."""

    def __init__(self, repo, max_bytes):
        self.repo, self.max_bytes = str(repo), max_bytes

    def _git(self, *args):
        return subprocess.run(["git", "-C", self.repo] + list(args), capture_output=True)

    def read(self, ref, path):
        if self._git("cat-file", "-e", ref + "^{commit}").returncode != 0:
            raise NotFound()
        spec = "%s:%s" % (ref, path)
        t = self._git("cat-file", "-t", spec)
        if t.returncode != 0 or t.stdout.strip() != b"blob":
            raise NotFound()
        size = int(self._git("cat-file", "-s", spec).stdout.strip() or 0)
        if size > self.max_bytes:
            raise TooLarge()
        return self._git("cat-file", "blob", spec).stdout


class Gateway:
    """Transport-independent request handling. Returns (status, headers, body)."""

    def __init__(self, keys, source, allow_prefixes=("",), deny_regex=None, max_bytes=1_000_000,
                 max_ttl=259200, audit_path=None, revoked_path=None, clock_skew_tolerance=0):
        self.keys = {k: (v.encode() if isinstance(v, str) else v) for k, v in keys.items()}
        self.source = source
        self.allow = tuple(allow_prefixes)
        self.deny = [re.compile(r) for r in (DEFAULT_DENY if deny_regex is None else deny_regex)]
        self.max_bytes, self.max_ttl = max_bytes, max_ttl
        self.clock_skew_tolerance = clock_skew_tolerance
        self.audit_path = audit_path
        self.revoked_path = revoked_path

    def health(self):
        """The effective settings that change how a link is judged (conformance/SCHEME.md 9.1).

        The allowed prefixes, the deny patterns, the repository and the secrets are NOT reported:
        those are protected state."""
        return {"status": "ok", "scheme": SCHEME, "clock_skew_tolerance": self.clock_skew_tolerance,
                "max_ttl": self.max_ttl, "max_bytes": self.max_bytes, "key_ids": sorted(self.keys)}

    # -- state
    def revoked(self):
        if self.revoked_path and Path(self.revoked_path).exists():
            return set(json.loads(Path(self.revoked_path).read_text()))
        return set()

    def _audit(self, at, status, reason, kid="-", order="-", ref="-", path="-", nbytes=0, request_id="-"):
        if self.audit_path:
            rec = {"ts": at, "status": status, "reason": reason, "kid": kid, "order": order, "ref": ref, "path": path, "bytes": nbytes, "request_id": request_id}
            with open(self.audit_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, sort_keys=True) + "\n")

    def _forbidden(self, at, reason, **kw):
        request_id = kw.pop("request_id", "-")
        self._audit(at, 403, reason, request_id=request_id, **kw)
        return 403, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, b"forbidden (link invalid, expired or revoked)\n"

    # -- request
    def handle(self, method, raw_path, at=None, request_id=None):
        at = now() if at is None else at
        request_id = request_id or secrets.token_hex(8)
        if method not in ("GET", "HEAD"):
            self._audit(at, 405, "method", request_id=request_id)
            return 405, {"Allow": "GET, HEAD", "Cache-Control": "no-store", "X-Request-Id": request_id}, b"read-only\n"
        raw = raw_path.split("?", 1)[0]
        if re.search(r"%(2f|5c|00)", raw, re.I):
            return self._forbidden(at, "encoded-separator", request_id=request_id)
        parts = raw.split("/")
        # ['', 'v1', kid, exp, order, sig, ref, path...]
        if len(parts) < 8 or parts[0] != "" or parts[1] != "v1":
            return self._forbidden(at, "malformed", request_id=request_id)
        kid, exp_s, order, sig, ref = parts[2], parts[3], parts[4], parts[5], parts[6]
        path = "/".join(unquote(p) for p in parts[7:])
        ctx = dict(kid=kid, order=order, ref=ref, path=path, request_id=request_id)
        if not (KID_RE.match(kid) and ORDER_RE.match(order) and REF_RE.match(ref) and exp_s.isdigit() and safe_path(path)):
            return self._forbidden(at, "malformed", **ctx)
        secret = self.keys.get(kid)
        if secret is None:
            return self._forbidden(at, "unknown-key", **ctx)
        exp = int(exp_s)
        if not hmac.compare_digest(sign(secret, kid, exp, order, ref, path), sig):  # verify BEFORE anything else
            return self._forbidden(at, "bad-signature", **ctx)
        if at > exp + self.clock_skew_tolerance:
            return self._forbidden(at, "expired", **ctx)
        if exp - at > self.max_ttl:
            return self._forbidden(at, "ttl-too-long", **ctx)
        if order in self.revoked():
            return self._forbidden(at, "revoked", **ctx)
        if not any(path.startswith(p) for p in self.allow) or any(rx.search(path) for rx in self.deny):
            return self._forbidden(at, "path-denied", **ctx)
        try:
            body = self.source.read(ref, path)
        except NotFound:
            self._audit(at, 404, "not-found", **ctx)
            return 404, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": request_id}, b"not found\n"
        except TooLarge:
            self._audit(at, 413, "too-large", **ctx)
            return 413, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": request_id}, b"too large\n"
        digest = hashlib.sha256(body).hexdigest()
        self._audit(at, 200, "ok", nbytes=len(body), **ctx)
        headers = {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
                   "X-Content-SHA256": digest, "X-Ctx-Order": order, "X-Request-Id": request_id, "Content-Length": str(len(body))}
        return 200, headers, (b"" if method == "HEAD" else body)


def make_server(gateway, host="127.0.0.1", port=0):
    class H(BaseHTTPRequestHandler):
        def _go(self):
            raw_path = self.path.split("?", 1)[0]
            if raw_path == "/healthz":       # operator/health channel, not a content path
                body = json.dumps(gateway.health(), sort_keys=True).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
            status, headers, body = gateway.handle(self.command, self.path, at=self._conformance_now())
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            if "Content-Length" not in headers:
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _conformance_now(self):
            """Test clock (conformance/SCHEME.md section 11). Inert unless CTXGATE_TEST_CLOCK=1.

            A production deployment MUST NOT set that variable: the override would let a caller
            extend the life of an expired link."""
            if os.environ.get("CTXGATE_TEST_CLOCK") != "1":
                return None
            v = self.headers.get("X-Conformance-Now")
            return int(v) if v and v.isdigit() else None

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _go

        def log_message(self, *a):
            pass

    return ThreadingHTTPServer((host, port), H)


def summarize_audit(log_path, order, expected=()):
    seen, refused, unexpected = {}, [], []
    for line in Path(log_path).read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if r["order"] != order:
            continue
        if r["status"] == 200:
            seen[r["path"]] = seen.get(r["path"], 0) + 1
        else:
            refused.append((r["status"], r["reason"], r["path"]))
    for p in seen:
        if expected and p not in expected:
            unexpected.append(p)
    missing = [p for p in expected if p not in seen]
    return {"served": seen, "refused": refused, "served_but_not_in_order": unexpected, "never_fetched": missing}


# ----------------------------------------------------------------------------- CLI
def main(argv=None):
    p = argparse.ArgumentParser(prog="ctxgate.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("serve"); s.add_argument("--config", required=True); s.add_argument("--repo", required=True)
    s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8787)
    s = sp.add_parser("revoke"); s.add_argument("--config", required=True); s.add_argument("order")
    s = sp.add_parser("audit"); s.add_argument("--log", required=True); s.add_argument("--order", required=True); s.add_argument("--expect", nargs="*", default=[])
    a = p.parse_args(argv)
    if a.cmd in ("serve", "revoke"):
        cfg = json.loads(Path(a.config).read_text())
        if a.cmd == "revoke":
            rp = Path(cfg["revoked_path"])
            cur = set(json.loads(rp.read_text())) if rp.exists() else set()
            cur.add(a.order)
            rp.write_text(json.dumps(sorted(cur)))
            print("revoked %s" % a.order)
            return 0
        gw = Gateway(cfg["keys"], GitSource(a.repo, cfg.get("max_bytes", 1_000_000)), cfg.get("allow_prefixes", [""]),
                     cfg.get("deny_regex"), cfg.get("max_bytes", 1_000_000), cfg.get("max_ttl", 259200), cfg.get("audit_path"),
                     cfg.get("revoked_path"), cfg.get("clock_skew_tolerance", 0))
        srv = make_server(gw, a.host, a.port)
        print("ctxgate listening on http://%s:%d" % (a.host, srv.server_address[1]), flush=True)
        srv.serve_forever()
        return 0
    print(json.dumps(summarize_audit(a.log, a.order, a.expect), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
