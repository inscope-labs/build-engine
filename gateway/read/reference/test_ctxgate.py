#!/usr/bin/env python3
"""Tests for gateway/read/reference/ctxgate.py (context gateway proof of concept). Not shipped in releases."""
import hashlib
import io
import json
import contextlib
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxgate as cg  # noqa: E402  (also puts the shipped ctxlink on sys.path)
import ctxlink  # noqa: E402

SECRET = b"test-secret"
ORDER = "10008-S001"


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo)] + list(args), check=True, capture_output=True, text=True,
                          env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t",
                               "GIT_COMMITTER_EMAIL": "t@x", "PATH": "/usr/bin:/bin:/usr/local/bin"}).stdout.strip()


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")
        (self.repo / "amk").mkdir()
        (self.repo / "amk" / "spec.md").write_text("normative text\n")
        (self.repo / "amk" / "big.md").write_text("x" * 5000)
        (self.repo / "docs").mkdir()
        (self.repo / "docs" / "other.md").write_text("outside the allowed prefix\n")
        (self.repo / ".github").mkdir()
        (self.repo / ".github" / "wf.yml").write_text("secret workflow\n")
        (self.repo / "amk" / "secrets.md").write_text("denied by name\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "init")
        self.ref = git(self.repo, "rev-parse", "HEAD")
        self.audit = self.tmp / "audit.jsonl"
        self.revoked = self.tmp / "revoked.json"
        self.gw = cg.Gateway({"k1": SECRET}, cg.GitSource(self.repo, 4000), allow_prefixes=("amk/",),
                             audit_path=str(self.audit), revoked_path=str(self.revoked), max_bytes=4000, max_ttl=3600)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def url(self, path, ttl=600, at=1000, order=ORDER, ref=None):
        u = cg.mint("https://gw.example", SECRET, "k1", order, ref or self.ref, [path], ttl=ttl, at=at)[0]
        return u[len("https://gw.example"):]

    def get(self, path_url, at=1000, method="GET"):
        return self.gw.handle(method, path_url, at=at)


class TestGateway(Fixture):
    def test_valid_link_returns_content_and_hash(self):
        status, h, body = self.get(self.url("amk/spec.md"))
        self.assertEqual((status, body), (200, b"normative text\n"))
        self.assertEqual(h["X-Content-SHA256"], hashlib.sha256(b"normative text\n").hexdigest())
        self.assertEqual(h["Cache-Control"], "private, no-store")
        self.assertEqual(h["X-Ctx-Order"], ORDER)

    def test_head_has_headers_without_body(self):
        status, h, body = self.get(self.url("amk/spec.md"), method="HEAD")
        self.assertEqual((status, body), (200, b""))
        self.assertEqual(h["Content-Length"], str(len(b"normative text\n")))

    def test_only_get_and_head(self):
        for m in ("POST", "PUT", "DELETE", "PATCH"):
            self.assertEqual(self.get(self.url("amk/spec.md"), method=m)[0], 405)

    def test_expired_link(self):
        u = self.url("amk/spec.md", ttl=60, at=1000)
        self.assertEqual(self.get(u, at=1060)[0], 200)
        self.assertEqual(self.get(u, at=1061)[0], 403)

    def test_tampered_fields_are_refused(self):
        u = self.url("amk/spec.md")
        parts = u.split("/")  # ['', 'v1', kid, exp, order, sig, ref, 'amk', 'spec.md']
        for idx, val in ((3, "999999"), (4, "10008-S002"), (5, "A" * 43), (6, "b" * 40), (8, "big.md"), (2, "k2")):
            p = list(parts)
            p[idx] = val
            self.assertEqual(self.get("/".join(p))[0], 403, "field %d" % idx)

    def test_cannot_mint_forever(self):
        self.assertEqual(self.get(self.url("amk/spec.md", ttl=7200))[0], 403)  # gateway max_ttl is 3600

    def test_revocation_by_order(self):
        u = self.url("amk/spec.md")
        self.assertEqual(self.get(u)[0], 200)
        self.revoked.write_text(json.dumps([ORDER]))
        self.assertEqual(self.get(u)[0], 403)
        self.assertEqual(self.get(self.url("amk/spec.md", order="10008-S002"))[0], 200)  # other orders unaffected

    def test_path_policy_even_with_a_valid_signature(self):
        for p in ("docs/other.md", ".github/wf.yml", "amk/secrets.md"):
            self.assertEqual(self.get(self.url(p))[0], 403, p)

    def test_traversal_and_encoded_separators(self):
        good = self.url("amk/spec.md").split("/")
        for tail in (["amk", "..", "docs", "other.md"], ["amk%2Fspec.md"], ["amk", "spec.md%00"]):
            self.assertEqual(self.get("/".join(good[:7] + tail))[0], 403)

    def test_not_found_and_too_large_only_after_authentication(self):
        self.assertEqual(self.get(self.url("amk/missing.md"))[0], 404)
        self.assertEqual(self.get(self.url("amk/big.md"))[0], 413)
        self.assertEqual(self.get(self.url("amk/spec.md", ref="c" * 40))[0], 404)  # unknown commit
        forged = self.url("amk/missing.md").replace("/v1/k1/", "/v1/k2/")
        self.assertEqual(self.get(forged)[0], 403)  # unauthenticated callers learn nothing about existence

    def test_audit_trail_and_summary(self):
        self.get(self.url("amk/spec.md"))
        self.get(self.url("amk/spec.md"))
        self.get(self.url("docs/other.md"))
        self.get(self.url("amk/spec.md", ttl=1, at=0), at=500)
        lines = [json.loads(l) for l in self.audit.read_text().splitlines()]
        self.assertEqual([(l["status"], l["reason"]) for l in lines], [(200, "ok"), (200, "ok"), (403, "path-denied"), (403, "expired")])
        self.assertTrue(all(l["order"] == ORDER for l in lines))
        s = cg.summarize_audit(self.audit, ORDER, expected=["amk/spec.md", "amk/never.md"])
        self.assertEqual(s["served"], {"amk/spec.md": 2})
        self.assertEqual(s["never_fetched"], ["amk/never.md"])
        self.assertEqual(len(s["refused"]), 2)


class TestOverHttp(Fixture):
    """A limited agent: plain HTTPS-style GET, no headers, no authentication."""

    def setUp(self):
        super().setUp()
        self.srv = cg.make_server(self.gw, "127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        super().tearDown()

    def fetch(self, path, method="GET"):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path), method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def test_plain_get_end_to_end(self):
        import time
        u = cg.mint("", SECRET, "k1", ORDER, self.ref, ["amk/spec.md"], ttl=600, at=int(time.time()))[0]
        status, body, headers = self.fetch(u)
        self.assertEqual((status, body), (200, b"normative text\n"))
        self.assertEqual(headers["X-Content-SHA256"], hashlib.sha256(body).hexdigest())

    def test_http_refusals(self):
        import time
        at = int(time.time())
        ok = cg.mint("", SECRET, "k1", ORDER, self.ref, ["amk/spec.md"], ttl=600, at=at)[0]
        self.assertEqual(self.fetch(ok.replace("spec.md", "big.md"))[0], 403)  # tampered path
        self.assertEqual(self.fetch(cg.mint("", SECRET, "k1", ORDER, self.ref, ["amk/spec.md"], ttl=1, at=at - 100)[0])[0], 403)  # expired
        self.assertEqual(self.fetch(ok, method="POST")[0], 405)
        self.assertEqual(self.fetch("/")[0], 403)


class TestCli(Fixture):
    def run_cli(self, *args, env=None):
        out = io.StringIO()
        import os
        old = dict(os.environ)
        os.environ.update(env or {})
        try:
            with contextlib.redirect_stdout(out):
                rc = cg.main(list(args))
        finally:
            os.environ.clear()
            os.environ.update(old)
        return rc, out.getvalue()

    def test_revoke_and_audit_commands(self):
        cfg = self.tmp / "gw.json"
        cfg.write_text(json.dumps({"keys": {"k1": "test-secret"}, "revoked_path": str(self.revoked)}))
        self.run_cli("revoke", "--config", str(cfg), ORDER)
        self.assertEqual(json.loads(self.revoked.read_text()), [ORDER])
        self.get(self.url("amk/spec.md"))
        rc, out = self.run_cli("audit", "--log", str(self.audit), "--order", ORDER, "--expect", "amk/spec.md")
        self.assertEqual(json.loads(out)["served"], {})  # the fetch above was refused: the order is revoked

    def test_links_minted_by_the_shipped_client_are_accepted(self):
        u = ctxlink.mint("https://gw.example", SECRET, "k1", ORDER, self.ref, ["amk/spec.md"], ttl=600, at=1000)[0]
        status, _, body = self.get(u[len("https://gw.example"):])
        self.assertEqual((status, body), (200, b"normative text\n"))


if __name__ == "__main__":
    unittest.main()
