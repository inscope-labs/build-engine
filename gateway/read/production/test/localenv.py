#!/usr/bin/env python3
"""Shared plumbing for the local tests: a scratch repository, a stand-in for the GitHub
contents API, and a Worker running on the local Cloudflare Workers runtime.

Not shipped in releases: it is a test fixture.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCTION = HERE.parent
REPO = PRODUCTION.parents[2]
CONFORMANCE = REPO / "conformance"

OPERATOR_TOKEN = "operator-token-for-the-local-test"
SIGNING_SECRET = "test-secret"


def log(message):
    print("[local] %s" % message, flush=True)


def wait_for(url, timeout=120, what="service"):
    """Wait until the service answers. Any HTTP answer means it is up: a 404 from the contents
    API is a perfectly good answer for a path that does not exist."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                return response.read()
        except urllib.error.HTTPError:
            return b"{}"          # it answered; the status was an error, not a refusal to start
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1)
    raise RuntimeError("%s did not come up at %s (%s)" % (what, url, last))


def git(repo, *args):
    env = dict(os.environ, GIT_AUTHOR_NAME="conformance", GIT_AUTHOR_EMAIL="conformance@example.invalid",
               GIT_COMMITTER_NAME="conformance", GIT_COMMITTER_EMAIL="conformance@example.invalid")
    return subprocess.run(["git", "-C", str(repo)] + list(args), check=True, capture_output=True,
                          text=True, env=env).stdout.strip()


def write_files(target, files):
    for rel, content in files.items():
        path = target / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, dict):
            path.write_text(content["repeat"] * content["count"], encoding="utf-8")
        else:
            path.write_text(content, encoding="utf-8")


def build_fixture_repo(target, fixture):
    """The fixture repository, with a later commit on top of the pinned one, so that a link
    pinned to the first commit is proved to serve the content of that commit."""
    target.mkdir(parents=True, exist_ok=True)
    git(target, "init", "-q", "-b", "main")
    write_files(target, fixture["files"])
    git(target, "add", "-A")
    git(target, "commit", "-qm", "conformance fixture")
    pinned = git(target, "rev-parse", "HEAD")
    if fixture.get("later_files"):
        write_files(target, fixture["later_files"])
        git(target, "add", "-A")
        git(target, "commit", "-qm", "later commit")
    return pinned


def port_for(base):
    return base + (os.getpid() % 90)


class LocalEnv:
    """The stub, the Worker and the scratch repository, torn down together."""

    def __init__(self, work, fixture, variables=(), port_offset=0):
        self.work = work
        self.fixture = fixture
        self.variables = list(variables)
        self.stub_port = port_for(8900 + port_offset)
        self.gateway_port = port_for(8800 + port_offset)
        self.stub = None
        self.wrangler = None
        self.log_path = work / "wrangler.log"

    def __enter__(self):
        self.repo = self.work / "repo"
        self.pinned_ref = build_fixture_repo(self.repo, self.fixture)

        self.stub = subprocess.Popen([sys.executable, str(HERE / "github_stub.py"), str(self.repo), str(self.stub_port)],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        wait_for("http://127.0.0.1:%d/repos/o/r/contents/x?ref=%s" % (self.stub_port, self.pinned_ref),
                 timeout=30, what="the github stub")

        variables = [
            'SIGNING_KEYS:{"k1": "%s"}' % SIGNING_SECRET,
            "OPERATOR_TOKEN:%s" % OPERATOR_TOKEN,
            "GITHUB_TOKEN:local-test-token",
            "GITHUB_API_BASE:http://127.0.0.1:%d" % self.stub_port,
            "GITHUB_REPO:o/r",
            "CTXGATE_TEST_CLOCK:1",
            "ALLOW_PREFIXES:%s" % ",".join(self.fixture.get("allow_prefixes", ["amk/"])),
            "MAX_BYTES:%d" % self.fixture["max_bytes"],
            "MAX_TTL:%d" % self.fixture["max_ttl"],
            "CLOCK_SKEW_TOLERANCE:%d" % self.fixture.get("clock_skew_tolerance", 0),
            "AUDIT_RETENTION:500",
        ] + self.variables
        self.cmd = (["npx", "wrangler", "dev", "--local", "--port", str(self.gateway_port), "--ip", "127.0.0.1",
                     "--persist-to", str(self.work / "wrangler-state")]
                    + sum([["--var", v] for v in variables], []))
        self.log_file = self.log_path.open("w", encoding="utf-8")
        self.wrangler = subprocess.Popen(self.cmd, cwd=str(PRODUCTION), stdout=self.log_file,
                                         stderr=subprocess.STDOUT, text=True)
        self.base = "http://127.0.0.1:%d" % self.gateway_port
        try:
            self.health = json.loads(wait_for(self.base + "/healthz", what="the worker").decode("utf-8"))
        except RuntimeError:
            log("the worker did not start. Its log:")
            log(self.log_path.read_text(encoding="utf-8")[-4000:])
            raise
        return self

    def __exit__(self, *exc):
        for process in (self.wrangler, self.stub):
            if process is not None:
                try:
                    process.send_signal(signal.SIGTERM)
                    process.wait(timeout=15)
                except Exception:  # noqa: BLE001
                    process.kill()
        try:
            self.log_file.close()
        except Exception:  # noqa: BLE001
            pass
        return False

    # -- helpers
    def request(self, path, method="GET", headers=None, timeout=15):
        request = urllib.request.Request(self.base + path, method=method)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def admin(self, path, method="GET", body=None):
        headers = {"Authorization": "Bearer " + OPERATOR_TOKEN}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, method=method, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def mint(self, order="10008-S001", path="amk/spec.md", ref=None, exp=None, kid="k1"):
        import importlib.util
        spec = importlib.util.spec_from_file_location("h", str(CONFORMANCE / "harness" / "run.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        signer = module.PythonSigner()
        exp = exp if exp is not None else int(time.time()) + 3600
        return signer.mint(SIGNING_SECRET, kid, exp, order, ref or self.pinned_ref, path)[1]
