#!/usr/bin/env python3
"""Render wrangler.toml from ops/environments.json, and check that the committed file matches.

The read gateway has three environments and they must not drift apart:

  test        the local environment: CI, the conformance suite, the operator's laptop
  staging     a disposable deployment, used for the pilot and for operational rehearsal
  production  the gateway the operator's own tasks are served by

wrangler.toml is the deployed configuration and it is generated, so that a change to an
environment is one edit in one file plus a regenerated artefact that a reviewer can read. The
deploy gate runs this script with --check and refuses to deploy if the committed wrangler.toml
does not match what ops/environments.json says, which is what makes the separation real rather
than aspirational.

The script also validates the configuration, and refuses to render a configuration that breaks
one of the operator's rules:

  - CTXGATE_TEST_CLOCK may not be set in a deployed environment. With it set, a caller carrying
    X-Conformance-Now can extend the life of an expired link. It is a test switch.
  - MAX_TTL may not exceed 259200 (72 h) and CLOCK_SKEW_TOLERANCE may not exceed 120 seconds
    (docs/decisions/0003). The gateway refuses to start with a larger value.
  - The key id sets of the deployed environments must be disjoint, so a link minted for one
    environment is refused with 'unknown-key' by the other.
  - Production may not be exposed on workers.dev: it is reachable on one named host only.
  - Every environment must name the three secrets it needs, and no secret value may appear in
    the file.

Not shipped in releases: it is operator tooling.

    python3 ops/render-environments.py            # write wrangler.toml
    python3 ops/render-environments.py --check    # fail if wrangler.toml is out of date
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCTION = HERE.parent
SOURCE = HERE / "environments.json"
TARGET = PRODUCTION / "wrangler.toml"

# The operator's approved ceilings (docs/decisions/0003).
MAX_TTL_CEILING = 259200
CLOCK_SKEW_CEILING = 120

# The secrets every environment needs. Named, never valued.
REQUIRED_SECRETS = ["SIGNING_KEYS", "OPERATOR_TOKEN", "GITHUB_TOKEN"]

# The settings that describe the policy, in the order they are written out.
VAR_ORDER = [
    "GITHUB_API_BASE",
    "GITHUB_REPO",
    "ALLOW_PREFIXES",
    "DENY_PATTERNS",
    "MAX_BYTES",
    "MAX_TTL",
    "CLOCK_SKEW_TOLERANCE",
    "SOURCE_TIMEOUT_MS",
    "RATE_LIMIT_PER_ORDER",
    "RATE_LIMIT_PER_IP",
    "RATE_LIMIT_GLOBAL",
    "REFUSAL_BURST",
    "REFUSAL_COOLDOWN_SECONDS",
    "AUDIT_RETENTION",
]

HEADER = """\
# ctxgate read gateway: the production Class B context-read route (RELEASE-PLAN.md Stage 4.2).
#
# Hosting is decided: docs/decisions/0001 (Cloudflare Workers, operator-owned, single-tenant).
#
# THIS FILE IS GENERATED from ops/environments.json by ops/render-environments.py. Do not edit
# it by hand: edit ops/environments.json, re-render, and commit both. The deploy gate runs
# 'python3 ops/render-environments.py --check' and refuses to deploy if the two disagree, so an
# environment cannot drift away from its own record.
#
# It carries NO secrets. The signing keys, the operator token and the repository credential are
# set per environment with 'wrangler secret put --env <env>'.
"""


class Invalid(Exception):
    """The configuration breaks one of the operator's rules."""


def load():
    return json.loads(SOURCE.read_text(encoding="utf-8"))


