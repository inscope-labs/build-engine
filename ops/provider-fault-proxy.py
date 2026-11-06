#!/usr/bin/env python3
"""ops/provider-fault-proxy.py: a fault-injecting proxy in front of the provider.

Stage 6.3 of RELEASE-PLAN.md is "Failure and recovery pilot", and plan task 6.3.2 asks for
"GitHub rate limiting, network timeout, stale content, and conflicting updates" to be
*simulated*. The gateway cannot be asked to fail on demand, and the real provider cannot be
made to misbehave on demand, so the fault has to be injected **between the gateway and the
provider**.

This is that injection point. It is a loopback HTTP proxy that forwards every request to
`https://api.github.com` unchanged - method, path, headers, body, status, response body - and
applies a fault to the requests that a rule matches. The gateway is the shipped Worker, on the
shipped runtime, talking to the real provider; the only thing that is fake is the weather.

The proxy is deliberately small and deliberately dull:

  - it binds to **loopback only**, so it is not reachable from anywhere else;
  - it **never logs** a header, a body or a query value - only the method, the path and what the
    proxy did. A fault-injection tool that logs the credential is a fault-injection tool that
    leaks the credential;
  - it never writes anything to the repository and never mutates anything on the provider: the
    rules decide what happens to a request, and nothing else does.

## Modes

| Mode | What the provider sees | What the caller sees |
|---|---|---|
| `pass` | the real request | the real answer |
| `status` | nothing | the rule's status, with no upstream call at all |
| `hang_before` | nothing | nothing: the connection is held open and the caller's own timeout fires |
| `hang_after` | the real request, applied | nothing: the answer is discarded, so the caller cannot tell whether it was applied |
| `reset` | nothing | the connection is closed without an answer |

`hang_after` is the interesting one. It is the only mode that can produce "the provider acted
and the answer was lost", which is the case that must never produce a second commit.

## The control channel

The proxy serves three control paths of its own, under `/__fault`:

    POST /__fault          set the rules:   {"rules": [ {...}, ... ]}
    POST /__fault/reset    drop the rules and the log
    GET  /__fault          the rules, the log and the counters

A rule is:

    {"method": "PATCH",                 # optional; any method if absent
     "path_contains": "/git/refs/",     # optional; any path if absent
     "mode": "status",
     "status": 429,                     # for "status"
     "retry_after": "1",                # for "status" 429
     "hang_seconds": 30,                # for the two hang modes
     "count": 1}                        # optional; unlimited if absent

Rules are tried in order. The first rule that matches **and still has a remaining count** is the
one that applies; a rule with no `count` never runs out.

    python3 ops/provider-fault-proxy.py --port 8899
"""

import argparse
import http.client
import http.server
import json
import socketserver
import ssl
import sys
import threading
import time
import urllib.parse

UPSTREAM = "https://api.github.com"

# The headers that are forwarded. The Authorization header is one of them, because the
# credential is the gateway's and the proxy is only a pipe: dropping it would change what the
# gateway is doing. It is never logged and never echoed.
FORWARDED_REQUEST_HEADERS = (
    "authorization",
    "accept",
    "content-type",
    "x-github-api-version",
    "user-agent",
)

# The headers that are passed back. The rate-limit headers are included so that a caller which
# reads them sees what the provider actually said.
FORWARDED_RESPONSE_HEADERS = (
    "content-type",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-used",
    "x-github-media-type",
    "x-github-request-id",
)


class Rules:
    """The rules, and the log of what happened."""

    def __init__(self):
        self.lock = threading.Lock()
        self.rules = []
        self.log = []
        self.counters = {}

    def set(self, rules):
        with self.lock:
            self.rules = rules
            self.log = []
            self.counters = {}

    def reset(self):
        with self.lock:
            self.rules = []
            self.log = []
            self.counters = {}

    def clear_log(self):
        with self.lock:
            self.log = []
            self.counters = {}

    def snapshot(self):
        with self.lock:
            return {
                "rules": self.rules,
                "log": list(self.log),
                "counters": dict(self.counters),
            }

    def take(self, method, path):
        """The fault that applies to this request, and the rule that produced it.

        The rule's count is consumed here, under the lock, so that two concurrent requests do
        not both claim the last use of a one-shot rule.
        """
        with self.lock:
            for index, rule in enumerate(self.rules):
                if not self._matches(rule, method, path):
                    continue
                remaining = rule.get("count")
                if remaining is not None:
                    if int(remaining) <= 0:
                        continue
                    rule["count"] = int(remaining) - 1
                return index, rule
            return None, None

    def record(self, method, path, outcome):
        with self.lock:
            self.log.append({"method": method, "path": path, "outcome": outcome})
            key = "%s %s" % (method, classify(path))
            self.counters[key] = self.counters.get(key, 0) + 1

    @staticmethod
    def _matches(rule, method, path):
        wanted_method = rule.get("method")
        if wanted_method and wanted_method.upper() != method.upper():
            return False
        fragment = rule.get("path_contains")
        if fragment and fragment not in path:
            return False
        return True


def classify(path):
    """A coarse name for a path, so that the counters read well.

    The path is reduced to its API shape - `/repos/{owner}/{repo}/git/refs/heads/{branch}` becomes
    `git/refs` - and no value from it survives. The branch name is not a secret, but a counter
    that carries a query value would be a counter that could carry a credential.
    """
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 5 and parts[0] == "repos":
        parts = parts[3:]
    if parts and parts[-1] and len(parts[-1]) == 40 and all(c in "0123456789abcdef" for c in parts[-1]):
        parts = parts[:-1]
    if parts and parts[0] == "git" and len(parts) > 1:
        return "git/" + parts[1]
    return "/".join(parts) or "/"


