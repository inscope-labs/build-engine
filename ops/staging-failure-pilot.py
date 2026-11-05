#!/usr/bin/env python3
"""ops/staging-failure-pilot.py: the failure and recovery pilot.

Stage 6.3 of RELEASE-PLAN.md is "Failure and recovery pilot":

    6.3.1 Interrupt requests during staging, commit, and seal; verify state and recovery
         follow the contract.
    6.3.2 Simulate gateway restart/eviction, GitHub rate limiting, network timeout, stale
         content, and conflicting updates.
    6.3.3 Verify operator can distinguish "not committed", "committed but response lost",
         "sealed", "revoked", and "unknown; reconcile required".
    6.3.4 Run a second task concurrently and prove no task/session state or files cross
         boundaries.
    6.3.5 Document all observed deviations and repeat the pilot after remediation.

Stage 6.2 proved that the workflow *works*. This stage proves what happens when it does not.

**What is real and what is simulated.** The gateway is the shipped Worker, on the shipped
Workers runtime, with the shipped Durable Objects. The provider is the real GitHub. The
credential is a real one. The only thing that is fake is the weather: a loopback proxy
(`ops/provider-fault-proxy.py`) sits between the gateway and the provider and injects the
failures the plan asks for — a rate limit, a timeout, an answer that never arrives, a
connection that is reset. The proxy forwards everything it is not told to break, byte for byte,
so the gateway is doing exactly the work it would do in production.

**The scenarios, and the plan task each one answers.**

| Scenario | Plan task | What it interrupts or simulates |
|---|---|---|
| the staging, interrupted by a restart | 6.3.1, 6.3.2 | the gateway's memory; the staged bytes are lost, the inventory is not |
| the commit, interrupted after the provider acted | 6.3.1, 6.3.3 | the *answer* is lost; the commit landed |
| the commit, interrupted with the outcome unknown | 6.3.1, 6.3.2, 6.3.3 | the provider does not answer at all |
| the provider's rate limit | 6.3.2 | 429, then success; and 429 with no end |
| the branch moved under the capability | 6.3.2 | stale content, and a conflicting update |
| the seal, interrupted | 6.3.1 | the seal request, in flight |
| the five outcomes the operator must tell apart | 6.3.3 | five different states, five different answers |
| two tasks at once | 6.3.4 | two sessions, two folders, one branch |

**What the pilot must not do.** It must not commit to a branch it does not own, it must not
leave a task sealed that a later run needs, and it must not print a secret. The staged bytes, the
signing secret, the operator token and the provider credential are all checked against the
output before the run is allowed to claim anything.

    GITHUB_TOKEN=<a credential that can write to the disposable branches> \\
      python3 ops/staging-failure-pilot.py

The pilot writes to the disposable estate and to nothing else. It changes the disposable
submissions branch, and the estate is what removes it.
"""

import argparse
import base64
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WRITE_GW = os.path.join(ROOT, "gateway", "write")
FAULT_PROXY = os.path.join(HERE, "provider-fault-proxy.py")

PLAN_ID = "pilot-001"
ORDER_A = "10008-S001"
ORDER_B = "10008-S002"
WRITER = "agent-pilot"
KID = "sk1"

# The disposable destination. It is the estate's, and the estate is disposable.
REPO = "inscope-labs/build-engine"
BRANCH = "staging/submissions"

# The provider's timeout for this run, in milliseconds. The shipped default is 10000, and a
# pilot that waits ten seconds per injected timeout is a pilot nobody re-runs. The contract's
# floor is 1000 (PROVIDER_TIMEOUT_MIN_MS).
TIMEOUT_MS = 1500

# The tasks, one per scenario. Every scenario that moves the branch needs its own task: a
# capability pins the branch head, and a commit moves it.
TASKS = {
    "staging": ("10008-1-201-01", ORDER_A),
    "lost": ("10008-1-202-01", ORDER_A),
    "unknown": ("10008-1-203-01", ORDER_A),
    "ratelimit": ("10008-1-204-01", ORDER_A),
    "exhausted": ("10008-1-205-01", ORDER_A),
    "stale": ("10008-1-206-01", ORDER_A),
    "writer_a": ("10008-1-207-01", ORDER_A),
    "writer_b": ("10008-1-208-01", ORDER_A),
    "seal": ("10008-1-209-01", ORDER_A),
    "not_committed": ("10008-1-210-01", ORDER_A),
    "revoked": ("10008-1-211-01", ORDER_A),
    "concurrent_a": ("10008-1-212-01", ORDER_A),
    "concurrent_b": ("10008-1-213-01", ORDER_B),
    "seal_in_flight": ("10008-1-214-01", ORDER_A),
    "lost_again": ("10008-1-215-01", ORDER_A),
    "unknown_again": ("10008-1-216-01", ORDER_A),
    "provider_silent": ("10008-1-217-01", ORDER_A),
}

FAILURES = []
STEPS = []

# A per-run token. The disposable branch keeps what a previous run put there, so the content
# the pilot stages carries this token: a second run really rewrites the file, and the
# "the file on the branch holds exactly the bytes that were staged" check means something on
# every run and not only on the first one.
NONCE = "unset"


def say(title):
    print("\n\033[1m== %s ==\033[0m" % title, flush=True)


def note(text):
    print("   %s" % text, flush=True)


def ok(text):
    print("   \033[32mok\033[0m   %s" % text, flush=True)
    STEPS.append(("ok", text))


def bad(text):
    print("   \033[1;31mFAIL\033[0m %s" % text, flush=True)
    FAILURES.append(text)


def check(condition, text):
    if condition:
        ok(text)
    else:
        bad(text)
    return bool(condition)