def validate(config):
    """Refuse to render a configuration that breaks a rule. Returns a list of problems."""
    problems = []
    environments = config.get("environments", {})

    for name in ("test", "staging", "production"):
        if name not in environments:
            problems.append("the '%s' environment is missing" % name)
    if problems:
        return problems

    for name, env in environments.items():
        vars_ = env.get("vars", {})

        # The test clock is a test switch. A deployed environment that has it set lets a caller
        # extend the life of an expired link.
        if "CTXGATE_TEST_CLOCK" in vars_ and env.get("deployed"):
            problems.append("%s sets CTXGATE_TEST_CLOCK: it is a test switch and must not be deployed" % name)

        # The ceilings.
        try:
            if int(vars_.get("MAX_TTL", MAX_TTL_CEILING)) > MAX_TTL_CEILING:
                problems.append("%s sets MAX_TTL above the approved ceiling of %d" % (name, MAX_TTL_CEILING))
        except (TypeError, ValueError):
            problems.append("%s has a MAX_TTL that is not a number" % name)
        try:
            if int(vars_.get("CLOCK_SKEW_TOLERANCE", CLOCK_SKEW_CEILING)) > CLOCK_SKEW_CEILING:
                problems.append("%s sets CLOCK_SKEW_TOLERANCE above the approved ceiling of %d"
                                % (name, CLOCK_SKEW_CEILING))
        except (TypeError, ValueError):
            problems.append("%s has a CLOCK_SKEW_TOLERANCE that is not a number" % name)

        # The secrets. Named, never valued.
        secrets = env.get("secrets", [])
        for required in REQUIRED_SECRETS:
            if required not in secrets:
                problems.append("%s does not declare the secret %s" % (name, required))
        for key in vars_:
            if key in REQUIRED_SECRETS:
                problems.append("%s sets the secret %s as a plain variable" % (name, key))

        # The key ids. There must be at least one, and they must be well formed.
        key_ids = env.get("key_ids", [])
        if not key_ids:
            problems.append("%s declares no key id" % name)
        for kid in key_ids:
            if not kid.replace("_", "").isalnum() or not 1 <= len(kid) <= 16:
                problems.append("%s declares the key id %r, which is not a valid kid" % (name, kid))

        # Production is reachable on one named host only.
        if name == "production":
            if env.get("exposure") == "workers_dev":
                problems.append("production may not be exposed on workers.dev")
            routes = env.get("routes", [])
            if not routes:
                problems.append("production declares no route: it would have no host to serve on")

    # The deployed environments must not share a key id.
    staging = set(environments.get("staging", {}).get("key_ids", []))
    production = set(environments.get("production", {}).get("key_ids", []))
    shared = sorted(staging & production)
    if shared:
        problems.append("staging and production share the key id(s) %s: a link minted for one "
                        "would be accepted by the other" % ", ".join(shared))

    # The deployed environments must not share a worker name AND a repository: that would be the
    # same gateway wearing two hats.
    staging_env = environments.get("staging", {})
    production_env = environments.get("production", {})
    if (staging_env.get("worker_name") == production_env.get("worker_name")
            and staging_env.get("vars", {}).get("GITHUB_REPO") == production_env.get("vars", {}).get("GITHUB_REPO")):
        problems.append("staging and production are the same worker reading the same repository: "
                        "they are not separated")

    return problems


def deploy_problems(config, name):
    """The problems that stop ONE environment from being deployed.

    These are not faults in the file: they are the things the operator must settle before the
    gateway may be published. A placeholder host is the obvious one. The deploy gate asks this
    question before it publishes anything.
    """
    problems = []
    env = config.get("environments", {}).get(name)
    if env is None:
        return ["there is no '%s' environment" % name]
    if not env.get("deployed"):
        problems.append("the '%s' environment is not a deployed environment" % name)
    for route in env.get("routes", []):
        if "REPLACE" in route.get("pattern", ""):
            problems.append("the host is still a placeholder: %r" % route.get("pattern"))
    if env.get("exposure") == "route" and not env.get("routes"):
        problems.append("the environment has a route exposure and no route")
    for key, value in env.get("vars", {}).items():
        if isinstance(value, str) and value.startswith("OWNER/"):
            problems.append("%s is still a placeholder: %s" % (key, value))
    return problems


def render_value(value):
    """A TOML value: a string, or a JSON array written as a string.

    A TOML basic string and a JSON string escape the same two characters, so a JSON text is
    escaped the same way a JSON encoder escapes it: every backslash becomes two, every quote
    becomes a backslash-quote. Getting this wrong is silent - the file still parses as TOML,
    it just carries a DENY_PATTERNS value that is not valid JSON, and the gateway then refuses
    to start. The check below makes that impossible.
    """
    if isinstance(value, list):
        text = json.dumps(value, separators=(",", ":"))
    else:
        text = str(value)
    return text.replace("\\", "\\\\").replace('"', '\\"')


def check_round_trip(config):
    """Every value that the Worker parses as JSON must survive the trip through TOML.

    DENY_PATTERNS and SIGNING_KEYS are JSON documents that the Worker parses at startup. A
    value that is mangled on the way into the file is a gateway that refuses to start, and a
    refusal at startup is easy to miss in a deployment. So the rendered value is parsed back
    and compared with the source.
    """
    problems = []
    for name, env in config.get("environments", {}).items():
        for key, value in env.get("vars", {}).items():
            if not isinstance(value, list):
                continue
            written = render_value(value)
            # Undo the TOML basic-string escaping the way a TOML parser would.
            text = written.replace('\\"', '"').replace("\\\\", "\\")
            try:
                parsed = json.loads(text)
            except ValueError as e:
                problems.append("%s: %s does not survive the trip through TOML as JSON: %s"
                                % (name, key, e))
                continue
            if parsed != value:
                problems.append("%s: %s does not survive the trip through TOML unchanged" % (name, key))
    return problems


def render_vars(vars_, indent="  "):
    lines = []
    for key in VAR_ORDER:
        if key not in vars_:
            continue
        lines.append('%s%s = "%s"' % (indent, key, render_value(vars_[key])))
    for key in sorted(vars_):
        if key in VAR_ORDER:
            continue
        lines.append('%s%s = "%s"' % (indent, key, render_value(vars_[key])))
    return lines


