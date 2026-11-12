#!/usr/bin/env python3
"""check-production.py: may the write gateway be published to production, and did it publish as configured?

The production counterpart of check-staging-separation.py. Two modes:

  --static (the default)
      The committed wrangler.toml is checked for the things that make a production deployment
      refuse to start or point somewhere nobody chose: a placeholder submissions repository,
      the wrong environment name, no key ids, a key id shared with staging, a destination
      shared with staging, and the workers_dev posture the contract requires (protocol
      section 12.5). It is NOT run by CI, because the placeholders are expected to be there
      until the operator names the production destination; it is run by the deploy and
      production-init workflows, where a placeholder must stop the run.

  --base-url URL
      A published production gateway is asked what it is (/healthz) and the answer is compared
      with the configuration: environment, exactly the declared key ids, no staging key id,
      the configured repository and branch, the conformance clock off, and the protocol.

Usage:
    python3 gateway/write/scripts/check-production.py
    python3 gateway/write/scripts/check-production.py --base-url https://<production host>

Exit: 0 if every check passes, 1 otherwise.
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
CONFIG = os.path.join(os.path.dirname(HERE), "wrangler.toml")
PLACEHOLDERS = ("OWNER/REPO", "REPLACE")

FAILURES = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


def key_ids(value):
    return {part.strip() for part in (value or "").split(",") if part.strip()}


def is_placeholder(value):
    return (not value) or any(p in value for p in PLACEHOLDERS)


def check_static(config):
    print("1. the production configuration is deployable")
    vars_ = config.get("vars", {})
    check(vars_.get("DEPLOY_ENV") == "production", "DEPLOY_ENV is production")
    check(config.get("name") == "ctxgate-write",
          "the production Worker is named ctxgate-write, so its host is ctxgate-write.<subdomain>.workers.dev "
          "(ADR 0012); the name is the host")
    check(not is_placeholder(vars_.get("SUBMISSIONS_REPO")),
          "the production submissions repository is named (not a placeholder)")
    check(bool(vars_.get("SUBMISSIONS_BRANCH")), "the production submissions branch is named")
    check(bool(key_ids(vars_.get("SIGNING_KEY_IDS"))), "the production key ids are declared")
    check("workers_dev" in config and config.get("workers_dev") is True,
          "workers_dev is a top-level setting and is true: the operator chose workers.dev for "
          "production as well as staging (ADR 0008, decision 2)")
    check("workers_dev" not in vars_, "workers_dev is not an ordinary variable (F0-070)")
    check("PRODUCTION_SUBMISSIONS_REPO" not in vars_, "production does not declare the staging guard")

    print("2. production is separate from staging")
    staging = config.get("env", {}).get("staging", {})
    staging_vars = staging.get("vars", {})
    check(staging.get("name") and staging.get("name") != config.get("name"),
          "staging is a different Worker from production")
    shared = key_ids(vars_.get("SIGNING_KEY_IDS")) & key_ids(staging_vars.get("SIGNING_KEY_IDS"))
    check(not shared, "production and staging share no key id (shared: %s)" % ", ".join(sorted(shared)))
    check(vars_.get("SUBMISSIONS_REPO") != staging_vars.get("SUBMISSIONS_REPO")
          or vars_.get("SUBMISSIONS_BRANCH") != staging_vars.get("SUBMISSIONS_BRANCH"),
          "production does not write to the staging destination")


def check_live(base_url, config):
    base = base_url.rstrip("/")
    try:
        # Cloudflare's managed rules refuse Python's default User-Agent with error 1010 (F0-073).
        request = urllib.request.Request(base + "/healthz", headers={"User-Agent": "ctxgate-check/prod"})
        with urllib.request.urlopen(request, timeout=20) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as e:
        check(False, "the health endpoint answered %s" % e.code)
        return
    except urllib.error.URLError:
        check(False, "the health endpoint could not be reached")
        return
    if status != 200:
        check(False, "the health endpoint answered %s" % status)
        return
    try:
        health = json.loads(body.decode("utf-8"))
    except ValueError:
        check(False, "the health endpoint did not answer JSON")
        return

    print("3. the published gateway is the production one that was configured")
    vars_ = config.get("vars", {})
    staging_vars = config.get("env", {}).get("staging", {}).get("vars", {})
    policy = health.get("policy", {})
    served = set(policy.get("key_ids", []))
    check(health.get("deploy_env") == "production", "the published gateway says it is production")
    check(served == key_ids(vars_.get("SIGNING_KEY_IDS")), "it serves exactly the declared key ids")
    check(not (served & key_ids(staging_vars.get("SIGNING_KEY_IDS"))), "it serves no staging key id")
    check(policy.get("submissions_repo") == vars_.get("SUBMISSIONS_REPO"),
          "it writes to the configured repository")
    check(policy.get("submissions_branch") == vars_.get("SUBMISSIONS_BRANCH"),
          "it writes to the configured branch")
    check(health.get("conformance_clock") is False, "the conformance test clock is off")
    check(health.get("protocol") == "ctxwrite-v1", "it speaks ctxwrite-v1")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", help="the published production gateway to check, as well as the static checks")
    args = parser.parse_args(argv)
    try:
        with open(CONFIG, "rb") as handle:
            config = tomllib.load(handle)
    except (OSError, ValueError) as e:
        print("could not read %s: %s" % (CONFIG, e), file=sys.stderr)
        return 1
    check_static(config)
    if args.base_url:
        check_live(args.base_url, config)
    print()
    if FAILURES:
        print("production check: FAILED (%d)" % len(FAILURES))
        for failure in FAILURES:
            print("  - %s" % failure)
        return 1
    print("production check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
