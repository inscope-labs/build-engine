#!/usr/bin/env python3
"""check-staging-separation.py — check that the write gateway's staging environment is separate.

Stage 6.1 (plan task 6.1.2 and 6.1.3) establishes a disposable staging environment for the write
gateway. "Staging" is only worth anything if it cannot be mistaken for production, and that is a
property of the configuration, not a matter of care. This script checks that property, and it
checks it against the file that will actually be deployed.

Two modes:

  - **static** (the default, and what CI runs): the committed `wrangler.toml` is checked. It
    proves that the staging environment is a different Worker with different keys and a different
    destination, that it cannot be pointed at the production submissions repository, and that the
    deployment defaults the contract requires are actually settings and not variables.

  - **live** (`--base-url`): a published gateway is asked what it is, and the answer is compared
    with the configuration. A deployment that succeeds is not a deployment that is correct: the
    gateway that answers may be serving the production keys from a file that says staging.

What it checks, and why:

  1. `workers_dev` is a setting, not a variable. A `workers_dev = false` written after the
     `[vars]` table becomes an ordinary variable, the setting stays unset, and wrangler's default
     exposes the gateway on a public `*.workers.dev` URL. This was F0-070.
  2. production is not exposed on workers.dev (protocol section 12.5).
  3. staging and production are different Workers, so their Durable Object namespaces are
     different: a revocation in one is not a revocation in the other.
  4. their key ids are disjoint, so a capability minted for one is refused by the other.
  5. their destinations are different, so a staging submission is not a production submission.
  6. staging declares the production destination and refuses to be pointed at it (protocol
     section 12.5): the gateway itself fails closed, and this script keeps the declaration true.
  7. staging has its own Durable Object bindings and its own migrations.

Usage:
    python3 gateway/write/scripts/check-staging-separation.py
    python3 gateway/write/scripts/check-staging-separation.py --base-url https://<staging host>

Exit:  0 if every check passes, 1 otherwise.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    print("this script needs Python 3.11 or later (tomllib)", file=sys.stderr)
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
WRITE = os.path.dirname(HERE)
CONFIG = os.path.join(WRITE, "wrangler.toml")

FAILURES = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


def load():
    with open(CONFIG, "rb") as handle:
        return tomllib.load(handle)


def key_ids(value):
    return {part.strip() for part in (value or "").split(",") if part.strip()}


def check_static(config):
    """The committed configuration. This is the file that will be published."""
    print("1. the deployment defaults are settings, not variables")
    root = config
    check("workers_dev" in root, "workers_dev is set at the top level of wrangler.toml")
    check(root.get("workers_dev") is False, "production is not exposed on workers.dev")
    check("workers_dev" not in root.get("vars", {}),
          "workers_dev is not an ordinary variable (F0-070: that setting did nothing)")

    print("2. the production environment")
    production_vars = root.get("vars", {})
    check(production_vars.get("DEPLOY_ENV") == "production",
          "the production deployment says DEPLOY_ENV=production")
    check("PRODUCTION_SUBMISSIONS_REPO" not in production_vars,
          "the production deployment does not declare the staging guard")
    check(key_ids(production_vars.get("SIGNING_KEY_IDS")),
          "the production deployment declares its key ids")

    print("3. the staging environment")
    staging = config.get("env", {}).get("staging")
    if staging is None:
        check(False, "there is a staging environment")
        return None
    staging_vars = staging.get("vars", {})

    check(staging.get("name") != root.get("name"),
          "staging is a different Worker, so its Durable Object namespaces are its own")
    check(staging.get("workers_dev") is True,
          "staging is reachable on workers.dev, so the pilot needs no domain")
    check("routes" not in staging, "staging claims no route of its own")

    bindings = {b.get("name") for b in staging.get("durable_objects", {}).get("bindings", [])}
    check({"TASK_SESSION", "AUDIT_STREAM"} <= bindings,
          "staging has its own Durable Object bindings")
    migrations = staging.get("migrations", [])
    check(bool(migrations) and "TaskSession" in migrations[0].get("new_sqlite_classes", []),
          "staging has its own Durable Object migrations")

    print("4. the key ids are disjoint")
    production_keys = key_ids(production_vars.get("SIGNING_KEY_IDS"))
    staging_keys = key_ids(staging_vars.get("SIGNING_KEY_IDS"))
    check(staging_keys and production_keys, "both deployments declare their key ids")
    check(not (staging_keys & production_keys),
          "staging and production share no key id (shared: %s)" % ", ".join(sorted(staging_keys & production_keys)))

    print("5. the destinations are different")
    check(staging_vars.get("SUBMISSIONS_REPO") != production_vars.get("SUBMISSIONS_REPO"),
          "staging writes to a different repository than production")
    check(staging_vars.get("SUBMISSIONS_BRANCH") != production_vars.get("SUBMISSIONS_BRANCH"),
          "staging writes to a different branch than production")
    check(staging_vars.get("SUBMISSIONS_FOLDER_TEMPLATE") == production_vars.get("SUBMISSIONS_FOLDER_TEMPLATE"),
          "both deployments use the same task folder template")

    print("6. staging cannot be pointed at production")
    check(staging_vars.get("DEPLOY_ENV") == "staging", "the staging deployment says DEPLOY_ENV=staging")
    guard = staging_vars.get("PRODUCTION_SUBMISSIONS_REPO")
    check(bool(guard), "the staging deployment declares the production submissions repository")
    check(guard == production_vars.get("SUBMISSIONS_REPO"),
          "the declared production repository is the one production actually writes to")
    check(staging_vars.get("SUBMISSIONS_REPO") != guard,
          "the staging destination is not the production repository")

    return staging


def check_live(base_url, config):
    """A published gateway, asked what it is."""
    base = base_url.rstrip("/")
    try:
        with urllib.request.urlopen(base + "/healthz", timeout=20) as response:
            status = response.status
            body = response.read()
    except urllib.error.HTTPError as e:
        print("  FAIL the health endpoint answered %s" % e.code)
        FAILURES.append("the health endpoint answered %s" % e.code)
        return
    except urllib.error.URLError:
        print("  FAIL the health endpoint could not be reached")
        FAILURES.append("the health endpoint could not be reached")
        return
    if status != 200:
        check(False, "the health endpoint answered %s" % status)
        return
    health = json.loads(body.decode("utf-8"))

    print("7. the published gateway is the one that was configured")
    staging = config.get("env", {}).get("staging", {})
    staging_vars = staging.get("vars", {})
    policy = health.get("policy", {})

    check(health.get("deploy_env") == staging_vars.get("DEPLOY_ENV"),
          "the published gateway reports the environment it was configured for")
    check(sorted(policy.get("key_ids", [])) == sorted(key_ids(staging_vars.get("SIGNING_KEY_IDS"))),
          "the published gateway serves exactly the declared key ids")
    check(policy.get("submissions_repo") == staging_vars.get("SUBMISSIONS_REPO"),
          "the published gateway writes to the configured repository")
    check(policy.get("submissions_branch") == staging_vars.get("SUBMISSIONS_BRANCH"),
          "the published gateway writes to the configured branch")
    check(health.get("conformance_clock") is False,
          "the conformance test clock is off in a published gateway")
    check(health.get("protocol") == "ctxwrite-v1", "the published gateway speaks ctxwrite-v1")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", help="the published gateway to check, if it has been published")
    args = parser.parse_args(argv)

    try:
        config = load()
    except (OSError, ValueError) as e:
        print("could not read %s: %s" % (CONFIG, e), file=sys.stderr)
        return 1

    check_static(config)
    if args.base_url:
        check_live(args.base_url, config)

    print("")
    if FAILURES:
        print("FAILED: %d check(s)" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("OK: the staging environment is separate from production")
    return 0


if __name__ == "__main__":
    sys.exit(main())