def render(config):
    environments = config["environments"]
    test = environments["test"]
    out = [HEADER]
    out.append("name = \"%s\"" % test["worker_name"])
    out.append("main = \"src/index.ts\"")
    out.append("")
    out.append("# Pin deliberately and bump on purpose; do not float.")
    out.append("compatibility_date = \"2025-09-01\"")
    out.append("")
    out.append("# The gateway's state: the revocation set, the audit trail and the rate-limit counters.")
    out.append("# A Durable Object is used rather than KV because revocation must take effect")
    out.append("# immediately: a capability that is revoked must stop working at once, not up to a")
    out.append("# cache TTL later.")
    out.append("[[durable_objects.bindings]]")
    out.append('name = "STATE"')
    out.append('class_name = "GatewayState"')
    out.append("")
    out.append("[[migrations]]")
    out.append('tag = "v1"')
    out.append('new_sqlite_classes = ["GatewayState"]')
    out.append("")
    out.append("# ---------------------------------------------------------------------------\n"
               "# Non-secret configuration. Everything here is safe to read, but the values that\n"
               "# describe the policy are ALSO reported on /healthz, so that a verifier can test the\n"
               "# gateway as it is actually configured.\n"
               "# ---------------------------------------------------------------------------\n")
    out.append("[vars]")
    out.extend(render_vars(test["vars"]))
    out.append("")
    out.append("# routes / workers_dev are intentionally unset in the test environment: it is never")
    out.append("# deployed. The deployed environments are below.")
    out.append("")

    for name in ("staging", "production"):
        env = environments[name]
        out.append("# ---------------------------------------------------------------------------")
        out.append("# %s environment: %s" % (name.upper(), env["label"]))
        out.append("#")
        for note in env.get("notes", []):
            out.append("# %s" % note)
        out.append("#")
        out.append("# Secrets for this environment (set once, per environment, never in this file):")
        for secret in env["secrets"]:
            out.append("#   wrangler secret put --env %s %s" % (name, secret))
        out.append("# ---------------------------------------------------------------------------")
        out.append("[env.%s]" % name)
        out.append('name = "%s"' % env["worker_name"])
        out.append("")
        if env.get("exposure") == "workers_dev":
            out.append("# Staging is reachable on workers.dev, so that a pilot agent can reach it")
            out.append("# without a domain. It is a disposable environment and it holds no real content.")
            out.append("workers_dev = true")
        else:
            out.append("# Production is NOT exposed on workers.dev. It is reachable on one named")
            out.append("# host only, and that host is part of the work-order contract")
            out.append("# (docs/decisions/0002).")
            out.append("workers_dev = false")
        out.append("")
        out.append("[[env.%s.durable_objects.bindings]]" % name)
        out.append('name = "STATE"')
        out.append('class_name = "GatewayState"')
        out.append("")
        out.append("[[env.%s.migrations]]" % name)
        out.append('tag = "v1"')
        out.append('new_sqlite_classes = ["GatewayState"]')
        out.append("")
        for route in env.get("routes", []):
            out.append("[[env.%s.routes]]" % name)
            out.append('pattern = "%s"' % route["pattern"])
            if route.get("custom_domain"):
                out.append("custom_domain = true")
            out.append("")
        out.append("[env.%s.vars]" % name)
        out.extend(render_vars(env["vars"], indent="  "))
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def main(argv):
    args = argv[1:]
    check = "--check" in args
    deployable = None
    for index, arg in enumerate(args):
        if arg == "--assert-deployable":
            deployable = args[index + 1] if index + 1 < len(args) else ""
            if not deployable:
                print("--assert-deployable needs an environment name", file=sys.stderr)
                return 1
    config = load()

    problems = validate(config)
    problems.extend(check_round_trip(config))
    if problems:
        for problem in problems:
            print("configuration is invalid: %s" % problem, file=sys.stderr)
        print("refusing to render: fix ops/environments.json", file=sys.stderr)
        return 1

    rendered = render(config)

    if deployable is not None:
        blockers = deploy_problems(config, deployable)
        if blockers:
            for blocker in blockers:
                print("the '%s' environment is not ready to deploy: %s" % (deployable, blocker),
                      file=sys.stderr)
            return 1
        print("the '%s' environment is ready to deploy." % deployable)
        return 0

    if check:
        if not TARGET.exists():
            print("wrangler.toml does not exist; run 'python3 ops/render-environments.py'", file=sys.stderr)
            return 1
        current = TARGET.read_text(encoding="utf-8")
        if current != rendered:
            print("wrangler.toml is out of date with ops/environments.json.", file=sys.stderr)
            print("run 'python3 ops/render-environments.py' and commit the result.", file=sys.stderr)
            return 1
        print("wrangler.toml matches ops/environments.json, and the configuration is valid.")
        return 0

    TARGET.write_text(rendered, encoding="utf-8")
    print("wrote %s" % TARGET)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