def run(argv, cwd=None, env=None, check_rc=True, timeout=600):
    """Run a command; return (rc, stdout+stderr)."""
    merged = dict(os.environ)
    if env:
        merged.update(env)
    proc = subprocess.run(
        argv, cwd=cwd, env=merged, capture_output=True, text=True, timeout=timeout
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    if check_rc and proc.returncode != 0:
        raise SystemExit("the command failed: %s\n%s" % (" ".join(argv), out))
    return proc.returncode, out


def http(method, url, headers=None, body=None, timeout=30):
    """One HTTP call. Returns (status, body-text)."""
    data = None
    head = dict(headers or {})
    # Cloudflare's managed rules refuse Python's default User-Agent with error 1010, so the
    # pilot says who it is. That was F0-073.
    head.setdefault("User-Agent", "ctxgate-failure-pilot/6.3")
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        head["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=head, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, socket.timeout, OSError):
        # A gateway that is not up is a status of 0, not an exception: the caller decides
        # whether an unreachable gateway is fatal.
        return 0, ""


def code_of(body):
    try:
        return json.loads(body).get("error", {}).get("code")
    except Exception:
        return None


def payload_of(body):
    try:
        return json.loads(body).get("result") or {}
    except Exception:
        return {}


def free_port():
    """A port from the range the rehearsal reserves (21000-21999)."""
    port = 21999
    while port > 21000:
        probe = socket.socket()
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            probe.close()
            port -= 1
            continue
        probe.close()
        return port
    raise SystemExit("no free port between 21000 and 21999")


def stop_gateway(port):
    """Stop a gateway completely: the launcher first, then the runtime it left behind.

    `wrangler dev` starts the runtime in a process group of its own, so killing the launcher
    leaves the runtime alive: it keeps the port, keeps its binary open and keeps answering.
    A "restart" that is not a restart would make the eviction scenarios prove nothing.
    """
    subprocess.run(["pkill", "-f", "wrangler dev --env staging --port %d" % port], capture_output=True)
    time.sleep(1)
    subprocess.run(["pkill", "-f", "socket-addr=entry=127.0.0.1:%d" % port], capture_output=True)
    time.sleep(1)


class FaultProxy:
    """The fault injector between the gateway and the provider."""

    def __init__(self, port):
        self.port = port
        self.base = "http://127.0.0.1:%d" % port
        self.process = None

    def start(self):
        log = open("/tmp/ctxgate-fault-proxy.log", "w", encoding="utf-8")
        self.process = subprocess.Popen(
            [sys.executable, FAULT_PROXY, "--port", str(self.port)],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        for _ in range(40):
            status, _ = http("GET", self.base + "/__fault", timeout=2)
            if status == 200:
                return
            time.sleep(0.5)
        raise SystemExit("the fault proxy did not start (see /tmp/ctxgate-fault-proxy.log)")

    def stop(self):
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None

    def rules(self, rules):
        """Set the rules. The log is kept: a caller that clears a fault still wants to know
        how many requests it caused."""
        status, body = http(
            "POST", self.base + "/__fault/rules", body={"rules": rules}, timeout=10
        )
        if status != 200:
            raise SystemExit("the fault proxy refused the rules: %s %s" % (status, body))

    def clear_rules(self):
        self.rules([])

    def reset(self):
        http("POST", self.base + "/__fault/reset", body={}, timeout=10)

    def clear_log(self):
        http("POST", self.base + "/__fault/log", body={}, timeout=10)

    def log(self):
        status, body = http("GET", self.base + "/__fault", timeout=10)
        if status != 200:
            return {"log": [], "counters": {}}
        try:
            return json.loads(body)
        except ValueError:
            return {"log": [], "counters": {}}

    def count(self, fragment, method=None):
        """How many requests hit a path holding this fragment.

        The method matters: the gateway *reads* the branch with `GET /git/ref/heads/...` and
        *moves* it with `PATCH /git/refs/heads/...`, and a count that mixed the two would make
        "the provider was asked to move the branch exactly once" mean nothing.
        """
        return sum(
            1
            for entry in self.log()["log"]
            if fragment in entry["path"] and (method is None or entry["method"] == method)
        )

    def outcomes(self):
        return [entry["outcome"] for entry in self.log()["log"]]


class LocalGateway:
    """The write gateway on the local Workers runtime."""

    def __init__(self, port, secrets, api_base):
        self.port = port
        self.secrets = secrets
        self.api_base = api_base
        self.base = "http://127.0.0.1:%d" % port

    def start(self):
        variables = dict(self.secrets)
        variables["GITHUB_API_BASE"] = self.api_base
        variables["GITHUB_TIMEOUT_MS"] = str(TIMEOUT_MS)
        path = os.path.join(WRITE_GW, ".dev.vars.staging")
        with open(path, "w", encoding="utf-8") as handle:
            for key, value in variables.items():
                handle.write('%s="%s"\n' % (key, value))
        os.chmod(path, 0o600)
        log = open("/tmp/ctxgate-failure-pilot-write.log", "a", encoding="utf-8")
        subprocess.Popen(
            ["setsid", "bash", "-c",
             "cd %s && exec npx wrangler dev --env staging --port %d --ip 127.0.0.1"
             % (WRITE_GW, self.port)],
            stdout=log,
            stderr=subprocess.STDOUT,
            env=dict(os.environ, WRANGLER_SEND_METRICS="false"),
        )
        for _ in range(90):
            status, body = http("GET", self.base + "/healthz", timeout=3)
            if status == 200 and "ctxwrite-v1" in body:
                return
            time.sleep(1)
        raise SystemExit("the write gateway did not start (see /tmp/ctxgate-failure-pilot-write.log)")

    def stop(self):
        stop_gateway(self.port)

    def restart(self):
        """A full stop and a full start: the gateway's memory is gone and its Durable Object
        state is not."""
        self.stop()
        self.start()


def branch_head():
    """The head of the disposable submissions branch, as the provider has it."""
    rc, out = run(
        ["git", "ls-remote", "origin", "refs/heads/" + BRANCH],
        cwd=ROOT,
        check_rc=False,
    )
    return out.split()[0] if out.strip() else ""


def provider_api(method, path, body=None):
    """One call to the provider, with the credential from the environment."""
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise SystemExit("GITHUB_TOKEN is not set")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "build-engine-stage63",
        "Content-Type": "application/json",
    }
    request = urllib.request.Request(
        "https://api.github.com/repos/%s%s" % (REPO, path), data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, (json.loads(raw) if raw else None)
        except ValueError:
            return e.code, None


def tree_has(repo_path, ref, path):
    """Whether a path exists in a commit's tree, walked one level at a time."""
    status, commit = provider_api("GET", "/git/commits/" + ref)
    if status != 200:
        return False
    sha = commit["tree"]["sha"]
    for part in [p for p in path.split("/") if p]:
        status, tree = provider_api("GET", "/git/trees/" + sha)
        if status != 200:
            return False
        entry = None
        for candidate in tree.get("tree", []):
            if candidate["path"] == part:
                entry = candidate
                break
        if entry is None:
            return False
        if entry["type"] != "tree":
            return True
        sha = entry["sha"]
    return True


def blob_text(sha):
    status, blob = provider_api("GET", "/git/blobs/" + sha)
    if status != 200:
        return ""
    return base64.b64decode(blob.get("content") or "").decode("utf-8", "replace")


def commit_tree_files(commit_sha):
    """Every path in a commit's tree, flattened."""
    status, commit = provider_api("GET", "/git/commits/" + commit_sha)
    if status != 200:
        return []
    status, tree = provider_api("GET", "/git/trees/" + commit["tree"]["sha"] + "?recursive=1")
    if status != 200:
        return []
    return [entry["path"] for entry in tree.get("tree", [])]


def blob_sha_at(commit_sha, path):
    """The blob sha of a path in a commit's tree, or None."""
    status, commit = provider_api("GET", "/git/commits/" + commit_sha)
    if status != 200:
        return None
    status, tree = provider_api("GET", "/git/trees/" + commit["tree"]["sha"] + "?recursive=1")
    if status != 200:
        return None
    for entry in tree.get("tree", []):
        if entry["path"] == path:
            return entry["sha"]
    return None


def folder_blobs(commit_sha, folder):
    """{path relative to the folder: blob sha} for one folder in a commit's tree.

    The comparison the boundary check needs is not "which paths exist" but "which files
    changed": the disposable branch keeps what a previous run put there, so a path can be
    present before and after a commit without the commit having touched it.
    """
    status, commit = provider_api("GET", "/git/commits/" + commit_sha)
    if status != 200:
        return {}
    status, tree = provider_api("GET", "/git/trees/" + commit["tree"]["sha"] + "?recursive=1")
    if status != 200:
        return {}
    prefix = folder.strip("/") + "/"
    out = {}
    for entry in tree.get("tree", []):
        if entry["type"] == "blob" and entry["path"].startswith(prefix):
            out[entry["path"][len(prefix):]] = entry["sha"]
    return out


def commit_parent(commit_sha):
    status, commit = provider_api("GET", "/git/commits/" + commit_sha)
    if status != 200:
        return ""
    parents = commit.get("parents") or []
    return parents[0]["sha"] if parents else ""


def changed_files(before, after):
    """The files whose blob changed between two {path: sha} maps."""
    keys = set(before) | set(after)
    return sorted(path for path in keys if before.get(path) != after.get(path))


def committed_text(commit_sha, path):
    """The bytes a commit actually put on the branch, at a path."""
    sha = blob_sha_at(commit_sha, path)
    if sha is None:
        return ""
    return blob_text(sha)


def seed_task_folders(folders):
    """Create the task folders the gateway will commit into.

    The gateway never creates a task folder: the folder is the operator's claim, before the
    work order is issued (protocol section 12.3). The pilot is the operator here, so it seeds
    what it needs — and only the folders that are not there yet, so that a second run of the
    pilot does not touch the branch at all.
    """
    missing = [folder for folder in folders if not tree_has(REPO, BRANCH, folder)]
    if not missing:
        note("every task folder is already on the branch")
        return
    status, head = provider_api("GET", "/git/ref/heads/" + BRANCH)
    if status != 200:
        raise SystemExit("the disposable branch could not be read")
    head_sha = head["object"]["sha"]
    status, commit = provider_api("GET", "/git/commits/" + head_sha)
    if status != 200:
        raise SystemExit("the head commit of the disposable branch could not be read")
    base_tree = commit["tree"]["sha"]

    entries = []
    for folder in missing:
        status, blob = provider_api(
            "POST", "/git/blobs", {"content": "", "encoding": "utf-8"}
        )
        if status != 201:
            raise SystemExit("the provider answered %s when the placeholder was written" % status)
        entries.append(
            {
                "path": "%s/.keep" % folder,
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            }
        )
    status, tree = provider_api("POST", "/git/trees", {"base_tree": base_tree, "tree": entries})
    if status != 201:
        raise SystemExit("the provider answered %s when the tree was written" % status)
    identity = {
        "name": "build-engine stage 6.3 pilot",
        "email": "stage63@users.noreply.github.com",
        "date": "2026-01-01T00:00:00Z",
    }
    status, new_commit = provider_api(
        "POST",
        "/git/commits",
        {
            "tree": tree["sha"],
            "parents": [head_sha],
            "message": "stage 6.3: seed the pilot's task folders",
            "author": identity,
            "committer": identity,
        },
    )
    if status != 201:
        raise SystemExit("the provider answered %s when the seeding commit was written" % status)
    status, _ = provider_api(
        "PATCH", "/git/refs/heads/" + BRANCH, {"sha": new_commit["sha"], "force": False}
    )
    if status != 200:
        raise SystemExit("the provider answered %s when the branch was moved" % status)
    note("seeded %d task folder(s): %s" % (len(missing), ", ".join(missing)))


class Pilot:
    """Everything a scenario needs."""

    def __init__(self, gateway, proxy, secret, operator):
        self.gateway = gateway
        self.proxy = proxy
        self.secret = secret
        self.operator = operator
        # The last capability that was minted, so that the hygiene check can look for its
        # signature in the places a signature must not be.
        self.last_capability = None

    def base(self):
        return self.gateway.base

    def mint(self, task, order, head=None):
        """A capability, minted with the shipped signing code."""
        head = head or branch_head()
        rc, out = run(
            ["node", "--experimental-strip-types", "--import", "./tests/helpers/register.mjs",
             "scripts/mint-root-url.ts",
             "--kid", KID, "--task", task, "--order", order, "--plan", PLAN_ID,
             "--writer", WRITER, "--head", head, "--base", self.base(), "--ttl", "3600"],
            cwd=WRITE_GW,
            env={"SIGNING_KEYS": json.dumps({KID: self.secret})},
            check_rc=False,
        )
        for line in out.splitlines():
            if line.startswith("capability:"):
                self.last_capability = line.split(":", 1)[1].strip()
                return self.last_capability
        raise SystemExit("the capability could not be minted: %s" % out.strip())

    def stage(self, capability, path, text):
        """Create the file and append its content, the way an agent does.

        A `create` that is refused with `path-exists` is not a failure here: the file is
        already scaffolded, and the agent's next move is the same append.
        """
        status, body = http("GET", capability + "/create?path=" + path)
        if code_of(body) is not None and code_of(body) != "path-exists":
            return status, body
        return self.append(capability, path, text)

    def append(self, capability, path, text):
        """Append the content, from sequence 1."""
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        data = base64.urlsafe_b64encode(text.encode("utf-8")).decode().rstrip("=")
        return http(
            "GET", "%s/append?path=%s&seq=1&hash=%s&data=%s" % (capability, path, digest, data)
        )

    def read_back(self, capability, path):
        status, body = http("GET", capability + "/read?path=" + path)
        result = payload_of(body)
        try:
            data = base64.urlsafe_b64decode((result.get("data") or "") + "==").decode("utf-8", "replace")
        except Exception:
            data = ""
        return status, result, data

    def status(self, capability):
        status, body = http("GET", capability + "/status")
        return status, body, payload_of(body)

    def commit(self, capability, files, timeout=90):
        return http("GET", capability + "/commit?files=" + files, timeout=timeout)


def commits_on_branch(since, until):
    """How many commits are between two shas, inclusive of the newer one."""
    status, compare = provider_api("GET", "/compare/%s...%s" % (since, until))
    if status != 200:
        return None
    return len(compare.get("commits") or [])


# ===================================================================== the scenarios


def scenario_staging_interrupted(pilot):
    """6.3.1  the staging, interrupted by a restart.

    The staged bytes are ephemeral and the inventory is durable (protocol section 13.1). A
    restart therefore leaves a file the gateway knows about and no longer has. The recovery
    path is protocol section 13.2: `status` says `content: missing`, `create` resets the file
    and says `resurrected`, and the agent sends the content again.
    """
    say("6.3.1  the staging, interrupted by a restart")
    task, order = TASKS["staging"]
    path = "recovered.md"
    text = "# Recovered\n\nThe bytes were lost to a restart and the agent sent them again.\n"
    capability = pilot.mint(task, order)

    status, body = pilot.stage(capability, path, text)
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)
    status, result, data = pilot.read_back(capability, path)
    check(data == text, "the staged content reads back byte for byte before the interruption")

    note("--- the gateway is stopped and started again: an eviction with nothing else ---")
    pilot.gateway.restart()

    status, body, snapshot = pilot.status(capability)
    files = {entry["path"]: entry for entry in snapshot.get("files") or []}
    entry = files.get(path)
    check(status == 200, "the session is still there after the restart (%d)" % status)
    check(entry is not None, "the inventory survived the restart: the file is still listed")
    if entry is not None:
        check(entry.get("content") == "missing",
              "the content is reported as missing (%s)" % entry.get("content"))
        check(entry.get("bytes") == 0, "no bytes are claimed for the lost content")
        check(entry.get("last_seq") == 1,
              "the sequence metadata survived the restart (last_seq %s)" % entry.get("last_seq"))
    check((snapshot.get("quota") or {}).get("bytes_lost", 0) > 0,
          "the loss is reported, not hidden (bytes_lost %s)"
          % (snapshot.get("quota") or {}).get("bytes_lost"))

    status, body = http("GET", capability + "/create?path=" + path)
    result = payload_of(body)
    check(status == 200 and result.get("resurrected") is True,
          "create resets the file and says so (resurrected %s)" % result.get("resurrected"))

    status, body = pilot.append(capability, path, text)
    check(status == 200 and code_of(body) is None, "the content was sent again (%d %s)" % (status, code_of(body)))
    status, result, data = pilot.read_back(capability, path)
    check(data == text, "the content reads back byte for byte after the recovery")

    status, body = pilot.commit(capability, path)
    commit_sha = payload_of(body).get("commit")
    check(status == 200 and commit_sha, "the recovered file committed (%s)" % (commit_sha or code_of(body)))
    check(branch_head() == commit_sha, "the branch head is the commit")
    folder = "plans/%s/submissions/%s/%s" % (PLAN_ID, order, task)
    paths = commit_tree_files(commit_sha) if commit_sha else []
    check("%s/%s" % (folder, path) in paths,
          "the recovered file is in the task's folder on the branch")
    check(committed_text(commit_sha, "%s/%s" % (folder, path)) == text,
          "the file on the branch holds exactly the bytes that were staged")
    return commit_sha


def scenario_commit_answer_lost(pilot):
    """6.3.1  the commit, interrupted after the provider acted.

    The provider applied the branch update and the answer never arrived. The gateway timed
    out, looked at the branch, found its own commit there, and said it landed. The commit
    must exist exactly once: a retry is a replay, not a second commit.
    """
    say("6.3.1  the commit, interrupted after the provider acted")
    task, order = TASKS["lost"]
    path = "lost-answer.md"
    text = "# The answer was lost\n\nThe provider acted; the answer never came.\n"
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, path, text)
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.clear_log()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "hang_after",
            "hang_seconds": 30,
            "count": 1,
        }
    ])
    status, body = pilot.commit(capability, path)
    commit_sha = payload_of(body).get("commit")
    check(status == 200 and commit_sha,
          "the gateway says the commit landed (%s)" % (commit_sha or code_of(body)))
    check(branch_head() == commit_sha, "the branch head is the commit: it really did land")
    check(commits_on_branch(before, commit_sha) == 1,
          "exactly one commit was added to the branch (%s)"
          % commits_on_branch(before, commit_sha))
    check(committed_text(commit_sha, "plans/%s/submissions/%s/%s/%s" % (PLAN_ID, order, task, path)) == text,
          "the file on the branch holds exactly the bytes that were staged")

    pilot.proxy.clear_rules()
    status, body = pilot.commit(capability, path)
    result = payload_of(body)
    check(status == 200 and result.get("replayed") is True,
          "the retry is a replay, not a second commit (replayed %s)" % result.get("replayed"))
    check(result.get("commit") == commit_sha, "the replay names the same commit")
    check(branch_head() == commit_sha, "the branch head did not move")
    check(pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH") == 1,
          "the provider was asked to move the branch exactly once (%d)"
          % pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH"))
    return commit_sha


def scenario_provider_silent(pilot):
    """6.3.2  the provider does not answer at all.

    The provider accepts the branch update and says nothing. The gateway times out, reads the
    branch, sees that it did not move, tries once more, reads it again, and sees that it did
    not move either. So the commit demonstrably did not land: this is a provider that did not
    do its job, and the contract's answer for that is `503 provider-unavailable` — retryable,
    and the retry delivers the same commit.
    """
    say("6.3.2  the provider does not answer at all")
    task, order = TASKS["provider_silent"]
    path = "provider-silent.md"
    text = "# The provider is silent\n\nIt never answered.\n"
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, path, text)
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.clear_log()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "hang_before",
            "hang_seconds": 30,
            "count": 4,
        }
    ])
    status, body = pilot.commit(capability, path, timeout=120)
    check(status == 503 and code_of(body) == "provider-unavailable",
          "the gateway says the provider did not complete the request (%d %s)" % (status, code_of(body)))
    check(branch_head() == before, "the branch did not move: nothing was committed")
    check(pilot.proxy.count("/git/commits", method="POST") == 1,
          "exactly one commit object was created (%d)"
          % pilot.proxy.count("/git/commits", method="POST"))
    check(pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH") == 2,
          "the branch update was attempted twice, and neither was answered (%d)"
          % pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH"))

    note("--- the provider comes back: the retry must deliver the same commit ---")
    pilot.proxy.clear_rules()
    status, body = pilot.commit(capability, path, timeout=120)
    commit_sha = payload_of(body).get("commit")
    check(status == 200 and commit_sha,
          "the retry landed the commit (%s)" % (commit_sha or code_of(body)))
    check(branch_head() == commit_sha, "the branch head is the commit")
    check(pilot.proxy.count("/git/commits", method="POST") == 1,
          "no second commit object was created (%d)"
          % pilot.proxy.count("/git/commits", method="POST"))
    check(commits_on_branch(before, commit_sha) == 1,
          "exactly one commit was added to the branch (%s)"
          % commits_on_branch(before, commit_sha))
    check(committed_text(commit_sha, "plans/%s/submissions/%s/%s/%s" % (PLAN_ID, order, task, path)) == text,
          "the file on the branch holds exactly the bytes that were staged")
    return commit_sha


def scenario_commit_outcome_unknown(pilot):
    """6.3.1  the commit, interrupted while somebody else moved the branch.

    The provider does not answer, and while it does not answer a third party moves the branch.
    Now the gateway cannot tell: the branch is not at its commit and not at the expected head
    either. The answer is `409 reconcile-required`, and the gateway must not issue a second
    commit to find out.
    """
    say("6.3.1  the commit, interrupted while somebody else moved the branch")
    task, order = TASKS["unknown"]
    path = "unknown-outcome.md"
    text = "# Unknown\n\nThe branch moved under the commit.\n"
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, path, text)
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.clear_log()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "hang_before",
            "hang_seconds": 30,
            "count": 4,
        }
    ])

    # The commit is in flight, and the branch moves underneath it. The move is the operator's
    # own action: it is what a conflicting update looks like from the gateway's side.
    outcome = {}

    def commit_now():
        outcome["status"], outcome["body"] = pilot.commit(capability, path, timeout=120)

    thread = threading.Thread(target=commit_now)
    thread.start()
    time.sleep(0.3)
    moved_to = moves_the_branch(
        "stage 6.3: somebody else moved the branch while a commit was in flight",
        {"plans/%s/operator/notice.md" % PLAN_ID: "# The operator moved the branch\n"},
    )
    thread.join(timeout=180)

    status = outcome.get("status")
    body = outcome.get("body", "")
    check(status == 409 and code_of(body) == "reconcile-required",
          "the gateway refuses to guess (%d %s)" % (status, code_of(body)))
    check(branch_head() == moved_to, "the branch is at the other commit: the gateway did not move it")
    check(pilot.proxy.count("/git/commits", method="POST") == 1,
          "exactly one commit object was created (%d)"
          % pilot.proxy.count("/git/commits", method="POST"))
    check(commits_on_branch(before, moved_to) == 1,
          "the only commit on the branch is the other one (%s)"
          % commits_on_branch(before, moved_to))
    pilot.proxy.clear_rules()
    return moved_to


