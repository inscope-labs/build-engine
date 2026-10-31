#!/usr/bin/env python3
"""Check a published gateway against the configuration it was supposed to be published with.

A deployment that succeeds is not a deployment that is correct. This asks the running gateway
what it is, and compares the answer with ops/environments.json:

  - the version, the scheme, the effective limits and the key ids are the ones that were
    configured, not the ones that were intended;
  - the clock-skew tolerance and the maximum lifetime are within the operator's ceilings;
  - the conformance test clock is OFF. With it on, a caller carrying X-Conformance-Now can
    extend the life of an expired link, and that is not a thing a published gateway may do;
  - the health endpoint discloses nothing it should not: no repository, no allow prefix, no
    deny pattern, no secret;
  - the operator channel refuses an unauthenticated caller;
  - a link that was not signed is refused.

    python3 ops/verify-deployment.py --env staging --base-url https://...

Not shipped in releases: it is operator tooling.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCTION = HERE.parent
REPO = PRODUCTION.parents[2]
SOURCE = HERE / "environments.json"

MAX_TTL_CEILING = 259200
CLOCK_SKEW_CEILING = 120


def get(url, headers=None, timeout=20):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, help="the environment to check")
    parser.add_argument("--base-url", required=True, help="the public URL of the gateway")
    args = parser.parse_args(argv)

    config = json.loads(SOURCE.read_text(encoding="utf-8"))
    env = config["environments"].get(args.env)
    if env is None:
        print("there is no '%s' environment" % args.env, file=sys.stderr)
        return 1
    declared = env["vars"]
    base = args.base_url.rstrip("/")

    failures = []

    status, body, _ = get(base + "/healthz")
    if status != 200:
        print("the health endpoint answered %s" % status, file=sys.stderr)
        return 1
    health = json.loads(body.decode("utf-8"))

    def check(name, actual, expected):
        if actual != expected:
            failures.append("%s is %r, expected %r" % (name, actual, expected))

    check("status", health.get("status"), "ok")
    check("scheme", health.get("scheme"), "ctxgate-v1")
    check("version", health.get("version"), (REPO / "VERSION").read_text(encoding="utf-8").strip())
    check("key_ids", sorted(health.get("key_ids", [])), sorted(env["key_ids"]))
    check("max_ttl", health.get("max_ttl"), int(declared["MAX_TTL"]))
    check("max_bytes", health.get("max_bytes"), int(declared["MAX_BYTES"]))
    check("clock_skew_tolerance", health.get("clock_skew_tolerance"), int(declared["CLOCK_SKEW_TOLERANCE"]))

    if health.get("max_ttl", 0) > MAX_TTL_CEILING:
        failures.append("max_ttl is above the approved ceiling of %d" % MAX_TTL_CEILING)
    if health.get("clock_skew_tolerance", 0) > CLOCK_SKEW_CEILING:
        failures.append("clock_skew_tolerance is above the approved ceiling of %d" % CLOCK_SKEW_CEILING)

    # The test clock must be off in anything that is published.
    if health.get("conformance_clock"):
        failures.append("the conformance test clock is ON: a caller could extend the life of an "
                        "expired link with X-Conformance-Now")

    # The health endpoint must not disclose protected state.
    blob = json.dumps(health)
    for leak, what in ((declared["GITHUB_REPO"], "the repository"),
                        (declared["ALLOW_PREFIXES"], "the allow prefixes"),
                        (declared["DENY_PATTERNS"][0], "the deny patterns")):
        if leak and leak in blob:
            failures.append("the health endpoint discloses %s" % what)

    # The operator channel is closed without a credential.
    status, _, _ = get(base + "/admin/audit")
    if status != 401:
        failures.append("the admin channel answered %s without a credential" % status)

    # The link route refuses a link that was not signed.
    status, _, _ = get(base + "/v1/k1/0/10008-S001/" + "A" * 43 + "/" + "0" * 40 + "/amk/spec.md")
    if status != 403:
        failures.append("an unsigned link was answered with %s, expected 403" % status)

    for failure in failures:
        print("FAIL %s" % failure, file=sys.stderr)
    if failures:
        return 1
    print("the published %s gateway matches the configuration." % args.env)
    return 0


if __name__ == "__main__":
    sys.exit(main())
