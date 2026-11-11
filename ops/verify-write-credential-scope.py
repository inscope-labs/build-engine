#!/usr/bin/env python3
"""ops/verify-write-credential-scope.py: what the production write credential can write to.

The S5 entry gate (rollout plan; ADR 0014) asks for two things that a statement cannot settle:
the write gateway's credential can write to the submissions repository, and it can write to no
other repository, the consumer repository above all. This tests it with the credential itself.

**How write access is tested.** GitHub's per-repository `permissions` field is not evidence: it
reports the account's role, not the token's rights (a token limited to one repository still saw
every public repository as writable). So the check asks GitHub to do something the credential
could only do with write rights, and gives it a request that cannot succeed:

    POST /repos/OWNER/REPO/git/refs   {"ref": "refs/probe", "sha": "000...0"}

The reference name is malformed and the commit does not exist, so the request creates nothing
whatever the answer is. GitHub checks the credential before it reads the body:

    422 or 409   the credential is allowed to write here (it got as far as validating the request)
    401/403/404  the credential is not allowed to write here
    anything else  the check cannot tell, and says so (exit 2)

Repositories probed: the submissions repository, the consumer repository, and every repository the
credential can list. The credential PASSES when:
  1. it can write to the submissions repository;
  2. it cannot write to the consumer repository;
  3. it cannot write to any other repository it can list;
  4. no repository other than the submissions repository is private (a private repository is only
     visible to a token that was given it on purpose).

It runs inside the `verify-write-credential-scope` workflow, in the `production` environment, with
`WRITE_GH_TOKEN` in the environment. The token is read from the environment only (never an
argument) and is never printed. The output names the submissions and consumer repositories and
gives counts for everything else: the name of an unrelated repository is not the check's to publish.

What it cannot tell: whether the token is limited to one *branch*. A GitHub token is
repository-scoped, not branch-scoped (protocol section 12.4); the provider client reaches one branch
(gateway/write/scripts/check-token-scope.ts, static half).

    WRITE_GH_TOKEN=... python3 ops/verify-write-credential-scope.py --consumer OWNER/REPO

Exit:  0 pass, 1 the credential reaches too much or too little, 2 the check could not run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
MAX_PAGES = 10
MAX_PROBES = 200
WRANGLER = Path(__file__).resolve().parent.parent / "gateway" / "write" / "wrangler.toml"

# The probe body. Both fields are invalid on purpose: no answer to this request can create a ref.
PROBE_BODY = {"ref": "refs/probe", "sha": "0" * 40}
WRITABLE = frozenset({422, 409})
NOT_WRITABLE = frozenset({401, 403, 404})


def expected_repository() -> str:
    """The production submissions repository, from the write gateway's own configuration."""
    with open(WRANGLER, "rb") as handle:
        config = tomllib.load(handle)
    return str(config["vars"]["SUBMISSIONS_REPO"])


def classify(status: int) -> bool:
    """True if the credential can write, False if it cannot. Anything else is not an answer."""
    if status in WRITABLE:
        return True
    if status in NOT_WRITABLE:
        return False
    raise ValueError(f"unexpected HTTP status {status} from the write probe")


def evaluate(repos: list[dict], expected: str, consumer: str, probes: dict[str, int]) -> tuple[list[str], dict]:
    """Return (problems, evidence). `probes` maps a lower-case full name to the probe's HTTP status."""
    expected_key, consumer_key = expected.lower(), consumer.lower()
    listed = {str(repo.get("full_name", "")).lower(): repo for repo in repos}
    problems: list[str] = []

    target_writable = classify(probes[expected_key])
    if not target_writable:
        problems.append("the credential cannot write to the submissions repository")

    consumer_writable = classify(probes[consumer_key])
    if consumer_writable:
        problems.append("the credential can write to the consumer repository")

    others = [name for name in listed if name not in (expected_key, consumer_key)]
    writable_others = [name for name in others if classify(probes[name])]
    if writable_others:
        problems.append(f"{len(writable_others)} other repository(ies) accept writes")
    private_others = [name for name in listed if name != expected_key and listed[name].get("private")]
    if private_others:
        problems.append(f"{len(private_others)} other private repository(ies) are reachable")

    evidence = {
        "repositories_listed": len(listed),
        "submissions_repository_listed": expected_key in listed,
        "submissions_repository_writable": target_writable,
        "consumer_listed": consumer_key in listed,
        "consumer_writable": consumer_writable,
        "other_repositories_probed": len(others),
        "other_writable": len(writable_others),
        "other_private": len(private_others),
    }
    return problems, evidence


def _request(token: str, method: str, url: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "build-engine-verify-write-credential-scope",
            **({"Content-Type": "application/json"} if data else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def list_repositories(token: str) -> list[dict]:
    repos: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        url = f"{API}/user/repos?per_page=100&page={page}&affiliation=owner,collaborator,organization_member"
        status, batch = _request(token, "GET", url)
        if status != 200 or not isinstance(batch, list):
            raise ValueError(f"listing the credential's repositories answered HTTP {status}")
        repos.extend(batch)
        if len(batch) < 100:
            return repos
    raise ValueError("more than the page limit of repositories: refusing to judge a partial list")


def probe(token: str, full_name: str) -> int:
    status, _ = _request(token, "POST", f"{API}/repos/{full_name}/git/refs", PROBE_BODY)
    if status == 201:
        raise ValueError("the write probe created a reference: stop, this should be impossible")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--consumer", required=True, help="the consumer repository, OWNER/REPO")
    parser.add_argument("--expected", help="the submissions repository; default: the write gateway's configuration")
    args = parser.parse_args()

    token = os.environ.get("WRITE_GH_TOKEN", "")
    if not token:
        print("WRITE_GH_TOKEN is not set: nothing was checked")
        return 2
    try:
        expected = args.expected or expected_repository()
        repos = list_repositories(token)
        names = {expected.lower(), args.consumer.lower()} | {str(r.get("full_name", "")).lower() for r in repos}
        if len(names) > MAX_PROBES:
            raise ValueError("too many repositories to probe")
        probes = {name: probe(token, name) for name in sorted(names)}
        problems, evidence = evaluate(repos, expected, args.consumer, probes)
    except (urllib.error.URLError, ValueError, KeyError, OSError) as error:
        print(f"the check could not run ({type(error).__name__}: {error})")
        return 2

    lines = [
        "## Write credential scope",
        "",
        f"- submissions repository (from the gateway configuration): `{expected}`",
        f"- consumer repository: `{args.consumer}`",
        *[f"- {key}: {value}" for key, value in evidence.items()],
        "",
        "**Result: FAIL**" if problems else "**Result: PASS**",
        *[f"- {problem}" for problem in problems],
    ]
    text = "\n".join(lines)
    print(text)
    out = os.environ.get("OUT_FILE")
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
