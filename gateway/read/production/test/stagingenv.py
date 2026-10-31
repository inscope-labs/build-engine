#!/usr/bin/env python3
"""The staging environment: a Worker that can be restarted, and a provider that can fail.

This is the plumbing for the operational checks of Stage 4.3. It is the same Cloudflare
Workers runtime, the same Worker code and the same Durable Object as a deployment; what it
adds over `localenv.py` is the two things an operational check needs and a unit test does not
have:

  - the Worker can be RESTARTED with different settings while keeping its state, so that a key
    rotation and the durability of the revocation set can be observed rather than assumed;
  - the provider can be made to fail on demand, so that a provider failure is a thing the
    gateway is tested against and not a thing the test hopes does not happen.

Nothing here is deployed and nothing here talks to the real GitHub. The scratch repository is
created in a temporary directory and destroyed with it.

Not shipped in releases: it is a test fixture.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import procs  # noqa: E402
PRODUCTION = HERE.parent
REPO = PRODUCTION.parents[2]
CONFORMANCE = REPO / "conformance"

OPERATOR_TOKEN = "operator-token-for-the-staging-check"
SIGNING_SECRET = "test-secret"
ROTATED_SECRET = "rotated-secret-for-the-next-key"


def log(message):
    print("[staging] %s" % message, flush=True)


def free_port(preferred):
    """A port nothing is listening on. The preferred one if it is free."""
    for candidate in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", candidate))
            except OSError:
                continue
            return candidate
    raise RuntimeError("no free port near %d" % preferred)


def wait_for_port_free(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.25)
    return False


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
    env = dict(os.environ, GIT_AUTHOR_NAME="staging", GIT_AUTHOR_EMAIL="staging@example.invalid",
               GIT_COMMITTER_NAME="staging", GIT_COMMITTER_EMAIL="staging@example.invalid")
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
    git(target, "commit", "-qm", "staging fixture")
    pinned = git(target, "rev-parse", "HEAD")
    if fixture.get("later_files"):
        write_files(target, fixture["later_files"])
        git(target, "add", "-A")
        git(target, "commit", "-qm", "later commit")
    return pinned


class Staging:
    """A Worker, a provider and a scratch repository, with a restart in the middle."""

    def __init__(self, work, fixture, variables=(), port_offset=0, keys=None):
        self.work = work
        self.fixture = fixture
        self.variables = list(variables)
        self.keys = keys or {"k1": SIGNING_SECRET}
        self.stub_port = free_port(9300 + port_offset)
        self.gateway_port = free_port(9200 + port_offset)
        self.stub = None
        self.wrangler = None
        self.log_path = work / "wrangler.log"
        self.record_path = work / "github-requests.jsonl"
        self.mode_path = work / "github-mode"
        self.persist_path = work / "wrangler-state"
        self.base = "http://127.0.0.1:%d" % self.gateway_port
        self.repo = work / "repo"
        self.pinned_ref = None

    # -- lifecycle
    def __enter__(self):
        self.pinned_ref = build_fixture_repo(self.repo, self.fixture)
        self.mode_path.write_text("ok", encoding="utf-8")
        self.stub = subprocess.Popen(
            [sys.executable, str(HERE / "github_stub.py"), str(self.repo), str(self.stub_port),
             "--record", str(self.record_path), "--mode-file", str(self.mode_path)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True)
        wait_for("http://127.0.0.1:%d/repos/o/r/contents/x?ref=%s" % (self.stub_port, self.pinned_ref),
                 timeout=30, what="the github stub")
        self.start(self.variables)
        return self

    def __exit__(self, *exc):
        self.stop()
        if self.stub is not None:
            self._terminate(self.stub)
        return False

    def start(self, variables):
        """Start the Worker with these settings. The state directory is kept, so a restart
        keeps the revocation set and the audit trail."""
        variables = [
            'SIGNING_KEYS:%s' % json.dumps(self.keys, separators=(",", ":")),
            "OPERATOR_TOKEN:%s" % OPERATOR_TOKEN,
            "GITHUB_TOKEN:local-staging-token",
            "GITHUB_API_BASE:http://127.0.0.1:%d" % self.stub_port,
            "GITHUB_REPO:o/r",
            "ALLOW_PREFIXES:%s" % ",".join(self.fixture.get("allow_prefixes", ["amk/"])),
            "MAX_BYTES:%d" % self.fixture["max_bytes"],
            "MAX_TTL:%d" % self.fixture["max_ttl"],
            "CLOCK_SKEW_TOLERANCE:%d" % self.fixture.get("clock_skew_tolerance", 0),
            "AUDIT_RETENTION:500",
            "SOURCE_TIMEOUT_MS:2000",
            "RATE_LIMIT_PER_ORDER:200",
            "RATE_LIMIT_PER_IP:1000",
            "RATE_LIMIT_GLOBAL:5000",
        ] + list(variables)
        cmd = (["npx", "wrangler", "dev", "--local", "--port", str(self.gateway_port), "--ip", "127.0.0.1",
                "--persist-to", str(self.persist_path)]
               + sum([["--var", v] for v in variables], []))
        self.log_file = self.log_path.open("a", encoding="utf-8")
        # Its own process group, so that stopping the Worker stops the runtime it started and
        # not just the launcher. A Worker that survives its own restart would answer the
        # checks with the settings it had before, which is exactly the kind of thing a test
        # must not let happen quietly.
        self.wrangler = subprocess.Popen(cmd, cwd=str(PRODUCTION), stdout=self.log_file,
                                         stderr=subprocess.STDOUT, text=True,
                                         start_new_session=True)
        try:
            self.health = json.loads(wait_for(self.base + "/healthz", what="the worker").decode("utf-8"))
        except RuntimeError:
            log("the worker did not start. Its log:")
            log(self.log_path.read_text(encoding="utf-8")[-4000:])
            raise
        return self.health

    def stop(self):
        if self.wrangler is not None:
            self._terminate(self.wrangler)
            self.wrangler = None
            try:
                self.log_file.close()
            except Exception:  # noqa: BLE001
                pass
            if not wait_for_port_free(self.gateway_port):
                raise RuntimeError("the worker did not release port %d" % self.gateway_port)

    @staticmethod
    def _terminate(process):
        """Stop a process and everything it started.

        The runtime is started in a process group of its own, so stopping the launcher alone
        would leave it running: it would keep the port, keep the binary open, and - worst of
        all - keep answering the checks with the settings it had before the "restart".
        """
        procs.stop(process)

    def restart(self, variables=(), keys=None):
        """Restart the Worker. The state survives; the settings may change.

        The old Worker is really stopped first: a restart that leaves the previous process
        answering is not a restart, and a check that believes it restarted the gateway has
        tested nothing.
        """
        self.stop()
        if keys is not None:
            self.keys = keys
        if variables:
            self.variables = list(variables)
        return self.start(self.variables)

    # -- the provider
    def set_provider_mode(self, mode):
        """Make the provider behave differently: ok, server-error, unauthorized, rate-limited,
        slow, unreachable, repository-missing."""
        self.mode_path.write_text(mode, encoding="utf-8")
        return mode

    def provider_requests(self):
        """Every request the provider was asked to serve."""
        if not self.record_path.exists():
            return []
        out = []
        for line in self.record_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    # -- the gateway
    def request(self, path, method="GET", headers=None, timeout=20):
        request = urllib.request.Request(self.base + path, method=method)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def admin(self, path, method="GET", body=None):
        headers = {"Authorization": "Bearer " + OPERATOR_TOKEN}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, method=method, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def mint(self, order="10008-S001", path="amk/spec.md", ref=None, exp=None, kid="k1", secret=None):
        import importlib.util
        spec = importlib.util.spec_from_file_location("h", str(CONFORMANCE / "harness" / "run.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        signer = module.PythonSigner()
        exp = exp if exp is not None else int(time.time()) + 3600
        secret = secret if secret is not None else self.keys.get(kid, SIGNING_SECRET)
        return signer.mint(secret, kid, exp, order, ref or self.pinned_ref, path)[1]

    def repo_head(self):
        return git(self.repo, "rev-parse", "HEAD")

    def repo_status(self):
        return git(self.repo, "status", "--porcelain")