def scenario_rate_limited(pilot):
    """6.3.2  the provider's rate limit.

    Two cases, and they are different answers. A rate limit that clears is a retry and the
    commit lands. A rate limit that does not clear is `429 provider-rate-limited`, the branch
    does not move, and the operator is told to come back later.
    """
    say("6.3.2  the provider's rate limit")
    pilot.proxy.clear_log()

    task, order = TASKS["ratelimit"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "rate-limited.md", "# Rate limited\n\nRetried.\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "status",
            "status": 429,
            "retry_after": "1",
            "count": 2,
        }
    ])
    status, body = pilot.commit(capability, "rate-limited.md", timeout=120)
    commit_sha = payload_of(body).get("commit")
    check(status == 200 and commit_sha,
          "the commit landed after the rate limit cleared (%s)" % (commit_sha or code_of(body)))
    check(branch_head() == commit_sha, "the branch head is the commit")
    check(commits_on_branch(before, commit_sha) == 1,
          "exactly one commit was added to the branch (%s)"
          % commits_on_branch(before, commit_sha))
    check(pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH") == 3,
          "the branch update was attempted three times: two rate limits and one success (%d)"
          % pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH"))

    note("--- a rate limit that does not clear ---")
    pilot.proxy.clear_log()
    pilot.proxy.clear_rules()
    task, order = TASKS["exhausted"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "rate-limited.md", "# Rate limited\n\nNo end.\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "status",
            "status": 429,
            "retry_after": "1",
            "count": 99,
        }
    ])
    status, body = pilot.commit(capability, "rate-limited.md", timeout=120)
    check(status == 429 and code_of(body) == "provider-rate-limited",
          "the gateway says the provider is rate limiting it (%d %s)" % (status, code_of(body)))
    check(branch_head() == before, "the branch did not move: nothing was committed")
    pilot.proxy.clear_rules()


