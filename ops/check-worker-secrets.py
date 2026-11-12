#!/usr/bin/env python3
"""check-worker-secrets.py — do the deployed Workers hold the secret NAMES they must?

The gateway's contract says which secrets each deployment holds (`SIGNING_KEYS`,
`OPERATOR_TOKEN`, `GITHUB_TOKEN`). Whether they are *there* is a fact about a deployed Worker,
and the only way to read it is the Cloudflare API — with a credential the agent deliberately does
not hold (ADR 0013 item 4).

This is that check, as a standalone command, so that:

  - the operator can run it on their own machine, where the credential is, and paste the result;
  - a workflow can run it inside the `production` environment, where the credential is held by
    name, under the operator's approval — and the run's conclusion becomes the evidence the
    gate reads;
  - the gate's own check and the workflow's step are the **same code**, so they cannot drift.

**Only names are read, and only names are printed.** The Cloudflare API never returns a secret's
value, and nothing here asks it to.

Usage:
    python3 ops/check-worker-secrets.py --worker ctxgate-write \\
        --expect SIGNING_KEYS OPERATOR_TOKEN GITHUB_TOKEN

Environment:
    CLOUDFLARE_ACCOUNT_ID   the account the Workers live in. Required.
    CLOUDFLARE_API_TOKEN    a token with Account > Workers Scripts > Read. Required.

Exit: 0 when every expected name is present, 1 when one is missing, 2 when the check could not
be carried out at all (no credential, or the API refused).
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://api.cloudflare.com/client/v4"


def api_error(body):
    """What Cloudflare said, without any part of the token."""
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return ""
    errors = payload.get("errors") if isinstance(payload, dict) else None
    if not errors:
        return ""
    codes = []
    for error in errors:
        if isinstance(error, dict):
            code = str(error.get("code", "")).strip()
            codes.append(code if code else "unknown")
    return ",".join(codes)


def fetch_secret_names(account, token, worker, base):
    """The secret names the Worker holds. Raises on anything that is not a list."""
    url = "%s/accounts/%s/workers/scripts/%s/secrets" % (base.rstrip("/"), account, worker)
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer %s" % token,
        # Cloudflare's managed rules refuse Python's default User-Agent with error 1010.
        "User-Agent": "ctxgate-check/6.1",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError("the API answered success=false (%s)" % (api_error(json.dumps(payload)) or "no code"))
    return [item.get("name") for item in payload.get("result") or []]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--worker", required=True, help="the Worker to ask")
    parser.add_argument("--expect", nargs="+", required=True, help="the secret names it must hold")
    parser.add_argument("--base-url", default=os.environ.get("CLOUDFLARE_API_BASE", DEFAULT_BASE),
                        help="the API's base URL (the environment variable, for a test double)")
    args = parser.parse_args(argv)

    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not account or not token:
        print("no Cloudflare credential in the environment (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)")
        return 2

    try:
        names = fetch_secret_names(account, token, args.worker, args.base_url)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        code = api_error(body)
        print("the Cloudflare API refused the secret list of the Worker '%s' (HTTP %d%s): "
              "the token may lack the Workers Scripts Read permission, or the account id may be wrong"
              % (args.worker, e.code, (", code %s" % code) if code else ""))
        return 2
    except urllib.error.URLError as e:
        print("the Cloudflare API could not be reached: %s" % e.reason)
        return 2
    except (RuntimeError, ValueError) as e:
        print("the secret list of the Worker '%s' could not be read: %s" % (args.worker, e))
        return 2

    missing = [name for name in args.expect if name not in names]
    print("the Worker '%s' holds %d secret name(s): %s"
          % (args.worker, len(names), ", ".join(sorted(n for n in names if n))))
    if missing:
        print("MISSING: %s" % ", ".join(missing))
        return 1
    print("OK: the Worker '%s' holds every expected secret name (%s)"
          % (args.worker, ", ".join(args.expect)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
