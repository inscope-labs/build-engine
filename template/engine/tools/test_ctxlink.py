#!/usr/bin/env python3
"""Tests for ctxlink.py (signed context-link minting, the shipped client side of the context gateway)."""
import contextlib
import io
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxlink as cg  # noqa: E402

SECRET = b"test-secret"
ORDER = "10008-S001"


class TestSigning(unittest.TestCase):
    def test_known_vector_for_other_implementations(self):
        # A non-Python gateway (e.g. an edge function) must reproduce these exact values.
        self.assertEqual(cg.sign(SECRET, "k1", 2000000000, ORDER, "a" * 40, "amk/amk-ssot.md"),
                         "b5aVA1G6MJDhZy5mkIkSFeUMFBM0W-tixIb2w4XHEU8")
        self.assertEqual(
            cg.mint("https://gw.example", SECRET, "k1", ORDER, "a" * 40, ["amk/amk-ssot.md", "dir with space/\u00e9.md"], ttl=60, at=1999999940),
            ["https://gw.example/v1/k1/2000000000/10008-S001/b5aVA1G6MJDhZy5mkIkSFeUMFBM0W-tixIb2w4XHEU8/" + "a" * 40 + "/amk/amk-ssot.md",
             "https://gw.example/v1/k1/2000000000/10008-S001/4uVmL-XTNscad03rgK7xgPnBv7rnzqWHGF5GDa2lyc4/" + "a" * 40 + "/dir%20with%20space/%C3%A9.md"])

    def test_mint_rejects_bad_inputs(self):
        for kw in ({"order": "bad order"}, {"ref": "main"}, {"kid": "k 1"}):
            args = dict(kid="k1", order=ORDER, ref="a" * 40)
            args.update(kw)
            with self.assertRaises(ValueError):
                cg.mint("https://g", SECRET, args["kid"], args["order"], args["ref"], ["a.md"])
        for bad in ("../x", "/abs", "a//b", "a/./b", "a\\b", ""):
            with self.assertRaises(ValueError):
                cg.mint("https://g", SECRET, "k1", ORDER, "a" * 40, [bad])

    def test_signature_binds_every_field(self):
        base = cg.sign(SECRET, "k1", 5, ORDER, "a" * 40, "p.md")
        for args in (("k2", 5, ORDER, "a" * 40, "p.md"), ("k1", 6, ORDER, "a" * 40, "p.md"), ("k1", 5, "10008-S002", "a" * 40, "p.md"),
                     ("k1", 5, ORDER, "b" * 40, "p.md"), ("k1", 5, ORDER, "a" * 40, "q.md")):
            self.assertNotEqual(base, cg.sign(SECRET, *args))
        self.assertNotEqual(base, cg.sign(b"other", "k1", 5, ORDER, "a" * 40, "p.md"))


class TestMintCli(unittest.TestCase):
    def run_cli(self, *args, env=None):
        out = io.StringIO()
        old = dict(os.environ)
        os.environ.pop("CTXGATE_SECRET", None)
        os.environ.update(env or {})
        try:
            with contextlib.redirect_stdout(out):
                rc = cg.main(list(args))
        finally:
            os.environ.clear()
            os.environ.update(old)
        return rc, out.getvalue()

    def test_mint_command(self):
        rc, out = self.run_cli("mint", "--base", "https://gw.example", "--order", ORDER, "--ref", "a" * 40, "amk/spec.md",
                               env={"CTXGATE_SECRET": "test-secret", "CTXGATE_NOW": "1000"})
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith("https://gw.example/v1/k1/87400/%s/" % ORDER))  # 1000 + 86400

    def test_mint_needs_a_secret(self):
        with self.assertRaises(SystemExit):
            self.run_cli("mint", "--base", "https://g", "--order", ORDER, "--ref", "a" * 40, "a.md")


if __name__ == "__main__":
    unittest.main()
