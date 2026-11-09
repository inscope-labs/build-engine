#!/usr/bin/env python3
"""state-failure-probe.py - what the deployed read gateway answers.

The read gateway's state channel (the Durable Object that holds the revocation set, the audit
ring and the rate-limit counters) **fails closed**: a gateway that cannot read the revocation
list cannot know whether an order has been revoked, so it refuses the request with
`503 state-unavailable` rather than serving it. This was F0-030 and F0-031: the gateway used
to fail *open* here, serving a revoked capability and losing a revocation.

The two branches that must both fail closed:

  * the object **cannot be reached at all** - the fetch throws;
  * the object **answers with an error**, or with something that is not a decision.

Both are exercised by `gateway/read/production/test/unit/state-client.test.ts` against the
code. This script is the **deployed** half: it asks a gateway that is really published, over
real HTTPS, and it checks the answer it really gives.

What it expects depends on the state of the gateway it is pointed at:

  --expect 503   the state store cannot be read. Every request must be answered
                 `503 state-unavailable`, including a request that carries no signature at
                 all, because the budget check runs before the link is even parsed. **A 200 is
                 the fail-open this probe exists to catch.**
  --expect 403   the gateway is healthy. The same unsigned request must be refused with
                 `403`, and `/healthz` must answer `200` and report the key ids.

Two options matter when the failure has just been deployed:

  --wait N       wait up to N seconds for the expected answer. Cloudflare's default Durable
                 Object code-update strategy is `deferred`, with a maximum delay of 300
                 seconds, so an object that is already running keeps running the OLD code for
                 a while after the deploy. A failure planted in the object is therefore not
                 live the moment the deploy finishes, and a probe that asks straight away sees
                 a healthy store. This was F0-078: the first deployed proof asked too early,
                 saw a healthy store, and failed for a reason that had nothing to do with the
                 gateway.
  --check-admin  also ask the operator channel, which reaches the state store directly. When
                 the store itself is unreachable it answers `503 the state store could not be
                 reached`, which is the difference between "the gateway refused" and "there was
                 nothing to read". The operator token comes from the environment; it is never
                 printed.

Usage:
    python3 ops/state-failure-probe.py --base-url https://ctxgate-read-staging.qnuralink.workers.dev --expect 403
    python3 ops/state-failure-probe.py --base-url https://ctxgate-read-staging.qnuralink.workers.dev --expect 503 --wait 420 --check-admin

Exit:  0 if the gateway answered what it must, 1 otherwise. Nothing is printed but the
answers: no secret is read, and no capability is minted, because the probe never needs one.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Cloudflare's managed rules refuse Python's default User-Agent with error 1010 (F0-073).
USER_AGENT = "ctxgate-check/6.1"

# How often the probe asks again while it waits. The Durable Object's code update is
# deferred, so the answer can change from 403 to 503 without anything else happening.
POLL_SECONDS = 15

# A link-shaped path with a signature that is not a signature. The state check runs before
# the link is parsed, so this path is enough to see the state answer, and it carries nothing
# that could be a capability.
UNSIGNED_LINK = "/v1/s1/0/10008-S001/%s/%s/plans/pilot-001/package/brief.md" % ("A" * 43, "0" * 40)

# The operator channel's read-only route for one order. It reaches the state store directly,
# so it is the one route that says whether the store itself is there.
ADMIN_STATUS = "/admin/status?order=probe-order"

FAILURES: list[str] = []


def check(ok: bool, what: str) -> bool:
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILURES.append(what)
    return ok


def get(base: str, path: str) -> tuple[int, str]:
    url = base.rstrip("/") + path
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except urllib.error.URLError as e:
        return 0, str(e.reason)


def get_admin(base: str, path: str, token: str) -> tuple[int, str]:
    """The operator channel. The token is a header and is never printed."""
    url = base.rstrip("/") + path
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Authorization": "Bearer " + token}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except urllib.error.URLError as e:
        return 0, str(e.reason)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="the deployed gateway to ask")
    parser.add_argument("--expect", choices=["503", "403"], required=True,
                        help="503: the state store cannot be read; 403: the gateway is healthy")
    parser.add_argument("--wait", type=int, default=0, metavar="SECONDS",
                        help="wait up to this long for the expected answer (the Durable Object's "
                             "code update is deferred, so a planted failure is not live at once)")
    parser.add_argument("--check-admin", action="store_true",
                        help="also check that the operator channel reports the state store itself "
                             "unreachable (only meaningful with --expect 503)")
    args = parser.parse_args(argv)
    base = args.base_url.rstrip("/")

    print("== the deployed gateway at %s ==" % base)

    # The answer the gateway is expected to give. For 503 it is the fail-closed refusal; for
    # 403 it is the ordinary refusal of a request that carries no signature.
    expected_status = 503 if args.expect == "503" else 403

    deadline = time.time() + max(0, args.wait)
    attempts = 0
    while True:
        status, body = get(base, UNSIGNED_LINK)
        attempts += 1
        if status == expected_status or time.time() >= deadline:
            break
        print("   ... the gateway answered %d, not %d yet; the Durable Object's code update is "
              "deferred, so waiting" % (status, expected_status))
        time.sleep(POLL_SECONDS)

    print("   the unsigned request answered %d: %s" % (status, body.strip()[:80]))
    if attempts > 1:
        print("   (it took %d attempts)" % attempts)
    if args.expect == "503":
        check(status == 503, "the request is refused with 503, not served")
        check("state-unavailable" in body,
              "the refusal names state-unavailable (%s)" % (body.strip()[:60] or "no body"))
    else:
        check(status == 403, "the unsigned request is refused with 403 (%d)" % status)

    status, body = get(base, "/healthz")
    print("   /healthz answered %d" % status)
    if args.expect == "503":
        # The health endpoint does not consult the state channel, so it still answers. That is
        # how an operator tells "the state store is down" from "the gateway is down".
        check(status == 200, "/healthz still answers: the gateway is up and its state is not")
    else:
        check(status == 200, "/healthz answers 200")
        try:
            health = json.loads(body)
            check(health.get("status") == "ok", "the gateway reports itself ok")
            check(bool(health.get("key_ids")), "the gateway reports its key ids (%s)" % (health.get("key_ids"),))
        except ValueError:
            check(False, "/healthz answered with something that is not JSON")

    if args.check_admin and args.expect == "503":
        # The operator channel reaches the state store directly. It is the difference between
        # "the gateway refused" and "there was nothing to read".
        token = os.environ.get("CTXGATE_OPERATOR_TOKEN", "")
        if not token:
            check(False, "the operator token is not in the environment, so the store's own "
                         "health could not be checked")
        else:
            code, text = get_admin(base, ADMIN_STATUS, token)
            print("   the operator channel answered %d: %s" % (code, text.strip()[:80]))
            check(code == 503 and "could not be reached" in text,
                  "the operator channel reports the state store itself unreachable (%d)" % code)

    print("")
    if FAILURES:
        print("THE PROBE FAILED: %d check(s)" % len(FAILURES))
        for failure in FAILURES:
            print("  - %s" % failure)
        return 1
    print("THE PROBE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
