#!/usr/bin/env python3
"""Run the conformance suite against the PRODUCTION gateway, running locally.

This is the acceptance gate of RELEASE-PLAN.md Stage 4.2: the port is judged by the same suite
that judges the reference gateway, over real HTTP, against a real Worker on the Cloudflare
Workers runtime (wrangler dev --local, Durable Objects included).

What it does:
  1. builds a scratch git repository from the conformance fixture, with a later commit on top,
     so that a link pinned to the first commit is proved to serve the content of that commit;
  2. starts a local stand-in for the GitHub contents API, so nothing touches GitHub and no
     credential is needed;
  3. starts the Worker with wrangler dev --local, configured through .dev.vars;
  4. runs conformance/harness/run.py against it, and checks the operator channel;
  5. tears everything down and reports.

Not shipped in releases: it is a test driver.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
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
    print("[conformance] %s" % message, flush=True)


def wait_for(url, timeout=90, what="service"):
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


def build_fixture_repo(target, fixture):
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


def write_files(target, files):
    for rel, content in files.items():
        path = target / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, dict):
            path.write_text(content["repeat"] * content["count"], encoding="utf-8")
        else:
            path.write_text(content, encoding="utf-8")


def main():
    fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]
    work = Path(tempfile.mkdtemp(prefix="ctxgate-conformance-"))
    repo = work / "repo"
    pinned_ref = build_fixture_repo(repo, fixture)
    log("fixture repository built, pinned commit %s" % pinned_ref)

    stub_port = 8900 + (os.getpid() % 90)
    gateway_port = 8800 + (os.getpid() % 90)
    stub = None
    wrangler = None
    try:
        # 1. the GitHub contents API stand-in
        stub = subprocess.Popen([sys.executable, str(HERE / "github_stub.py"), str(repo), str(stub_port)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        wait_for("http://127.0.0.1:%d/repos/o/r/contents/x?ref=%s" % (stub_port, pinned_ref), timeout=30,
                 what="the github stub")

        # 2. the Worker's configuration. Every value here is a test-only value; nothing in
        #    this file is a credential, and nothing in the repository is.
        variables = [
            "SIGNING_KEYS:{\"k1\": \"%s\"}" % SIGNING_SECRET,
            "OPERATOR_TOKEN:%s" % OPERATOR_TOKEN,
            "GITHUB_TOKEN:local-test-token",
            "GITHUB_API_BASE:http://127.0.0.1:%d" % stub_port,
            "GITHUB_REPO:o/r",
            "CTXGATE_TEST_CLOCK:1",
            "ALLOW_PREFIXES:%s" % ",".join(fixture.get("allow_prefixes", ["amk/"])),
            "MAX_BYTES:%d" % fixture["max_bytes"],
            "MAX_TTL:%d" % fixture["max_ttl"],
            "CLOCK_SKEW_TOLERANCE:%d" % fixture.get("clock_skew_tolerance", 0),
            "AUDIT_RETENTION:500",
        ]
        os.environ["WRANGLER_LOG"] = "error"

        # 3. the Worker, on the real Workers runtime
        wrangler_log = work / "wrangler.log"
        log_file = wrangler_log.open("w", encoding="utf-8")
        # The Durable Object state is kept in a throwaway directory: a previous run's revocations
        # and audit trail must not decide this run's result.
        persist = work / "wrangler-state"
        cmd = ["npx", "wrangler", "dev", "--local", "--port", str(gateway_port), "--ip", "127.0.0.1",
               "--persist-to", str(persist)] + sum([["--var", v] for v in variables], [])
        log("wrangler command: %s" % " ".join(cmd))
        wrangler = subprocess.Popen(
            cmd,
            cwd=str(PRODUCTION), stdout=log_file, stderr=subprocess.STDOUT, text=True)
        base = "http://127.0.0.1:%d" % gateway_port
        try:
            health = wait_for(base + "/healthz", timeout=120, what="the worker")
        except RuntimeError:
            log("the worker did not start. Its log:")
            log(wrangler_log.read_text(encoding="utf-8")[-4000:])
            raise
        log("worker is up: %s" % health.decode("utf-8").strip())
        for line in wrangler_log.read_text(encoding="utf-8").splitlines():
            if "env." in line and ("CONFORMANCE" in line or "SIGNING" in line):
                log("wrangler binding: %s" % line.strip())

        # The fixture's revoked orders must be revoked in the gateway's own state, the way the
        # operator would revoke them.
        for order in fixture.get("revoked_orders", []):
            request = urllib.request.Request(base + "/admin/revoke", method="POST",
                                             data=json.dumps({"order": order}).encode(),
                                             headers={"Authorization": "Bearer " + OPERATOR_TOKEN,
                                                      "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=15) as response:
                json.loads(response.read())
            log("revoked order %s in the gateway" % order)

        # 4. the conformance suite, over HTTP, against the running Worker
        result = subprocess.run(
            [sys.executable, str(CONFORMANCE / "harness" / "run.py"), "cases",
             "--gateway", base, "--ref", pinned_ref,
             "--audit-url", base + "/admin/audit", "--admin-token", OPERATOR_TOKEN],
            cwd=str(REPO), capture_output=True, text=True)
        print(result.stdout)
        if result.stderr.strip():
            print(result.stderr, file=sys.stderr)
        failed = result.returncode != 0

        # 5. the operator channel: revoke an order, and see it refused
        log("checking the operator channel")
        operator_failed = False
        try:
            request = urllib.request.Request(base + "/admin/revoke", method="POST",
                                             data=json.dumps({"order": "10008-S001"}).encode(),
                                             headers={"Authorization": "Bearer " + OPERATOR_TOKEN,
                                                      "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=15) as response:
                revoked = json.loads(response.read())
            log("revoke acknowledged: %s" % json.dumps(revoked))

            # the order is dead: its links must now be refused
            signer = subprocess.run(
                [sys.executable, str(CONFORMANCE / "harness" / "signer_adapter.py")],
                input=json.dumps({"op": "mint", "secret": SIGNING_SECRET, "kid": "k1", "exp": 4102444800,
                                  "order": "10008-S001", "ref": pinned_ref, "path": "amk/spec.md"}) + "\n",
                capture_output=True, text=True, cwd=str(REPO))
            url = json.loads(signer.stdout.strip())["url_path"]
            status = None
            try:
                with urllib.request.urlopen(base + url, timeout=15) as response:
                    status = response.status
            except urllib.error.HTTPError as e:
                status = e.code
            log("a link for the revoked order returned HTTP %s" % status)
            if status != 403:
                operator_failed = True
                log("FAIL: a revoked order still served its link")

            # the unauthenticated admin channel must be refused
            try:
                urllib.request.urlopen(base + "/admin/audit", timeout=15)
                operator_failed = True
                log("FAIL: the admin channel answered without a credential")
            except urllib.error.HTTPError as e:
                if e.code != 401:
                    operator_failed = True
                    log("FAIL: the admin channel answered %s without a credential" % e.code)
                else:
                    log("the admin channel refuses an unauthenticated caller")
        except Exception as e:  # noqa: BLE001
            operator_failed = True
            log("FAIL: the operator channel could not be exercised: %s" % e)

        if failed or operator_failed:
            log("FAILED")
            return 1
        log("PASSED: the production gateway passes the conformance suite")
        return 0
    finally:
        for process in (wrangler, stub):
            if process is not None:
                try:
                    process.send_signal(signal.SIGTERM)
                    process.wait(timeout=15)
                except Exception:  # noqa: BLE001
                    process.kill()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
