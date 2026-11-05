#!/usr/bin/env python3
"""ops/test_provider_fault_proxy.py: the fault proxy's own tests.

The fault proxy is what makes the Stage 6.3 failure pilot possible: it is the only thing
between the gateway and the provider, and the pilot's whole claim rests on it doing exactly
what it says — inject this fault, into that request, and nothing else.

A fault injector that does not do what it says is worse than no fault injector, because every
failure the pilot reports is then evidence about the proxy rather than about the gateway. So
the proxy is tested on its own:

  - it **forwards** what it is not told to break, byte for byte;
  - it injects **each** of its modes, and only into the requests a rule matches;
  - a rule with a count is **consumed**, and a rule without one is not;
  - it **never logs** a header, a body or a credential — the log is the one place a debugging
    tool can leak what it was given.

    python3 -m unittest discover -s ops -p 'test_*.py'
"""

import http.client
import json
import os
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.path.join(HERE, "provider-fault-proxy.py")

# A stand-in for the provider. It answers every GET with a fixed body and counts the calls,
# so that the test can prove that a request the proxy was told to break never reached it.
UPSTREAM_MARKER = "the-stand-in-provider"


class StandIn:
    """The provider the proxy forwards to."""

    def __init__(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                proxy.calls.append((self.command, self.path, self.headers.get("Authorization")))
                body = UPSTREAM_MARKER.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_PATCH(self):
                self.do_GET()

            def log_message(self, *args):
                pass

        self.calls = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class ProxyCase(unittest.TestCase):
    """One proxy, one stand-in provider, and a way to ask the proxy what it did."""

    def setUp(self):
        self.upstream = StandIn()
        self.port = self._free_port()
        self.process = subprocess.Popen(
            [sys.executable, PROXY, "--port", str(self.port),
             "--upstream", "http://127.0.0.1:%d" % self.upstream.port],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.base = "http://127.0.0.1:%d" % self.port
        for _ in range(100):
            if self.get("/__fault")[0] == 200:
                return
            time.sleep(0.1)
        self.fail("the proxy did not start")

    def tearDown(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        self.upstream.stop()

    @staticmethod
    def _free_port():
        import socket

        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        return port

    def get(self, path, timeout=10):
        return self.request("GET", path, timeout=timeout)

    def patch(self, path, timeout=10):
        return self.request("PATCH", path, timeout=timeout)

    def request(self, method, path, timeout=10):
        """One request. A connection that is closed or that never answers is a status of 0,
        not an exception: the caller decides whether that is fatal."""
        request = urllib.request.Request(self.base + path, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError, http.client.RemoteDisconnected):
            return 0, ""

    def post(self, path, body, timeout=10):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    def rules(self, rules):
        status, body = self.post("/__fault/rules", {"rules": rules})
        self.assertEqual(status, 200, body)

    def log(self):
        status, body = self.get("/__fault")
        self.assertEqual(status, 200)
        return json.loads(body)

    # ------------------------------------------------------------------ the tests

    def test_it_forwards_what_it_is_not_told_to_break(self):
        status, body = self.get("/repos/owner/repo/git/ref/heads/main")
        self.assertEqual(status, 200)
        self.assertEqual(body, UPSTREAM_MARKER)
        self.assertEqual(len(self.upstream.calls), 1)
        method, path, _ = self.upstream.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(path, "/repos/owner/repo/git/ref/heads/main")

    def test_the_authorization_header_is_forwarded_but_never_logged(self):
        request = urllib.request.Request(
            self.base + "/repos/owner/repo", headers={"Authorization": "Bearer a-secret-value"}
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
        self.assertEqual(self.upstream.calls[0][2], "Bearer a-secret-value")
        self.assertNotIn("a-secret-value", json.dumps(self.log()))

    def test_a_status_fault_never_reaches_the_provider(self):
        self.rules([{"method": "PATCH", "path_contains": "/git/refs/", "mode": "status",
                     "status": 429, "count": 1}])
        status, _ = self.patch("/repos/owner/repo/git/refs/heads/main")
        self.assertEqual(status, 429)
        self.assertEqual(len(self.upstream.calls), 0, "the request must not have been forwarded")
        # The rule is consumed: the next one goes through.
        status, body = self.patch("/repos/owner/repo/git/refs/heads/main")
        self.assertEqual(status, 200)
        self.assertEqual(body, UPSTREAM_MARKER)
        self.assertEqual(len(self.upstream.calls), 1)

    def test_a_rule_only_matches_what_it_names(self):
        self.rules([{"method": "PATCH", "path_contains": "/git/refs/", "mode": "status",
                     "status": 500, "count": 5}])
        status, body = self.get("/repos/owner/repo/git/ref/heads/main")
        self.assertEqual(status, 200, "a GET is not a PATCH")
        self.assertEqual(body, UPSTREAM_MARKER)
        status, _ = self.patch("/repos/owner/repo/git/refs/heads/main")
        self.assertEqual(status, 500)

    def test_a_rule_without_a_count_never_runs_out(self):
        self.rules([{"method": "GET", "mode": "status", "status": 503}])
        for _ in range(5):
            status, _ = self.get("/anything")
            self.assertEqual(status, 503)

    def test_a_hang_never_answers(self):
        self.rules([{"method": "GET", "mode": "hang_before", "hang_seconds": 30, "count": 1}])
        start = time.time()
        status, _ = self.get("/anything", timeout=2)
        elapsed = time.time() - start
        self.assertEqual(status, 0, "a hang answers nothing at all")
        self.assertLess(elapsed, 25, "the caller must be the one who gives up")
        self.assertEqual(len(self.upstream.calls), 0, "the provider never saw the request")

    def test_a_hang_after_applies_the_change_and_loses_the_answer(self):
        self.rules([{"method": "GET", "mode": "hang_after", "hang_seconds": 30, "count": 1}])
        start = time.time()
        status, _ = self.get("/anything", timeout=2)
        elapsed = time.time() - start
        self.assertEqual(status, 0)
        self.assertLess(elapsed, 25)
        self.assertEqual(len(self.upstream.calls), 1, "the provider acted")

    def test_a_reset_closes_the_connection_without_an_answer(self):
        self.rules([{"method": "GET", "mode": "reset", "count": 1}])
        status, _ = self.get("/anything", timeout=5)
        self.assertEqual(status, 0)
        self.assertEqual(len(self.upstream.calls), 0)

    def test_the_log_holds_the_method_the_path_and_nothing_else(self):
        self.get("/repos/owner/repo/git/ref/heads/main")
        entries = self.log()["log"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(set(entries[0]), {"method", "path", "outcome"})

    def test_the_rules_can_be_cleared_without_losing_the_log(self):
        self.rules([{"method": "GET", "mode": "status", "status": 503}])
        self.get("/anything")
        self.assertEqual(len(self.log()["log"]), 1)
        self.post("/__fault/rules", {"rules": []})
        self.assertEqual(len(self.log()["log"]), 1, "the log survives a change of the rules")
        status, _ = self.get("/anything")
        self.assertEqual(status, 200)

    def test_an_unknown_mode_is_refused(self):
        status, _ = self.post("/__fault/rules", {"rules": [{"mode": "explode"}]})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