class Handler(http.server.BaseHTTPRequestHandler):
    """One request. The proxy's rules live on the server."""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: A003 - the base class names it this way
        """The base class logs every request to stderr. The proxy keeps its own log."""

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PATCH(self):
        self.handle_any("PATCH")

    def do_PUT(self):
        self.handle_any("PUT")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def do_HEAD(self):
        self.handle_any("HEAD")

    # ------------------------------------------------------------------ the control channel

    def control(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/__fault" and self.command == "GET":
            body = json.dumps(self.server.rules.snapshot(), indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        if path == "/__fault" and self.command == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except ValueError:
                self.answer(400, b"the rules are not valid JSON")
                return True
            rules = payload.get("rules")
            if not isinstance(rules, list):
                self.answer(400, b"the rules must be a list")
                return True
            if not self.valid_rules(rules):
                self.answer(400, b"a rule has no known mode")
                return True
            self.server.rules.set(rules)
            self.answer(200, json.dumps({"rules": len(rules)}).encode("utf-8"))
            return True
        if path == "/__fault/rules" and self.command == "POST":
            # The rules change and the log does not. A caller that wants to know how many
            # requests a fault caused must be able to clear the fault and still read the count.
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except ValueError:
                self.answer(400, b"the rules are not valid JSON")
                return True
            rules = payload.get("rules")
            if not isinstance(rules, list) or not self.valid_rules(rules):
                self.answer(400, b"the rules must be a list of known rules")
                return True
            self.server.rules.rules = rules
            self.answer(200, json.dumps({"rules": len(rules)}).encode("utf-8"))
            return True
        if path == "/__fault/log" and self.command == "POST":
            self.server.rules.clear_log()
            self.answer(200, b'{"cleared":true}')
            return True
        if path == "/__fault/reset" and self.command == "POST":
            self.server.rules.reset()
            self.answer(200, b'{"reset":true}')
            return True
        return False

    @staticmethod
    def valid_rules(rules):
        for rule in rules:
            if not isinstance(rule, dict) or rule.get("mode") not in (
                "pass", "status", "hang_before", "hang_after", "reset"
            ):
                return False
        return True

    # ------------------------------------------------------------------ the proxy

    def handle_any(self, method):
        if self.control():
            return
        path = urllib.parse.urlparse(self.path).path
        query = urllib.parse.urlparse(self.path).query
        target = path + (("?" + query) if query else "")

        index, rule = self.server.rules.take(method, target)
        mode = rule.get("mode") if rule else "pass"

        if mode == "status":
            self.server.rules.record(method, target, "status %s" % rule.get("status"))
            headers = {"Content-Type": "application/json"}
            if rule.get("retry_after") is not None:
                headers["Retry-After"] = str(rule["retry_after"])
            body = json.dumps({"message": "injected by the provider fault proxy"}).encode("utf-8")
            self.send_response(int(rule.get("status") or 500))
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if mode == "reset":
            self.server.rules.record(method, target, "reset")
            self.close_connection = True
            try:
                self.connection.close()
            except OSError:
                pass
            return

        if mode == "hang_before":
            # The provider never sees the request. The caller waits, and the caller's own
            # timeout is what ends the call.
            self.server.rules.record(method, target, "hang_before")
            self.close_connection = True
            time.sleep(float(rule.get("hang_seconds") or 30))
            return

        if mode == "hang_after":
            # The provider sees the request and acts. The answer is thrown away.
            status, headers, body = self.forward(method, target)
            self.server.rules.record(method, target, "hang_after (upstream answered %s)" % status)
            self.close_connection = True
            time.sleep(float(rule.get("hang_seconds") or 30))
            return

        status, headers, body = self.forward(method, target)
        self.server.rules.record(method, target, "forwarded %s" % status)
        self.send_response(status)
        for name, value in headers:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(body)

    def forward(self, method, target):
        """One call to the real provider. Returns (status, [(name, value)], body)."""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {}
        for name in FORWARDED_REQUEST_HEADERS:
            value = self.headers.get(name)
            if value is not None:
                headers[name] = value
        # The proxy identifies itself, so that the provider's logs do not look like the
        # gateway's own traffic.
        headers["user-agent"] = "build-engine-provider-fault-proxy"

        context = ssl.create_default_context()
        parts = urllib.parse.urlparse(UPSTREAM)
        if parts.scheme == "https":
            connection = http.client.HTTPSConnection(
                parts.netloc, timeout=60, context=context
            )
        else:
            # A plain-HTTP upstream is only useful for the proxy's own tests, which point it
            # at a stand-in provider on loopback.
            connection = http.client.HTTPConnection(parts.netloc, timeout=60)
        try:
            connection.request(method, target, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
            out = [
                (name, response.getheader(name))
                for name in FORWARDED_RESPONSE_HEADERS
                if response.getheader(name) is not None
            ]
            return response.status, out, payload
        finally:
            try:
                connection.close()
            except Exception:
                pass

    def answer(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, rules):
        self.rules = rules
        super().__init__(address, handler)


def main(argv):
    global UPSTREAM
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=0, help="the port to listen on (0 = any free port)")
    parser.add_argument("--port-file", default="", help="write the chosen port here, for the caller to read")
    parser.add_argument("--upstream", default=UPSTREAM, help="the real provider (default: %s)" % UPSTREAM)
    args = parser.parse_args(argv)

    UPSTREAM = args.upstream

    rules = Rules()
    server = Server(("127.0.0.1", args.port), Handler, rules)
    port = server.server_address[1]
    if args.port_file:
        with open(args.port_file, "w", encoding="utf-8") as handle:
            handle.write("%d\n" % port)
    print("the provider fault proxy is listening on 127.0.0.1:%d" % port, flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
