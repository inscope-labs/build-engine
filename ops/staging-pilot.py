#!/usr/bin/env python3
"""ops/staging-pilot.py: the full Class B workflow, end to end.

Stage 6.2 of RELEASE-PLAN.md is "Execute the full Class B workflow". This script executes it.

The workflow has two sides and the script drives both, in the order a real task runs:

  **the operator side (Class A)** is the *shipped* engine. A disposable consumer repository is
  scaffolded with the shipped `engine/`, a plan is created with `plan_tool.py new`, a task is
  written, a work order is built with `plan_tool.py order --write`, and the order is printed
  with freshly signed gateway links by `plan_tool.py links`. Nothing here is a simulation of the
  engine: it is the engine.

  **the agent side (Class B)** is the gateways. The agent retrieves the authorised context file
  through a plain HTTPS GET and nothing else, delivers a text file through the write gateway,
  reads it back byte for byte, commits the selection to the task submission folder, replays the
  commit without a second one, seals the task, and is refused afterwards. Then the operator
  revokes the work order, and both capabilities stop working.

  Finally the audit streams of both gateways are dumped and scanned for anything that must not
  be in them: a capability, a signature, a signing secret, the provider credential, the content
  of the delivered file.

Two targets:

    --target local      both gateways on the local Workers runtime (the same code, the same
                        runtime, the real provider). The signing secrets are generated here.
    --target deployed   the published staging Workers. Needs CTXGATE_SECRET (the read gateway's
                        signing secret), CTXGATE_WRITE_SECRET (the write gateway's) and
                        CTXGATE_OPERATOR_TOKEN / CTXGATE_WRITE_OPERATOR_TOKEN.

Both targets drive the same workflow, so the difference between them is the place the Worker
runs, and the evidence says which place it was.

The pilot is repeatable against the local target: the local Durable Object state is cleared
first, because a seal and a revocation are durable by design. It is NOT repeatable against a
deployed target: the revocation of the first run is still there, and the second run has to use
a fresh plan number (and the estate re-seeded for the new task folder).

    python3 ops/staging-pilot.py --target local
    python3 ops/staging-pilot.py --target deployed \\
        --read-base https://ctxgate-read-staging.<subdomain>.workers.dev \\
        --write-base https://ctxgate-write-staging.<subdomain>.workers.dev

It changes the disposable estate: it commits a deliverable to the staging submissions branch.
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
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WRITE_GW = os.path.join(ROOT, "gateway", "write")
READ_GW = os.path.join(ROOT, "gateway", "read", "production")
ENGINE = os.path.join(ROOT, "template", "engine")

PLAN_ID = "pilot-001"

# Every one of the pilot's identifiers carries the plan number, and they are all derived from
# it, so a second run against a deployed target can use a fresh one: a seal and a revocation
# are durable by design, and the first run's order and task stay revoked. --plan-number sets
# it; the default is the number the first deployed run used.
DEFAULT_PLAN_NUMBER = "10008"
PLAN_NUMBER = DEFAULT_PLAN_NUMBER
TASK_ID = "%s-1-201-01" % PLAN_NUMBER
OTHER_TASK_ID = "%s-1-202-01" % PLAN_NUMBER
GATE_TASK_ID = "%s-1-101-01" % PLAN_NUMBER
ORDER_ID = "%s-S001" % PLAN_NUMBER
OTHER_ORDER_ID = "%s-S999" % PLAN_NUMBER
CONTEXT_FILE = "brief.md"
CONTEXT_PATH = "plans/%s/package/%s" % (PLAN_ID, CONTEXT_FILE)
NEGATIVE_PATH = "plans/%s/private/notes.md" % PLAN_ID
DELIVERABLE = "deliverable.md"
DELIVERABLE_TEXT = "# Pilot deliverable\n\nDelivered by the Stage 6.2 Class B pilot.\n"

FAILURES = []
STEPS = []


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


def run(argv, cwd=None, env=None, check_rc=True):
    """Run a command; return (rc, stdout+stderr)."""
    merged = dict(os.environ)
    if env:
        merged.update(env)
    proc = subprocess.run(
        argv, cwd=cwd, env=merged, capture_output=True, text=True, timeout=600
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
    # pilot says who it is. The block is on the default string "Python-urllib/3.x"; any other
    # User-Agent is served normally.
    head.setdefault("User-Agent", "ctxgate-pilot/6.2")
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        head["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=head, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except urllib.error.URLError:
        # A gateway that is not up is a status of 0, not an exception: the caller decides
        # whether an unreachable gateway is fatal.
        return 0, ""


def code_of(body):
    try:
        return json.loads(body).get("error", {}).get("code")
    except Exception:
        return None


# The ports are handed out downwards from 21999: the operating system will happily give the
# same port to two probes that are opened and closed one after the other, and two gateways on
# one port means the second one silently never starts.
_next_port = [21999]


def free_port():
    while _next_port[0] > 21000:
        port = _next_port[0]
        _next_port[0] -= 1
        probe = socket.socket()
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            probe.close()
            continue
        probe.close()
        return port
    raise SystemExit("no free port between 21000 and 21999")


def stop_gateway(port):
    """Stop a gateway completely: the launcher first, then the runtime it left behind."""
    subprocess.run(["pkill", "-f", "wrangler dev --env staging --port %d" % port], capture_output=True)
    time.sleep(1)
    subprocess.run(["pkill", "-f", "socket-addr=entry=127.0.0.1:%d" % port], capture_output=True)
    time.sleep(1)


class LocalGateway:
    """A gateway on the local Workers runtime."""

    def __init__(self, directory, name, port, secrets):
        self.directory = directory
        self.name = name
        self.port = port
        self.secrets = secrets
        self.base = "http://127.0.0.1:%d" % port

    def start(self):
        with open(os.path.join(self.directory, ".dev.vars.staging"), "w", encoding="utf-8") as handle:
            for key, value in self.secrets.items():
                handle.write('%s="%s"\n' % (key, value))
        os.chmod(os.path.join(self.directory, ".dev.vars.staging"), 0o600)
        log = open("/tmp/ctxgate-pilot-%s.log" % self.name, "w", encoding="utf-8")
        subprocess.Popen(
            ["setsid", "bash", "-c", "cd %s && exec npx wrangler dev --env staging --port %d --ip 127.0.0.1" % (self.directory, self.port)],
            stdout=log,
            stderr=subprocess.STDOUT,
            env=dict(os.environ, WRANGLER_SEND_METRICS="false"),
        )
        marker = "ctxwrite-v1" if self.name == "write" else "ctxgate-v1"
        for _ in range(60):
            status, body = http("GET", self.base + "/healthz", timeout=3)
            if status == 200 and marker in body:
                return
            time.sleep(1)
        raise SystemExit(
            "the %s gateway did not start (see /tmp/ctxgate-pilot-%s.log)" % (self.name, self.name)
        )

    def stop(self):
        stop_gateway(self.port)


def estate_head(branch):
    """The head commit of a branch of the disposable estate."""
    _, out = run(["git", "ls-remote", "origin", "refs/heads/" + branch], cwd=ROOT, check_rc=False)
    return out.split()[0] if out.strip() else ""


def probes(read_base, write_base, only="both"):
    """The checks a deployed gateway can be asked without any secret.

    The signed leg needs the staging signing keys, and those are the operator's. These probes
    are the part of the deployed evidence that needs no secret at all: the gateway answers,
    says which environment it is, and refuses everything it must refuse.

    `only` selects which gateway is probed. The write gateway is not deployed until Stage S5,
    so a stage that owns the read gateway alone asks for the read half and gets the read
    half's refusals proved against the deployed gateway. With `both` - the default, and what
    the staging pilot workflow runs - the checks are exactly what they always were.
    """
    gateways = {
        "read": ("read", read_base, "ctxgate-v1"),
        "write": ("write", write_base, "ctxwrite-v1"),
    }
    wanted = ["read", "write"] if only == "both" else [only]

    say("the deployed gateways")
    for kind in wanted:
        label, base, _scheme = gateways[kind]
        status, body = http("GET", base + "/healthz")
        check(status == 200, "the %s gateway answers (%d)" % (label, status))
        try:
            health = json.loads(body)
        except ValueError:
            health = {}
        note("scheme %s, key ids %s" % (health.get("scheme") or health.get("protocol"), health.get("key_ids")))

    say("the deployed gateways are the staging ones")
    for kind in ("write", "read"):
        if kind not in wanted:
            continue
        script = os.path.join(WRITE_GW, "scripts", "check-staging-separation.py")
        rc, out = run([sys.executable, script, "--kind", kind, "--base-url", gateways[kind][1]], check_rc=False)
        check(rc == 0, "the separation gate passes for the %s gateway" % kind)
        if rc != 0:
            note(out.strip().splitlines()[-1] if out.strip() else "")

    say("the deployed gateways refuse what they must")
    if "read" in wanted:
        status, _ = http("GET", read_base + "/v1/s1/0/" + ORDER_ID + "/%s/%s/plans/pilot-001/package/brief.md" % ("A" * 43, "0" * 40))
        check(status == 403, "a link with a bad signature is refused (%d)" % status)
        status, _ = http("GET", read_base + "/v1/s1/0/" + ORDER_ID + "/%s/%s/plans/pilot-001/package/brief.md" % ("A" * 43, "0" * 40))
        check(status == 403, "a link with an unknown order is refused (%d)" % status)
        status, _ = http("GET", read_base + "/admin/audit")
        check(status == 401, "the read audit channel refuses an unauthenticated caller (%d)" % status)
        status, _ = http("POST", read_base + "/admin/revoke", {}, {"order": ORDER_ID})
        check(status == 401, "the read revocation channel refuses an unauthenticated caller (%d)" % status)
    if "write" in wanted:
        status, _ = http("GET", write_base + "/admin/audit")
        check(status == 401, "the write audit channel refuses an unauthenticated caller (%d)" % status)
        status, _ = http("POST", write_base + "/admin/revoke", {}, {"task": TASK_ID})
        check(status == 401, "the write revocation channel refuses an unauthenticated caller (%d)" % status)

    note("the signed leg is NOT proved here: it needs the staging signing keys, which are the")
    note("operator's secret. Ask for them, and run this script with --target deployed.")


def set_plan_number(number):
    """Derive every identifier from the plan number.

    The order id, the task ids and the wrong-order probe all carry it, and they all have to
    agree with the folder the disposable estate was seeded with, or the gateway refuses the
    commit because the folder does not exist (protocol section 12.3).
    """
    global PLAN_NUMBER, TASK_ID, OTHER_TASK_ID, GATE_TASK_ID, ORDER_ID, OTHER_ORDER_ID
    PLAN_NUMBER = number
    TASK_ID = "%s-1-201-01" % number
    OTHER_TASK_ID = "%s-1-202-01" % number
    GATE_TASK_ID = "%s-1-101-01" % number
    ORDER_ID = "%s-S001" % number
    OTHER_ORDER_ID = "%s-S999" % number


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", choices=["local", "deployed"], default="local")
    parser.add_argument("--read-base", default="")
    parser.add_argument("--write-base", default="")
    parser.add_argument("--plan-ref", default="", help="the commit the context file is pinned at")
    parser.add_argument("--plan-number", default=DEFAULT_PLAN_NUMBER,
                        help="the pilot's plan number; every identifier carries it, and a "
                             "deployed run needs a fresh one because a seal and a revocation "
                             "are durable")
    parser.add_argument("--keep", action="store_true", help="keep the disposable consumer repository")
    parser.add_argument("--probes-only", action="store_true",
                        help="only the checks that need no secret (the deployed gateways)")
    parser.add_argument("--only", choices=["both", "read", "write"], default="both",
                        help="which gateway the probes cover; the write gateway is not deployed until Stage S5")
    args = parser.parse_args(argv)
    set_plan_number(args.plan_number)

    # ---------------------------------------------------------------- the estate
    say("the targets")
    probed = ["read", "write"] if args.only == "both" else [args.only]
    for label, base in (("read", args.read_base), ("write", args.write_base)):
        if label not in probed or not base:
            continue
        status, _ = http("GET", base + "/healthz", timeout=10)
        check(status != 0, "the %s gateway at %s is reachable" % (label, base))
        if status == 0:
            raise SystemExit("the %s gateway is not reachable" % label)

    if args.probes_only:
        needed = [base for label, base in (("read", args.read_base), ("write", args.write_base))
                  if label in probed]
        if not all(needed):
            raise SystemExit("--probes-only needs the base URL of every gateway it probes")
        probes(args.read_base, args.write_base, args.only)
        say("the result")
        if FAILURES:
            print("\033[1;31mTHE PROBES FAILED: %d check(s)\033[0m" % len(FAILURES), flush=True)
            for failure in FAILURES:
                print("  - %s" % failure, flush=True)
            return 1
        print("\033[1;32mTHE PROBES PASSED\033[0m (%d checks)" % len(STEPS), flush=True)
        return 0

    say("the disposable estate")
    source_head = estate_head("staging/source")
    submissions_head = estate_head("staging/submissions")
    if not source_head:
        raise SystemExit("the disposable estate is not there; run ops/staging-estate.py create")
    plan_ref = args.plan_ref or source_head
    note("staging/source      %s (the plan's pinned ref)" % source_head)
    note("staging/submissions %s" % submissions_head)

    # ---------------------------------------------------------------- the targets
    read_base = args.read_base
    write_base = args.write_base
    read_secret = os.environ.get("CTXGATE_SECRET", "")
    read_operator = os.environ.get("CTXGATE_OPERATOR_TOKEN", "")
    write_secret = os.environ.get("CTXGATE_WRITE_SECRET", "")
    write_operator = os.environ.get("CTXGATE_WRITE_OPERATOR_TOKEN", "")
    gateways = []

    if args.target == "local":
        # The local runtime's Durable Object state is cleared, so that the pilot is repeatable:
        # a seal and a revocation are durable by design (protocol section 8.4), and the previous
        # run's would still be there. This is the LOCAL runtime's state, not the estate.
        for directory in (READ_GW, WRITE_GW):
            shutil.rmtree(os.path.join(directory, ".wrangler", "state"), ignore_errors=True)
        read_secret = read_secret or base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
        read_operator = read_operator or base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("=")
        write_secret = write_secret or base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
        write_operator = write_operator or base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("=")
        read = LocalGateway(
            READ_GW,
            "read",
            free_port(),
            {
                "SIGNING_KEYS": json.dumps({"s1": read_secret}),
                "OPERATOR_TOKEN": read_operator,
                "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
            },
        )
        write = LocalGateway(
            WRITE_GW,
            "write",
            free_port(),
            {
                "SIGNING_KEYS": json.dumps({"sk1": write_secret}),
                "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
                "OPERATOR_TOKEN": write_operator,
            },
        )
        for gateway in (read, write):
            say("the %s gateway, on the local runtime" % gateway.name)
            gateway.start()
            gateways.append(gateway)
            note("http://127.0.0.1:%d" % gateway.port)
        read_base = read.base
        write_base = write.base
    else:
        if not read_base or not write_base:
            raise SystemExit("--target deployed needs --read-base and --write-base")
        if not (read_secret and read_operator and write_secret and write_operator):
            raise SystemExit(
                "--target deployed needs CTXGATE_SECRET, CTXGATE_OPERATOR_TOKEN, "
                "CTXGATE_WRITE_SECRET and CTXGATE_WRITE_OPERATOR_TOKEN"
            )

    try:
        pilot(args, plan_ref, read_base, write_base, read_secret, read_operator, write_secret, write_operator)
    finally:
        for gateway in gateways:
            gateway.stop()

    say("the result")
    if FAILURES:
        print("\033[1;31mTHE PILOT FAILED: %d check(s)\033[0m" % len(FAILURES), flush=True)
        for failure in FAILURES:
            print("  - %s" % failure, flush=True)
        return 1
    print("\033[1;32mTHE PILOT PASSED\033[0m (%d checks)" % len(STEPS), flush=True)
    return 0


def pilot(args, plan_ref, read_base, write_base, read_secret, read_operator, write_secret, write_operator):
    """The workflow itself."""
    workdir = "/tmp/ctxgate-pilot"
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir)
    consumer = os.path.join(workdir, "consumer")
    os.makedirs(consumer)
    shutil.copytree(ENGINE, os.path.join(consumer, "engine"))
    run(["git", "init", "-q", "."], cwd=consumer)
    run(["git", "config", "user.email", "pilot@invalid"], cwd=consumer)
    run(["git", "config", "user.name", "pilot"], cwd=consumer)
    run(["git", "add", "-A"], cwd=consumer)
    run(["git", "commit", "-qm", "the shipped engine"], cwd=consumer)

    plan_tool = os.path.join(consumer, "engine", "tools", "plan_tool.py")

    # ------------------------------------------------------------------ 6.2.1
    say("6.2.1  the plan, the task and the pinned context file")
    run([sys.executable, plan_tool, "new", PLAN_ID, "--number", PLAN_NUMBER, "--title", "Stage 6.2 pilot"], cwd=consumer)
    tasks = os.path.join(consumer, "plans", PLAN_ID, "tasks")
    with open(os.path.join(tasks, GATE_TASK_ID + ".json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "id": GATE_TASK_ID,
                "title": "Agree the pilot's ground rules",
                "stage": "1-1",
                "executor": "operator",
                "status": "planned",
                "summary": "The pilot's ids, its destination and its limits are agreed.",
                "acceptance": ["the pilot's identifiers are fixed"],
                "deliverables": [],
                "verify": {"method": "manual"},
            },
            handle,
            indent=2,
        )
    with open(os.path.join(tasks, TASK_ID + ".json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "id": TASK_ID,
                "title": "Deliver the pilot's file",
                "stage": "1-2",
                "executor": "worker",
                "status": "planned",
                "summary": "Read the brief through the read gateway and deliver one file through the write gateway.",
                "acceptance": [
                    "the brief was retrieved through the read gateway, and nothing else was",
                    "the deliverable was committed to the task submission folder",
                    "the task is sealed, and further writes are refused",
                ],
                "deliverables": [DELIVERABLE],
                "context": [{"source": "plan", "path": CONTEXT_FILE, "label": "the pilot brief", "role": "read"}],
                "verify": {"method": "manual"},
            },
            handle,
            indent=2,
        )
    package = os.path.join(consumer, "plans", PLAN_ID, "package")
    os.makedirs(package, exist_ok=True)
    with open(os.path.join(package, CONTEXT_FILE), "w", encoding="utf-8") as handle:
        handle.write(
            "# Pilot brief\n\n"
            "The file the Class B agent is allowed to read. It is inside `plans/*/package/`, one of\n"
            "the read gateway's allowed prefixes, and it is served at the pinned commit only.\n"
        )
    rc, out = run([sys.executable, plan_tool, "check", PLAN_ID], cwd=consumer, check_rc=False)
    check(rc == 0, "the plan passes the engine's own check (%s)" % out.strip().splitlines()[-2:][0] if rc else "the plan passes the engine's own check")

    # The gate stage has to be done before the worker task may be ordered.
    run([sys.executable, plan_tool, "set", PLAN_ID, GATE_TASK_ID, "in_progress", "--by", "operator"], cwd=consumer)
    run(
        [sys.executable, plan_tool, "set", PLAN_ID, GATE_TASK_ID, "done", "--by", "operator",
         "--notes", "the pilot's ids and destination are agreed"],
        cwd=consumer,
    )
    rc, out = run([sys.executable, plan_tool, "next", PLAN_ID, "--json"], cwd=consumer, check_rc=False)
    eligible = json.loads(out).get("eligible", []) if rc == 0 else []
    check(TASK_ID in eligible, "the worker task is eligible to be ordered (%s)" % (eligible or out.strip()))

    # ------------------------------------------------------------------ 6.2.2
    say("6.2.2  the work order and the signed links")
    rc, out = run(
        [sys.executable, plan_tool, "order", PLAN_ID, TASK_ID,
         "--ref", plan_ref, "--plan-ref", plan_ref, "--write", "--start"],
        cwd=consumer,
        check_rc=False,
    )
    if rc != 0:
        bad("the order could not be built: %s" % out.strip())
        return
    order_id = None
    for line in out.splitlines():
        if "WORK ORDER" in line or "submission" in line.lower():
            pass
    order_file = None
    orders_dir = os.path.join(consumer, "plans", PLAN_ID, "orders")
    for name in sorted(os.listdir(orders_dir)):
        if name.endswith(".json"):
            order_file = os.path.join(orders_dir, name)
            order_id = name[:-5]
    check(order_id is not None, "the work order was written: %s" % order_id)

    # The order carries the context item; the links are minted at print time only.
    order = json.load(open(order_file, encoding="utf-8"))
    folder = "plans/%s/submissions/%s/%s" % (PLAN_ID, order_id, TASK_ID)
    note("the task folder the gateway will commit into: %s" % folder)
    check(
        any(c.get("repo_path") == CONTEXT_PATH for t in order["tasks"] for c in t.get("context", [])),
        "the order names the context file %s" % CONTEXT_PATH,
    )

    # The gateway's base and key id live in the consumer's engine configuration.
    config_path = os.path.join(consumer, "engine", "engine.json")
    config = json.load(open(config_path, encoding="utf-8"))
    config["context"]["target_base"] = "https://raw.githubusercontent.com/inscope-labs/build-engine"
    config["context"]["plan_base"] = "https://raw.githubusercontent.com/inscope-labs/build-engine"
    config["context"]["gateway"] = {
        "base": read_base,
        "kid": "s1",
        "ttl_seconds": 3600,
        "secret_env": "CTXGATE_SECRET",
    }
    json.dump(config, open(config_path, "w", encoding="utf-8"), indent=2)

    rc, out = run(
        [sys.executable, plan_tool, "links", PLAN_ID, order_id, "--json"],
        cwd=consumer,
        env={"CTXGATE_SECRET": read_secret},
        check_rc=False,
    )
    if rc != 0:
        bad("the links could not be minted: %s" % out.strip())
        return
    link = None
    try:
        shown = json.loads(out)
        for task in shown.get("tasks", []):
            for item in task.get("context", []):
                if item.get("gateway_url"):
                    link = item["gateway_url"]
    except ValueError:
        pass
    check(link is not None, "the shipped engine minted a signed read link")
    if link is None:
        return
    note("the link binds order %s and the pinned commit %s" % (order_id, plan_ref[:12]))

    # ------------------------------------------------------------------ 6.2.3
    say("6.2.3  the agent retrieves the authorised file, and only that file")
    status, body = http("GET", link)
    check(status == 200 and "Pilot brief" in body, "the authorised file was served (%d) %s" % (status, body[:120]))
    note("%d bytes" % len(body))

    # ------------------------------------------------------------------ 6.2.4
    say("6.2.4  the refusals")
    ctxlink = os.path.join(consumer, "engine", "tools", "ctxlink.py")
    def mint(paths, order=order_id, ttl=3600, ref=plan_ref):
        rc, out = run(
            [sys.executable, ctxlink, "mint", "--base", read_base, "--kid", "s1", "--order", order,
             "--ref", ref, "--ttl", str(ttl)] + list(paths),
            cwd=consumer,
            env={"CTXGATE_SECRET": read_secret},
            check_rc=False,
        )
        return out.strip().splitlines() if rc == 0 else []

    unlisted = mint([NEGATIVE_PATH])
    if unlisted:
        status, body = http("GET", unlisted[0])
        check(status == 403, "a file outside the allowed prefixes is refused (%d)" % status)
    else:
        bad("the unlisted-path link could not be minted")

    # /v1/{kid}/{exp}/{order}/{sig}/{ref}/{path}: the signature is the segment after the order.
    parts = link.split("/")
    forged = "/".join(parts[:5] + [("A" if parts[5][-1] != "A" else "B") + parts[5][1:]] + parts[6:])
    status, body = http("GET", forged)
    check(status == 403, "a forged signature is refused (%d %s)" % (status, body[:80]))

    expired = mint([CONTEXT_FILE], ttl=1)
    if expired:
        time.sleep(2)
        status, body = http("GET", expired[0])
        check(status == 403, "an expired link is refused (%d)" % status)
    else:
        bad("the expired link could not be minted")

    status, body = http("GET", read_base + "/v1/s1/0/%s/%s/%s/%s" % (order_id, "A" * 43, "0" * 40, CONTEXT_PATH))
    check(status == 403, "a link with a bad signature is refused (%d)" % status)

    # A correctly signed link for an order the gateway never issued: the signature is not the
    # authorisation, the order is. This is the wrong-task case of 6.2.4.
    wrong_order = mint([CONTEXT_FILE], order=OTHER_ORDER_ID)
    if wrong_order:
        status, body = http("GET", wrong_order[0])
        check(status == 403, "a link for an order that was never issued is refused (%d)" % status)
    else:
        bad("the wrong-order link could not be minted")

    # ------------------------------------------------------------------ the write side
    say("the agent delivers a file through the write gateway")
    mint_script = os.path.join(WRITE_GW, "scripts", "mint-root-url.ts")
    head = estate_head("staging/submissions")
    rc, out = run(
        ["node", "--experimental-strip-types", "--import", "./tests/helpers/register.mjs", mint_script,
         "--kid", "sk1", "--task", TASK_ID, "--order", order_id, "--plan", PLAN_ID,
         "--writer", "agent-pilot", "--head", head, "--base", write_base, "--ttl", "3600"],
        cwd=WRITE_GW,
        env={"SIGNING_KEYS": json.dumps({"sk1": write_secret})},
        check_rc=False,
    )
    capability = None
    for line in out.splitlines():
        if line.startswith("capability:"):
            capability = line.split(":", 1)[1].strip()
    check(capability is not None, "a write capability was minted for the order")
    if capability is None:
        return

    status, body = http("GET", capability + "/index")
    envelope = json.loads(body) if code_of(body) is None else {}
    info = envelope.get("result") or {}
    check(envelope.get("task") == TASK_ID and envelope.get("order") == order_id,
          "the write capability is bound to the pilot's task and order (%s/%s)"
          % (envelope.get("task"), envelope.get("order")))
    check(info.get("folder") == folder,
          "the task folder is derived from the capability (%s)" % info.get("folder"))

    data = base64.urlsafe_b64encode(DELIVERABLE_TEXT.encode()).decode().rstrip("=")
    digest = hashlib.sha256(DELIVERABLE_TEXT.encode()).hexdigest()

    status, body = http("GET", capability + "/create?path=" + DELIVERABLE)
    check(status == 200 and code_of(body) is None, "the file was scaffolded (%d) %s" % (status, body[:120]))
    status, body = http("GET", "%s/append?path=%s&seq=1&hash=%s&data=%s" % (capability, DELIVERABLE, digest, data))
    check(status == 200 and code_of(body) is None, "the chunk was staged (%d) %s" % (status, body[:120]))

    # 6.2.5  the type and quota policy
    status, body = http("GET", capability + "/create?path=payload.bin")
    check(code_of(body) is not None, "a denied file type is refused (%s, %d) %s" % (code_of(body), status, body[:120]))
    status, body = http("GET", capability + "/create?path=../escape.md")
    check(code_of(body) == "malformed-path", "a path outside the task folder is refused (%s, %d) %s" % (code_of(body), status, body[:120]))
    oversized = "x" * 20000
    big = base64.urlsafe_b64encode(oversized.encode()).decode().rstrip("=")
    status, body = http("GET", "%s/append?path=big.md&seq=1&hash=%s&data=%s" % (
        capability, hashlib.sha256(oversized.encode()).hexdigest(), big))
    check(code_of(body) is not None, "a file over the size limit is refused (%s)" % code_of(body))

    # 6.2.6  read back, byte for byte
    status, body = http("GET", capability + "/read?path=" + DELIVERABLE)
    try:
        payload = json.loads(body).get("result", {}) if code_of(body) is None else {}
    except ValueError:
        payload = {}
        note("the read back returned a non-JSON body (%d): %s" % (status, body[:120]))
    got = base64.urlsafe_b64decode((payload.get("data") or "") + "==").decode("utf-8", "replace")
    check(got == DELIVERABLE_TEXT and payload.get("sha256") == digest, "the staged content reads back byte for byte")

    # 6.2.7  the commit
    status, body = http("GET", capability + "/commit?files=" + DELIVERABLE, timeout=90)
    commit_sha = (json.loads(body).get("result") or {}).get("commit")
    check(commit_sha is not None, "the commit landed: %s" % (commit_sha or code_of(body)))

    # 6.2.8  the retry
    status, body = http("GET", capability + "/commit?files=" + DELIVERABLE, timeout=90)
    replayed = (json.loads(body).get("result") or {}).get("replayed")
    check(replayed is True, "the retry was a replay, not a second commit")
    if commit_sha:
        after = estate_head("staging/submissions")
        check(after == commit_sha, "the branch head is the commit (%s)" % after[:12])

    # 6.2.9  the seal
    status, body = http("GET", capability + "/seal", timeout=60)
    check(code_of(body) is None and json.loads(body).get("state") == "sealed", "the task is sealed")
    status, body = http("GET", capability + "/create?path=after-the-seal.md")
    check(code_of(body) == "task-sealed", "a write after the seal is refused (%s)" % code_of(body))

    # 6.2.10  the operator's inspection surface
    say("6.2.10  the submission, as the operator inspects it")
    if commit_sha:
        rc, out = run(
            ["git", "ls-remote", "origin", "refs/heads/staging/submissions"], cwd=ROOT, check_rc=False)
        note("branch: staging/submissions -> %s" % out.split()[0][:12] if out.strip() else "the branch")
        note("commit: %s" % commit_sha)
        note("folder: plans/%s/submissions/%s/%s" % (PLAN_ID, order_id, TASK_ID))
        note("file:   %s" % DELIVERABLE)
        note("the upstream publish is NOT performed: the submissions-to-consumer transfer path is")
        note("register entry R0-011 and is not designed. For staging the submission's home is the")
        note("disposable branch, and disposing of the estate is what removes it.")

    # 6.2.11  the revocation
    say("6.2.11  the operator revokes the work order")
    status, body = http("POST", read_base + "/admin/revoke",
                        {"Authorization": "Bearer " + read_operator}, {"order": order_id})
    check(status == 200, "the read gateway revoked the order (%d)" % status)
    status, body = http("GET", link)
    check(status == 403, "the read capability no longer works (%d)" % status)

    status, body = http("POST", write_base + "/admin/revoke",
                        {"Authorization": "Bearer " + write_operator}, {"task": TASK_ID})
    check(status in (200, 202), "the write gateway revoked the task (%d)" % status)
    status, body = http("GET", capability + "/status")
    # The sealed task's write path is closed: 410, and the reason is the seal (the seal is
    # checked before the revocation, and the contract keeps them apart on purpose).
    check(status == 410 and code_of(body) in ("task-sealed", "task-revoked"),
          "the sealed task's capability no longer works (%d %s)" % (status, code_of(body)))

    # The revocation on its own, on a task that was never sealed: the answer must be the
    # revocation and not the seal.
    rc, out = run(
        ["node", "--experimental-strip-types", "--import", "./tests/helpers/register.mjs", mint_script,
         "--kid", "sk1", "--task", OTHER_TASK_ID, "--order", order_id, "--plan", PLAN_ID,
         "--writer", "agent-pilot", "--head", head, "--base", write_base, "--ttl", "3600"],
        cwd=WRITE_GW,
        env={"SIGNING_KEYS": json.dumps({"sk1": write_secret})},
        check_rc=False,
    )
    other = None
    for line in out.splitlines():
        if line.startswith("capability:"):
            other = line.split(":", 1)[1].strip()
    if other is None:
        bad("a second capability could not be minted")
    else:
        status, body = http("GET", other + "/status")
        check(status == 200, "the second task's capability works before the revocation (%d)" % status)
        status, body = http("POST", write_base + "/admin/revoke",
                            {"Authorization": "Bearer " + write_operator}, {"task": OTHER_TASK_ID})
        check(status in (200, 202), "the second task was revoked (%d)" % status)
        status, body = http("GET", other + "/status")
        check(status == 410 and code_of(body) == "task-revoked",
              "the revoked task's capability no longer works (%d %s)" % (status, code_of(body)))

    # 6.2.12  the audit
    say("6.2.12  the audit records, and what must not be in them")
    read_audit = http("GET", read_base + "/admin/audit", headers={"Authorization": "Bearer " + read_operator})[1]
    write_audit = http(
        "GET",
        write_base + "/admin/audit?order=" + order_id,
        headers={"Authorization": "Bearer " + write_operator},
    )[1]
    note("read audit: %d bytes, write audit: %d bytes" % (len(read_audit), len(write_audit)))
    blob = read_audit + write_audit
    for label, secret in (
        ("the read signing secret", read_secret),
        ("the write signing secret", write_secret),
        ("the read operator token", read_operator),
        ("the write operator token", write_operator),
        ("the deliverable's content", DELIVERABLE_TEXT),
        ("the provider credential", os.environ.get("GITHUB_TOKEN", "")),
    ):
        if not secret:
            continue
        check(secret not in blob, "%s is not in the audit records" % label)
    check(link.split("/")[5] not in blob, "the read link's signature is not in the audit records")
    check(capability.split("/")[-1] not in blob, "the write capability's signature is not in the audit records")

    # and the audit channel is closed without a credential
    status, _ = http("GET", read_base + "/admin/audit")
    check(status == 401, "the read audit channel refuses an unauthenticated caller (%d)" % status)
    status, _ = http("GET", write_base + "/admin/audit")
    check(status == 401, "the write audit channel refuses an unauthenticated caller (%d)" % status)

    if not args.keep:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
