#!/usr/bin/env python3
"""ops/verify-write-credential-scope.py: what the production write credential can reach.

The S5 entry gate (rollout plan; ADR 0014) asks for two things that a statement cannot settle:
the write gateway's credential reaches the submissions repository only, and the gateway has no
access to the consumer repository. This asks GitHub, with the credential itself, which
repositories it can reach, and fails closed.

It runs inside the `verify-write-credential-scope` workflow, in the `production` environment,
with `WRITE_GH_TOKEN` in the environment. The token is read from the environment only (never an
argument) and is never printed. The output names the expected repository and the consumer
repository and gives counts for everything else: a log can be read by more people than the
credential's owner, and the name of an unrelated private repository is not the check's to publish.

A credential PASSES when, in the list of repositories it can reach:
  1. the expected submissions repository is present and the credential can push to it;
  2. the consumer repository is absent, or present without push, maintain or admin rights;
  3. no other repository grants push, maintain or admin rights;
  4. no repository other than the expected one is private.

What it cannot tell: whether the token is limited to one *branch*. The provider client reaches
one repository and one branch (gateway/write/scripts/check-token-scope.ts, static half), and a
GitHub token is repository-scoped, not branch-scoped (protocol section 12.4).

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
WRANGLER = Path(__file__).resolve().parent.parent / "gateway" / "write" / "wrangler.toml"


def expected_repository() -> str:
    """The production submissions repository, from the write gateway's own configuration."""
    with open(WRANGLER, "rb") as handle:
        config = tomllib.load(handle)
    return str(config["vars"]["SUBMISSIONS_REPO"])


def can_write(repo: dict) -> bool:
    permissions = repo.get("permissions") or {}
    return any(bool(permissions.get(key)) for key in ("push", "maintain", "admin"))


def evaluate(repos: list[dict], expected: str, consumer: str) -> tuple[list[str], dict]:
    """Return (problems, evidence). No problems means the credential passes."""
    by_name = {str(repo.get("full_name", "")).lower(): repo for repo in repos}
    problems: list[str] = []

    target = by_name.get(expected.lower())
    if target is None:
        problems.append("the submissions repository is not in the credential's repository list")
    elif not (target.get("permissions") or {}).get("push"):
        problems.append("the credential cannot push to the submissions repository")

    other = [repo for name, repo in by_name.items() if name != expected.lower()]
    consumer_entry = by_name.get(consumer.lower())
    if consumer_entry is not None and can_write(consumer_entry):
        problems.append("the credential has write rights on the consumer repository")
    writable_others = [repo for repo in other if can_write(repo)]
    if writable_others:
        problems.append(f"{len(writable_others)} other repository(ies) grant write rights")
    private_others = [repo for repo in other if repo.get("private")]
    if private_others:
        problems.append(f"{len(private_others)} other private repository(ies) are reachable")

    evidence = {
        "repositories_listed": len(by_name),
        "submissions_repository_listed": target is not None,
        "submissions_repository_push": bool(target and (target.get("permissions") or {}).get("push")),
        "consumer_listed": consumer_entry is not None,
        "consumer_write": bool(consumer_entry and can_write(consumer_entry)),
        "other_writable": len(writable_others),
        "other_private": len(private_others),
    }
    return problems, evidence


def list_repositories(token: str) -> list[dict]:
    repos: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        url = f"{API}/user/repos?per_page=100&page={page}&affiliation=owner,collaborator,organization_member"
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "build-engine-verify-write-credential-scope",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list):
            raise ValueError("unexpected response shape")
        repos.extend(batch)
        if len(batch) < 100:
            return repos
    raise ValueError("more than the page limit of repositories: refusing to judge a partial list")


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
    except urllib.error.HTTPError as error:
        print(f"GitHub answered HTTP {error.code}: the credential could not be checked")
        return 2
    except (urllib.error.URLError, ValueError, KeyError, OSError) as error:
        print(f"the check could not run ({type(error).__name__})")
        return 2

    problems, evidence = evaluate(repos, expected, args.consumer)
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