def scenario_branch_moved(pilot):
    """6.3.2  the branch moved under the capability.

    The capability pins the head, and the pin is what stops two writers from racing onto the
    branch. Two cases: the capability is stale, and two writers hold the same head.
    """
    say("6.3.2  the branch moved under the capability")
    pilot.proxy.clear_log()

    task, order = TASKS["stale"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "stale.md", "# Stale\n\nThe branch moved.\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)

    before = branch_head()
    pilot.proxy.clear_rules()
    moves_the_branch(
        "stage 6.3: the branch moved under the capability",
        {"plans/%s/operator/notice.md" % PLAN_ID: "# The operator moved the branch\n"},
    )
    after = branch_head()
    check(after != before, "the branch moved under the capability")

    status, body = pilot.commit(capability, "stale.md", timeout=120)
    check(status == 409 and code_of(body) == "expected-sha-conflict",
          "the stale capability is refused (%d %s)" % (status, code_of(body)))
    check(branch_head() == after, "the branch did not move again")
    check(pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH") == 0,
          "the gateway never tried to move the branch (%d)"
          % pilot.proxy.count("/git/refs/heads/" + BRANCH, method="PATCH"))

    note("--- two writers, one head ---")
    pilot.proxy.clear_log()
    task_a, order_a = TASKS["writer_a"]
    task_b, order_b = TASKS["writer_b"]
    head = branch_head()
    capability_a = pilot.mint(task_a, order_a, head=head)
    capability_b = pilot.mint(task_b, order_b, head=head)
    pilot.stage(capability_a, "writer-a.md", "# Writer A\n")
    pilot.stage(capability_b, "writer-b.md", "# Writer B\n")

    status, body = pilot.commit(capability_a, "writer-a.md", timeout=120)
    commit_a = payload_of(body).get("commit")
    check(status == 200 and commit_a, "the first writer's commit landed (%s)" % (commit_a or code_of(body)))
    check(branch_head() == commit_a, "the branch head is the first writer's commit")

    status, body = pilot.commit(capability_b, "writer-b.md", timeout=120)
    check(status == 409 and code_of(body) == "expected-sha-conflict",
          "the second writer, holding the same head, is refused (%d %s)" % (status, code_of(body)))
    check(branch_head() == commit_a, "the branch head is still the first writer's commit")
    paths = commit_tree_files(commit_a)
    check(not any(path.endswith("writer-b.md") for path in paths),
          "the second writer's file is not on the branch")


def moves_the_branch(message, files):
    """The operator moves the disposable branch: a commit of their own, directly.

    This is the operator's own action, not the gateway's: it is what a conflicting update
    looks like from the gateway's side.
    """
    status, head = provider_api("GET", "/git/ref/heads/" + BRANCH)
    if status != 200:
        raise SystemExit("the disposable branch could not be read")
    head_sha = head["object"]["sha"]
    status, commit = provider_api("GET", "/git/commits/" + head_sha)
    base_tree = commit["tree"]["sha"]
    entries = []
    for path, content in sorted(files.items()):
        status, blob = provider_api("POST", "/git/blobs", {"content": content, "encoding": "utf-8"})
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    status, tree = provider_api("POST", "/git/trees", {"base_tree": base_tree, "tree": entries})
    identity = {
        "name": "build-engine stage 6.3 pilot",
        "email": "stage63@users.noreply.github.com",
        "date": "2026-01-01T00:00:00Z",
    }
    status, new_commit = provider_api(
        "POST",
        "/git/commits",
        {
            "tree": tree["sha"],
            "parents": [head_sha],
            "message": message,
            "author": identity,
            "committer": identity,
        },
    )
    if status != 201:
        raise SystemExit("the provider answered %s when the operator commit was written" % status)
    provider_api("PATCH", "/git/refs/heads/" + BRANCH, {"sha": new_commit["sha"], "force": False})
    return new_commit["sha"]


def scenario_seal_interrupted(pilot):
    """6.3.1  the seal, interrupted.

    The seal is the agent's statement that the folder is complete, and it is irreversible. The
    property that matters is that it is **atomic**: an interruption leaves the task either
    open or sealed, never in between, and the commit record is never lost.
    """
    say("6.3.1  the seal, interrupted")
    task, order = TASKS["seal"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "sealed.md", "# Sealed\n\nThe task is complete.\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)
    status, body = pilot.commit(capability, "sealed.md", timeout=120)
    commit_sha = payload_of(body).get("commit")
    check(status == 200 and commit_sha, "the commit landed (%s)" % (commit_sha or code_of(body)))

    status, body = http("GET", capability + "/seal", timeout=60)
    check(status == 200 and json.loads(body).get("state") == "sealed", "the task is sealed")
    first_seal = payload_of(body)

    note("--- the gateway is restarted: the seal is durable ---")
    pilot.gateway.restart()
    # A sealed task refuses every operation except the index and a repeated seal, so the
    # status is asked of the index, and the refusal of the status is itself the proof that
    # the seal is still in force.
    status, body = http("GET", capability + "/index")
    check(status == 200 and json.loads(body).get("state") == "sealed",
          "the task is still sealed after the restart (%s)" % json.loads(body).get("state"))
    status, body = http("GET", capability + "/status")
    check(status == 410 and code_of(body) == "task-sealed",
          "the sealed task still refuses everything but the index (%d %s)" % (status, code_of(body)))
    status, body = http("GET", capability + "/create?path=after-the-seal.md")
    check(status == 410 and code_of(body) == "task-sealed",
          "a write after the seal is refused (%d %s)" % (status, code_of(body)))
    status, body = http("GET", capability + "/seal", timeout=60)
    check(status == 200 and payload_of(body).get("at") == first_seal.get("at"),
          "a repeated seal returns the recorded outcome")
    check(payload_of(body).get("commit") == commit_sha, "the recorded seal names the commit")


def scenario_seal_in_flight(pilot):
    """6.3.1  the seal request, interrupted in flight.

    The seal is sent and the gateway is killed while the request is on the wire. Whatever the
    race decides, the state afterwards must be one of the two legal states, and the task must
    be able to finish from either of them.
    """
    say("6.3.1  the seal request, interrupted in flight")
    task, order = TASKS["seal_in_flight"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "in-flight.md", "# In flight\n\nThe seal was interrupted.\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)
    status, body = pilot.commit(capability, "in-flight.md", timeout=120)
    check(status == 200 and payload_of(body).get("commit"),
          "the commit landed (%s)" % (payload_of(body).get("commit") or code_of(body)))

    outcome = {}

    def send():
        outcome["status"], outcome["body"] = http("GET", capability + "/seal", timeout=30)

    thread = threading.Thread(target=send)
    thread.start()
    time.sleep(0.02)
    pilot.gateway.stop()
    thread.join(timeout=40)
    pilot.gateway.start()

    # The index is the one operation that survives a seal, so it is what asks the question.
    # The state is in the envelope; the commit record is in the result.
    status, body = http("GET", capability + "/index")
    envelope = json.loads(body)
    index = payload_of(body)
    state = envelope.get("state")
    note("the seal request answered %s before the gateway was killed" % outcome.get("status"))
    check(state in ("open", "sealed"),
          "the interrupted seal left a legal state behind (%s)" % state)
    check(index.get("committed") is not None,
          "the commit record survived the interruption")
    if state == "sealed":
        status, body = http("GET", capability + "/create?path=after.md")
        check(status == 410 and code_of(body) == "task-sealed",
              "a write after the interrupted seal is refused (%d %s)" % (status, code_of(body)))
    else:
        status, body = http("GET", capability + "/seal", timeout=60)
        check(status == 200 and json.loads(body).get("state") == "sealed",
              "the seal can be re-issued after the interruption (%d %s)" % (status, code_of(body)))


def scenario_five_outcomes(pilot):
    """6.3.3  the five outcomes the operator has to tell apart.

    The contract's table (protocol section 13.3) names five states an operator must be able
    to distinguish. The check is not that each one happens: it is that each one happens and
    that they are **distinguishable** — no two of them answer the same way.
    """
    say("6.3.3  the five outcomes, and that they are distinguishable")
    pilot.proxy.clear_log()
    observed = {}

    # 1. not committed: the commit named a file that was never staged.
    task, order = TASKS["not_committed"]
    capability = pilot.mint(task, order)
    before = branch_head()
    status, body = pilot.commit(capability, "never-staged.md", timeout=60)
    observed["not committed"] = (status, code_of(body), None)
    check(status == 409 and code_of(body) == "file-not-staged",
          "not committed: the commit is refused because the file was never staged (%d %s)"
          % (status, code_of(body)))
    check(branch_head() == before, "not committed: the branch did not move")

    # 2. committed but response lost: the provider acted and the answer never came, and the
    #    retry is a replay of the same commit rather than a second one.
    task, order = TASKS["lost_again"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "lost-again.md", "# Lost again\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "hang_after",
            "hang_seconds": 30,
            "count": 1,
        }
    ])
    status, body = pilot.commit(capability, "lost-again.md", timeout=120)
    landed = payload_of(body).get("commit")
    check(status == 200 and landed,
          "committed, response lost: the gateway found its own commit on the branch (%s)"
          % (landed or code_of(body)))
    pilot.proxy.reset()
    status, body = pilot.commit(capability, "lost-again.md", timeout=60)
    observed["committed, response lost"] = (status, code_of(body), payload_of(body).get("replayed"))
    check(status == 200 and payload_of(body).get("replayed") is True,
          "committed, response lost: the retry replays the commit (%d %s)"
          % (status, code_of(body)))
    check(branch_head() == landed, "committed, response lost: exactly one commit is on the branch")

    # 3. sealed.
    task, order = TASKS["seal"]
    capability = pilot.mint(task, order)
    status, body = http("GET", capability + "/create?path=after-the-seal.md")
    observed["sealed"] = (status, code_of(body), None)
    check(status == 410 and code_of(body) == "task-sealed",
          "sealed: a write is refused with the seal's own code (%d %s)" % (status, code_of(body)))

    # 4. revoked.
    task, order = TASKS["revoked"]
    capability = pilot.mint(task, order)
    pilot.stage(capability, "revoked.md", "# Revoked\n")
    status, body = http(
        "POST",
        pilot.base() + "/admin/revoke",
        {"Authorization": "Bearer " + pilot.operator},
        {"task": task},
    )
    check(status in (200, 202), "revoked: the operator revoked the task (%d)" % status)
    status, body = http("GET", capability + "/status")
    observed["revoked"] = (status, code_of(body), None)
    check(status == 410 and code_of(body) == "task-revoked",
          "revoked: the capability no longer works (%d %s)" % (status, code_of(body)))

    # 5. unknown; reconcile required. This is the one case the gateway cannot resolve by
    #    itself: the provider did not answer, and the branch is no longer where it was.
    task, order = TASKS["unknown_again"]
    capability = pilot.mint(task, order)
    status, body = pilot.stage(capability, "unknown-again.md", "# Unknown again\n")
    check(status == 200 and code_of(body) is None, "the file was staged (%d)" % status)
    pilot.proxy.clear_log()
    pilot.proxy.rules([
        {
            "method": "PATCH",
            "path_contains": "/git/refs/heads/" + BRANCH,
            "mode": "hang_before",
            "hang_seconds": 30,
            "count": 4,
        }
    ])
    outcome = {}

    def commit_now():
        outcome["status"], outcome["body"] = pilot.commit(capability, "unknown-again.md", timeout=120)

    thread = threading.Thread(target=commit_now)
    thread.start()
    time.sleep(0.3)
    moved_to = moves_the_branch(
        "stage 6.3: somebody else moved the branch while a commit was in flight",
        {"plans/%s/operator/notice-2.md" % PLAN_ID: "# The operator moved the branch\n"},
    )
    thread.join(timeout=180)
    status = outcome.get("status")
    body = outcome.get("body", "")
    observed["unknown; reconcile required"] = (status, code_of(body), None)
    check(status == 409 and code_of(body) == "reconcile-required",
          "unknown; reconcile required: the gateway refuses to guess (%d %s)" % (status, code_of(body)))
    check(branch_head() == moved_to,
          "unknown; reconcile required: the branch is at the other commit, not the gateway's")
    pilot.proxy.clear_rules()

    note("--- the five answers ---")
    for name, (status, code, extra) in observed.items():
        note("%-28s %s %s %s" % (name, status, code or "", extra if extra is not None else ""))
    signatures = {}
    for name, signature in observed.items():
        signatures.setdefault(signature, []).append(name)
    collisions = {k: v for k, v in signatures.items() if len(v) > 1}
    check(not collisions,
          "the five outcomes are distinguishable: no two of them answer the same way")
    if collisions:
        for signature, names in collisions.items():
            note("the same answer for %s: %s" % (", ".join(names), signature))


def scenario_two_tasks_at_once(pilot):
    """6.3.4  two tasks at once, and no boundary crossed.

    Two tasks, two orders, two folders, one branch. The Durable Object is keyed by the task,
    so the sessions cannot be the same object; what has to be proved is that neither the
    files, nor the state, nor the audit records cross over.
    """
    say("6.3.4  two tasks at once")
    task_a, order_a = TASKS["concurrent_a"]
    task_b, order_b = TASKS["concurrent_b"]
    head = branch_head()
    capability_a = pilot.mint(task_a, order_a, head=head)
    capability_b = pilot.mint(task_b, order_b, head=head)

    status_a, body_a = http("GET", capability_a + "/index")
    status_b, body_b = http("GET", capability_b + "/index")
    envelope_a, envelope_b = json.loads(body_a), json.loads(body_b)
    folder_a = (envelope_a.get("result") or {}).get("folder")
    folder_b = (envelope_b.get("result") or {}).get("folder")
    check(envelope_a.get("task") == task_a and envelope_a.get("order") == order_a,
          "the first capability is bound to its own task and order")
    check(envelope_b.get("task") == task_b and envelope_b.get("order") == order_b,
          "the second capability is bound to its own task and order")
    check(folder_a != folder_b, "the two tasks resolve to two different folders")
    note("%s\n%s" % (folder_a, folder_b))

    # The two tasks stage at the same time.
    # The content carries a per-run token, so that a second run of the pilot really rewrites
    # the file rather than finding the previous run's bytes already on the branch.
    text_a = "# Only A\n\nrun %s\n" % NONCE
    text_b = "# Only B\n\nrun %s\n" % NONCE

    def stage(capability, path, text):
        return pilot.stage(capability, path, text)

    results = {}
    threads = [
        threading.Thread(target=lambda: results.update(a=stage(capability_a, "only-a.md", text_a))),
        threading.Thread(target=lambda: results.update(b=stage(capability_b, "only-b.md", text_b))),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    check(results["a"][0] == 200 and results["b"][0] == 200,
          "both tasks staged their file at the same time")

    status, body, snapshot_a = pilot.status(capability_a)
    status, body, snapshot_b = pilot.status(capability_b)
    files_a = [entry["path"] for entry in snapshot_a.get("files") or []]
    files_b = [entry["path"] for entry in snapshot_b.get("files") or []]
    check("only-a.md" in files_a and "only-b.md" not in files_a,
          "the first session holds only its own file (%s)" % files_a)
    check("only-b.md" in files_b and "only-a.md" not in files_b,
          "the second session holds only its own file (%s)" % files_b)

    # Neither capability can address the other task's file.
    status, body = http("GET", capability_a + "/read?path=only-b.md")
    check(code_of(body) == "file-not-found",
          "the first capability cannot read the second task's file (%d %s)" % (status, code_of(body)))
    status, body = http("GET", capability_b + "/read?path=only-a.md")
    check(code_of(body) == "file-not-found",
          "the second capability cannot read the first task's file (%d %s)" % (status, code_of(body)))

    # And neither can it address the other task's folder.
    status, body = http("GET", capability_a + "/create?path=../%s/only-b.md" % task_b)
    check(code_of(body) == "malformed-path",
          "a path out of the task's own folder is refused (%d %s)" % (status, code_of(body)))

    # The commits land one after the other: the second one needs a fresh head.
    status, body = pilot.commit(capability_a, "only-a.md", timeout=120)
    commit_a = payload_of(body).get("commit")
    check(status == 200 and commit_a, "the first task committed (%s)" % (commit_a or code_of(body)))
    capability_b = pilot.mint(task_b, order_b, head=branch_head())
    status, body = pilot.commit(capability_b, "only-b.md", timeout=120)
    commit_b = payload_of(body).get("commit")
    check(status == 200 and commit_b, "the second task committed (%s)" % (commit_b or code_of(body)))

    paths_a = commit_tree_files(commit_a)
    paths_b = commit_tree_files(commit_b)
    folder_a_path = "plans/%s/submissions/%s/%s" % (PLAN_ID, order_a, task_a)
    folder_b_path = "plans/%s/submissions/%s/%s" % (PLAN_ID, order_b, task_b)
    check(any(path.endswith("/%s/only-a.md" % task_a) for path in paths_a),
          "the first task's file is in the first task's folder")
    check(any(path.endswith("/%s/only-b.md" % task_b) for path in paths_b),
          "the second task's file is in the second task's folder")

    # The second commit is built on the first one's tree, and the base tree is carried over
    # untouched (protocol section 8.1). So the second commit *contains* the first task's
    # folder, and may even contain files a previous run of this pilot left there. What it must
    # not do is change anything in the other task's folder: the comparison is of the blobs,
    # not of the path sets.
    parent_a = commit_parent(commit_a)
    parent_b = commit_parent(commit_b)
    changed_a = changed_files(folder_blobs(parent_a, folder_a_path), folder_blobs(commit_a, folder_a_path))
    changed_b = changed_files(folder_blobs(parent_b, folder_b_path), folder_blobs(commit_b, folder_b_path))
    check(changed_a == ["only-a.md"],
          "the first commit changed exactly its own file in its own folder (%s)" % changed_a)
    check(changed_b == ["only-b.md"],
          "the second commit changed exactly its own file in its own folder (%s)" % changed_b)
    check(folder_blobs(commit_a, folder_b_path) == folder_blobs(parent_a, folder_b_path),
          "the first commit touched nothing in the second task's folder")
    check(folder_blobs(commit_b, folder_a_path) == folder_blobs(parent_b, folder_a_path),
          "the second commit touched nothing in the first task's folder")
    check(committed_text(commit_a, "%s/only-a.md" % folder_a_path) == text_a,
          "the first task's file on the branch holds exactly the bytes it staged")
    check(committed_text(commit_b, "%s/only-b.md" % folder_b_path) == text_b,
          "the second task's file on the branch holds exactly the bytes it staged")

    # One task's closure does not close the other.
    status, body = http(
        "POST",
        pilot.base() + "/admin/revoke",
        {"Authorization": "Bearer " + pilot.operator},
        {"task": task_a},
    )
    check(status in (200, 202), "the first task was revoked (%d)" % status)
    status, body = http("GET", capability_b + "/status")
    check(status == 200, "the second task is unaffected by the first task's revocation (%d)" % status)

    # The audit streams are per order, and they do not cross either.
    audit_a = http(
        "GET", pilot.base() + "/admin/audit?order=" + order_a,
        headers={"Authorization": "Bearer " + pilot.operator},
    )[1]
    audit_b = http(
        "GET", pilot.base() + "/admin/audit?order=" + order_b,
        headers={"Authorization": "Bearer " + pilot.operator},
    )[1]
    try:
        records_a = json.loads(audit_a)
        records_b = json.loads(audit_b)
    except ValueError:
        records_a = []
        records_b = []
    tasks_a = {record.get("task") for record in records_a}
    tasks_b = {record.get("task") for record in records_b}
    check(task_a in tasks_a, "the first order's audit stream holds the first task's records")
    check(task_b not in tasks_a, "the first order's audit stream holds none of the second task's")
    check(task_b in tasks_b, "the second order's audit stream holds the second task's records")
    check(task_a not in tasks_b, "the second order's audit stream holds none of the first task's")
    note("order %s: %d record(s), tasks %s" % (order_a, len(records_a), sorted(tasks_a)))
    note("order %s: %d record(s), tasks %s" % (order_b, len(records_b), sorted(tasks_b)))


def scenario_the_deployed_gateways(pilot):
    """The deployed staging gateways are unaffected by any of this.

    The write gateway's failures are local to the write gateway. This is the check that the
    other half of the pilot - the deployed staging gateways - is still standing, and still
    refusing what it must refuse.
    """
    say("the deployed staging gateways are unaffected")
    read_base = os.environ.get("READ_BASE", "")
    write_base = os.environ.get("WRITE_BASE", "")
    if not read_base or not write_base:
        note("no deployed base was given; this check needs READ_BASE and WRITE_BASE")
        return
    rc, out = run(
        [sys.executable, os.path.join(HERE, "staging-pilot.py"), "--probes-only",
         "--read-base", read_base, "--write-base", write_base],
        cwd=ROOT,
        check_rc=False,
    )
    check(rc == 0, "the deployed gateways still pass the Stage 6.2 probes")
    for line in out.splitlines():
        if line.strip().startswith(("ok", "FAIL")):
            note(line.strip())


def secret_hygiene(pilot):
    """Nothing that must not be seen is anywhere it could be seen.

    Two places, and both are checked rather than asserted:

    - the **audit stream**, which is where a request's values would end up if the redaction
      gate had a hole in it;
    - the **fault proxy's log**, which is a record of every request the gateway made, and is
      therefore the one place a credential could leak from a debugging tool.

    The staged content is checked too: a pilot that prints the bytes it delivered would put a
    consumer's content in a CI log.
    """
    say("nothing that must not be seen is anywhere it could be seen")
    blob = ""
    for order in sorted({order for _, order in TASKS.values()}):
        body = http(
            "GET", pilot.base() + "/admin/audit?order=" + order + "&limit=1000",
            headers={"Authorization": "Bearer " + pilot.operator},
        )[1]
        blob += body
    note("the audit stream of %d order(s): %d bytes" % (len({o for _, o in TASKS.values()}), len(blob)))
    for label, value in (
        ("the signing secret", pilot.secret),
        ("the operator token", pilot.operator),
        ("the provider credential", os.environ.get("GITHUB_TOKEN", "")),
        ("the staged content", "The bytes were lost to a restart"),
        ("a capability signature", (pilot.last_capability or "").split("/")[-1]),
    ):
        if not value:
            continue
        check(value not in blob, "%s is not in the audit stream" % label)

    log = pilot.proxy.log()
    text = json.dumps(log)
    for label, value in (
        ("the signing secret", pilot.secret),
        ("the operator token", pilot.operator),
        ("the provider credential", os.environ.get("GITHUB_TOKEN", "")),
    ):
        if not value:
            continue
        check(value not in text, "%s is not in the fault proxy's log" % label)
    check(all(set(entry) == {"method", "path", "outcome"} for entry in log.get("log", [])),
          "the fault proxy logs the method, the path and nothing else")
    check(all("authorization" not in json.dumps(entry).lower() for entry in log.get("log", [])),
          "the fault proxy's log holds no authorization header")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--read-base", default=os.environ.get("READ_BASE", ""),
                        help="the deployed staging read gateway (for the last check)")
    parser.add_argument("--write-base", default=os.environ.get("WRITE_BASE", ""),
                        help="the deployed staging write gateway (for the last check)")
    parser.add_argument("--keep", action="store_true", help="keep the gateway's state directory")
    args = parser.parse_args(argv)

    if not os.environ.get("GITHUB_TOKEN", ""):
        raise SystemExit(
            "GITHUB_TOKEN is not set; it must be a credential that can write to the disposable "
            "branches of the staging estate"
        )

    say("the disposable estate")
    head = branch_head()
    if not head:
        raise SystemExit("the disposable estate is not there; run ops/staging-estate.py create")
    note("branch:   %s" % BRANCH)
    note("head:     %s" % head)

    # The task folders, one per scenario. The gateway never creates them: they are the
    # operator's claim (protocol section 12.3), and this script is the operator.
    seed_task_folders(
        [
            "plans/%s/submissions/%s/%s" % (PLAN_ID, order, task)
            for task, order in TASKS.values()
        ]
    )

    # The local Durable Object state is cleared, so that the pilot is repeatable: a seal and a
    # revocation are durable by design, and the previous run's would still be there. This is
    # the LOCAL runtime's state, not the estate.
    shutil.rmtree(os.path.join(WRITE_GW, ".wrangler", "state"), ignore_errors=True)

    global NONCE
    NONCE = base64.urlsafe_b64encode(os.urandom(9)).decode().rstrip("=")

    secret = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
    operator = base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("=")

    proxy = FaultProxy(free_port())
    proxy.start()
    note("the fault proxy: %s" % proxy.base)

    gateway = LocalGateway(
        free_port(),
        {
            "SIGNING_KEYS": json.dumps({KID: secret}),
            "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
            "OPERATOR_TOKEN": operator,
        },
        proxy.base,
    )
    pilot = Pilot(gateway, proxy, secret, operator)

    try:
        say("the write gateway, on the local runtime")
        gateway.start()
        note("%s" % gateway.base)
        status, body = http("GET", gateway.base + "/healthz")
        check(status == 200, "the write gateway answers (%d)" % status)
        try:
            health = json.loads(body)
        except ValueError:
            health = {}
        note("scheme %s, environment %s, branch %s"
             % (health.get("protocol") or health.get("scheme"), health.get("deploy_env"),
                health.get("submissions_branch")))

        scenario_staging_interrupted(pilot)
        scenario_commit_answer_lost(pilot)
        scenario_provider_silent(pilot)
        scenario_commit_outcome_unknown(pilot)
        scenario_rate_limited(pilot)
        scenario_branch_moved(pilot)
        scenario_seal_interrupted(pilot)
        scenario_seal_in_flight(pilot)
        scenario_five_outcomes(pilot)
        scenario_two_tasks_at_once(pilot)
        scenario_the_deployed_gateways(pilot)
        secret_hygiene(pilot)
    finally:
        gateway.stop()
        proxy.stop()
        if not args.keep:
            shutil.rmtree(os.path.join(WRITE_GW, ".wrangler", "state"), ignore_errors=True)

    say("the result")
    if FAILURES:
        print("\033[1;31mTHE FAILURE PILOT FAILED: %d check(s)\033[0m" % len(FAILURES), flush=True)
        for failure in FAILURES:
            print("  - %s" % failure, flush=True)
        return 1
    print("\033[1;32mTHE FAILURE PILOT PASSED\033[0m (%d checks)" % len(STEPS), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
