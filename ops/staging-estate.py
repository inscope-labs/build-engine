#!/usr/bin/env python3
"""ops/staging-estate.py: create, inspect and dispose of the disposable staging estate.

Stage 6.1 of RELEASE-PLAN.md establishes a *disposable staging environment*. This tool is the part
of that which touches the provider: it creates the throwaway branches the staging gateways read
from and write to, seeds them with the fixture content, reports what is there, and deletes them
again when the pilot is over.

It is deliberately an **operator tool**, not part of either gateway:

  - the credential comes from the environment (``GITHUB_TOKEN``), never from an argument, so it
    cannot end up in a shell history, a process listing or a log;
  - ``create`` and ``dispose`` refuse to run without an explicit confirmation, because they
    create and delete real branches on a real repository;
  - nothing is ever force-pushed over an existing branch: a branch that already exists is
    reported, not replaced;
  - it never merges, never publishes a release, and never touches a repository or a branch that
    is not named in the record.

The record is ops/staging-estate.json. It holds no secret.

    ops/staging-estate.py status
    ops/staging-estate.py create --i-understand-this-creates-real-branches
    ops/staging-estate.py seed
    ops/staging-estate.py dispose --i-understand-this-deletes-branches
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
DEFAULT_RECORD = os.path.join(HERE, "staging-estate.json")
CONFIRM_CREATE = "--i-understand-this-creates-real-branches"
CONFIRM_DISPOSE = "--i-understand-this-deletes-branches"


def fail(message, code=1):
    print("staging-estate: " + message, file=sys.stderr)
    sys.exit(code)


def token():
    """The credential, from the environment only."""
    value = os.environ.get("GITHUB_TOKEN", "")
    if not value:
        fail("GITHUB_TOKEN is not set; it must be a credential that can write to the disposable branches")
    return value


def api(method, path, body=None):
    """One call to the provider. The credential never appears in an error message."""
    url = "https://api.github.com" + path
    data = None
    headers = {
        "Authorization": "Bearer " + token(),
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "build-engine-staging-estate",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return e.code, parsed
    except urllib.error.URLError:
        fail("the provider could not be reached")


def load_record(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except OSError:
        fail("the record %s could not be read" % path)
    except ValueError:
        fail("the record %s is not valid JSON" % path)


def fixture_files(root):
    """Every file under a fixture directory, as {relative path: text}."""
    files = {}
    base = os.path.join(REPO_ROOT, root)
    for directory, _, names in os.walk(base):
        for name in sorted(names):
            if name == ".DS_Store":
                continue
            full = os.path.join(directory, name)
            relative = os.path.relpath(full, base).replace(os.sep, "/")
            with open(full, encoding="utf-8") as handle:
                files[relative] = handle.read()
    if not files:
        fail("the fixture directory %s is empty" % root)
    return files


def create_blob(repo, content):
    """A content-addressed blob. The content is sent as UTF-8, like the gateway's own client."""
    status, value = api("POST", "/repos/%s/git/blobs" % repo, {"content": content, "encoding": "utf-8"})
    if status != 201:
        fail("the provider answered %s when the blob was written to %s" % (status, repo))
    return value["sha"]


def create_tree(repo, entries):
    status, value = api("POST", "/repos/%s/git/trees" % repo, {"tree": entries})
    if status != 201:
        fail("the provider answered %s when the tree was written to %s" % (status, repo))
    return value["sha"]


def create_commit(repo, tree, parents, message):
    identity = {
        "name": "build-engine staging estate",
        "email": "staging-estate@users.noreply.github.com",
        "date": "2026-01-01T00:00:00Z",
    }
    status, value = api(
        "POST",
        "/repos/%s/git/commits" % repo,
        {"tree": tree, "parents": parents, "message": message, "author": identity, "committer": identity},
    )
    if status != 201:
        fail("the provider answered %s when the commit was written to %s" % (status, repo))
    return value["sha"]


def branch_head(repo, branch):
    """The sha a branch points at, or None when the branch does not exist."""
    status, value = api("GET", "/repos/%s/git/ref/heads/%s" % (repo, branch))
    if status == 200:
        return value["object"]["sha"]
    if status == 404:
        return None
    fail("the provider answered %s when the branch %s of %s was read" % (status, branch, repo))


