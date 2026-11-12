#!/usr/bin/env python3
"""ops/test_check_worker_secrets.py: the secret-name check, against a test double.

    python3 -m unittest discover -s ops -p 'test_*.py'

The check the operator is about to run for real is proved here first: the API's answer is
parsed, a missing name is a failure, a refusal is a refusal with its code named, and no
credential is a refusal to try — and in no case is a secret's value involved, because the API
never returns one.
"""
import importlib.util
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "worker_secrets", Path(__file__).resolve().parent / "check-worker-secrets.py"
)
worker_secrets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker_secrets)


class Handler(BaseHTTPRequestHandler):
    """A stand-in for the Cloudflare API's secret-list endpoint."""

    payload = {"success": True, "result": [{"name": "SIGNING_KEYS"}, {"name": "OPERATOR_TOKEN"},
                                           {"name": "GITHUB_TOKEN"}]}
    status = 200

    def do_GET(self):  # noqa: N802 - the name the base class uses
        body = json.dumps(self.payload).encode("utf-8")
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Server:
    """A test double, on a port nothing else is using."""

    def __enter__(self):
        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def base(self):
        return "http://127.0.0.1:%d/client/v4" % self.httpd.server_address[1]


class Check(unittest.TestCase):
    def setUp(self):
        self.env = dict(os.environ)
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = "acct"
        os.environ["CLOUDFLARE_API_TOKEN"] = "token"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)

    def run_check(self, base, worker="ctxgate-write", expect=("SIGNING_KEYS", "OPERATOR_TOKEN", "GITHUB_TOKEN")):
        return worker_secrets.main(["--worker", worker, "--base-url", base, "--expect", *expect])

    def test_every_expected_name_present_passes(self):
        with Server() as server:
            self.assertEqual(self.run_check(server.base), 0)

    def test_a_missing_name_fails(self):
        Handler.payload = {"success": True, "result": [{"name": "SIGNING_KEYS"}]}
        try:
            with Server() as server:
                self.assertEqual(self.run_check(server.base), 1)
        finally:
            Handler.payload = {"success": True, "result": [{"name": "SIGNING_KEYS"},
                                                           {"name": "OPERATOR_TOKEN"},
                                                           {"name": "GITHUB_TOKEN"}]}

    def test_a_refusal_is_a_refusal_and_names_the_code(self):
        Handler.status = 403
        Handler.payload = {"success": False, "errors": [{"code": 9106, "message": "Invalid API Token"}]}
        try:
            with Server() as server:
                self.assertEqual(self.run_check(server.base), 2)
        finally:
            Handler.status = 200
            Handler.payload = {"success": True, "result": [{"name": "SIGNING_KEYS"},
                                                           {"name": "OPERATOR_TOKEN"},
                                                           {"name": "GITHUB_TOKEN"}]}

    def test_no_credential_is_refused_before_the_api_is_asked(self):
        os.environ.pop("CLOUDFLARE_API_TOKEN", None)
        self.assertEqual(self.run_check("http://127.0.0.1:1/client/v4"), 2)

    def test_only_names_are_ever_read(self):
        """The endpoint returns names; the check prints names; no value is asked for."""
        with Server() as server:
            names = worker_secrets.fetch_secret_names("acct", "token", "ctxgate-write", server.base)
        self.assertEqual(sorted(names), ["GITHUB_TOKEN", "OPERATOR_TOKEN", "SIGNING_KEYS"])
        for name in names:
            self.assertNotIn("value", name)


if __name__ == "__main__":
    unittest.main()