def set_branch(repo, branch, sha):
    status, _ = api("POST", "/repos/%s/git/refs" % repo, {"ref": "refs/heads/" + branch, "sha": sha})
    if status != 201:
        fail("the provider answered %s when the branch %s was created in %s" % (status, branch, repo))


def push_tree(repo, branch, files, message, orphan=False):
    """Write a set of files into a branch. Never overwrites an existing branch."""
    entries = []
    for path in sorted(files):
        entries.append(
            {"path": path, "mode": "100644", "type": "blob", "sha": create_blob(repo, files[path])}
        )
    tree = create_tree(repo, entries)
    head = branch_head(repo, branch)
    parents = [] if orphan else ([head] if head else [])
    commit = create_commit(repo, tree, parents, message)
    if head is None:
        set_branch(repo, branch, commit)
    else:
        status, _ = api("PATCH", "/repos/%s/git/refs/heads/%s" % (repo, branch), {"sha": commit, "force": False})
        if status != 200:
            fail("the provider answered %s when %s was moved in %s" % (status, branch, repo))
    return commit


def repo_exists(repo):
    status, _ = api("GET", "/repos/" + repo)
    return status == 200


def command_status(record):
    """What exists. This is the evidence a closeout quotes."""
    repo = record["topology"]["repository"]
    print("repository: %s (%s)" % (repo, "present" if repo_exists(repo) else "NOT REACHABLE"))
    for role in ("read_gateway", "write_gateway"):
        section = record[role]
        branch = section["branch"]
        head = branch_head(repo, branch)
        print("%s: %s" % (role, branch))
        print("  head: %s" % (head if head else "(the branch does not exist)"))
        if role == "write_gateway":
            print("  task folder: %s" % section["task_folder"])


def command_create(record, confirmed):
    if not confirmed:
        fail("this creates real branches.\npass %s to go ahead." % CONFIRM_CREATE)
    repo = record["topology"]["repository"]
    if not repo_exists(repo):
        fail("the repository %s is not reachable with this credential" % repo)
    command_seed(record)


def command_seed(record):
    repo = record["topology"]["repository"]
    if not repo_exists(repo):
        fail("the repository %s is not reachable with this credential" % repo)

    read = record["read_gateway"]
    read_files = fixture_files(read["fixtures"])
    read_commit = push_tree(repo, read["branch"], read_files, "seed the disposable staging source")
    print("source:      %s@%s" % (read["branch"], read_commit))

    write = record["write_gateway"]
    write_files = fixture_files(write["fixtures"])
    # The task folder, with the placeholder that makes it exist at all: git does not store empty
    # folders, and the gateway refuses to create the folder itself (protocol section 12.3). The
    # path comes from the record, so the record is the only place it is written down.
    folder = write["task_folder"].strip("/")
    write_files[folder + "/.keep"] = ""
    write_commit = push_tree(repo, write["branch"], write_files, "seed the disposable staging submissions branch")
    print("submissions: %s@%s" % (write["branch"], write_commit))


def command_dispose(record, confirmed):
    if not confirmed:
        fail("this deletes real branches.\npass %s to go ahead." % CONFIRM_DISPOSE)
    repo = record["topology"]["repository"]
    for role in ("read_gateway", "write_gateway"):
        branch = record[role]["branch"]
        if branch_head(repo, branch) is None:
            print("not there: %s" % branch)
            continue
        status, _ = api("DELETE", "/repos/%s/git/refs/heads/%s" % (repo, branch))
        if status not in (204, 404):
            fail("the provider answered %s when the branch %s was deleted" % (status, branch))
        still_there = branch_head(repo, branch) is not None
        print("deleted: %s (the provider answered %s)" % (branch, status))
        if still_there:
            fail("the branch %s was not deleted" % branch)


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--record", default=DEFAULT_RECORD, help="the estate record (default: ops/staging-estate.json)")
    parser.add_argument("command", choices=["status", "create", "seed", "dispose"])
    args, flags = parser.parse_known_args(argv)

    record = load_record(args.record)
    confirmed = CONFIRM_CREATE in flags or CONFIRM_DISPOSE in flags

    if args.command == "status":
        command_status(record)
    elif args.command == "create":
        command_create(record, confirmed)
    elif args.command == "seed":
        command_seed(record)
    elif args.command == "dispose":
        command_dispose(record, confirmed)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
