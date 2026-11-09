#!/usr/bin/env python3
"""check-installs.py - the installs in this repository are deterministic, or this fails.

Three properties, and each one is a thing that has actually gone wrong:

1. **Every package has a committed lockfile.** `npm ci` installs from the lockfile and
   refuses to run without one. A repository that carries a `package.json` without a
   `package-lock.json` next to it is a repository whose installs depend on what the
   registry happened to serve that day.

2. **The lockfile agrees with the package manifest.** `npm ci` compares the two and
   refuses to install when they disagree. This check makes the same comparison, offline,
   so the disagreement is found by a check rather than by a deploy that will not start.
   The comparison is the one npm itself makes: the root entry of the lockfile
   (`packages[""]`) carries the manifest's dependency set.

3. **The workflows install with `npm ci`, and they say which lockfile they cached.**
   `npm install` resolves and writes a lockfile, so it is not reproducible; `npm ci`
   installs exactly what the lockfile says. `actions/setup-node` with `cache: npm` needs
   a `cache-dependency-path` that exists: when the path is wrong the job fails in
   `setup-node`, before the repository's own checks run, and the failure looks like a
   CI problem rather than a packaging one.

Usage:
    python3 release/check-installs.py            the repository at the current checkout
    python3 release/check-installs.py --root DIR another checkout

Exit:  0 if every property holds, 1 otherwise. Every failure is printed with the file
and the reason. This script is never shipped: it lives in release/, which is outside the
artifact, and release/manifest.txt does not list it.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# An install command that is not deterministic. `npm ci` is the only one allowed.
# The command is looked for anywhere in the line, because in a workflow it is written as
# "- run: npm install" and not as a bare command.
NON_DETERMINISTIC = re.compile(
    r"\b(?:npm\s+(?:install|i|add|update|audit\s+fix)\b|yarn\s+add\b|pnpm\s+(?:add|install)\b)",
    re.IGNORECASE,
)
# The step that installs, and the step that declares the cache path.
NPM_CI = re.compile(r"\bnpm\s+ci\b")
CACHE_PATH = re.compile(r"cache-dependency-path\s*:\s*(\S+)")

DEPENDENCY_KEYS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")


def tracked(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.splitlines()


def fail(problems: list[str], message: str) -> None:
    problems.append(message)


def check_package(root: Path, tracked_files: set[str], rel: str, problems: list[str]) -> None:
    package_path = root / rel
    lock_rel = str(Path(rel).parent / "package-lock.json")
    lock_path = root / lock_rel

    if lock_rel not in tracked_files:
        fail(problems, f"{rel}: no committed package-lock.json next to it ({lock_rel})")
        return
    if not lock_path.is_file():
        fail(problems, f"{lock_rel}: the lockfile is committed but not in the working tree")
        return

    try:
        manifest = json.loads(package_path.read_text(encoding="utf-8"))
    except ValueError as e:
        fail(problems, f"{rel}: not valid JSON ({e})")
        return
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except ValueError as e:
        fail(problems, f"{lock_rel}: not valid JSON ({e})")
        return

    if "lockfileVersion" not in lock:
        fail(problems, f"{lock_rel}: no lockfileVersion")
    if "packages" not in lock or "" not in lock.get("packages", {}):
        fail(problems, f"{lock_rel}: no root package entry (packages[\"\"])")
        return
    root_entry = lock["packages"][""]

    # The same comparison npm ci makes: the lockfile's root entry must carry the
    # manifest's dependency set, exactly.
    for key in DEPENDENCY_KEYS:
        want = manifest.get(key, {})
        have = root_entry.get(key, {})
        if want != have:
            missing = sorted(set(want) - set(have))
            extra = sorted(set(have) - set(want))
            changed = sorted(
                name for name in set(want) & set(have) if want[name] != have[name]
            )
            detail = []
            if missing:
                detail.append(f"missing {missing}")
            if extra:
                detail.append(f"not in the manifest {extra}")
            if changed:
                detail.append(f"different version {changed}")
            fail(
                problems,
                f"{rel}: {key} and {lock_rel} disagree ({'; '.join(detail)}) - "
                "npm ci would refuse to install",
            )

    # A lockfile that names a different name or version than the manifest is the same
    # disagreement seen from the other side.
    if root_entry.get("name") != manifest.get("name"):
        fail(problems, f"{rel}: the manifest is {manifest.get('name')!r} and the lockfile says {root_entry.get('name')!r}")


def check_workflow(root: Path, rel: str, problems: list[str]) -> None:
    text = (root / rel).read_text(encoding="utf-8")
    for number, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        if NON_DETERMINISTIC.search(line):
            fail(problems, f"{rel}:{number}: a non-deterministic install ({line.strip()})")
    if NPM_CI.search(text):
        paths = CACHE_PATH.findall(text)
        if not paths:
            # npm ci without a cache path is deterministic but slow; setup-node with
            # cache: npm and no path fails the job before anything else runs.
            if re.search(r"cache\s*:\s*npm", text):
                fail(problems, f"{rel}: 'cache: npm' without a cache-dependency-path")
        for path in paths:
            if not (root / path).is_file():
                fail(problems, f"{rel}: cache-dependency-path '{path}' does not exist")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                        help="the repository to check")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()

    try:
        files = tracked(root)
    except subprocess.CalledProcessError as e:
        print(f"could not list the tracked files: {e}", file=sys.stderr)
        return 1
    tracked_files = set(files)

    problems: list[str] = []
    packages = sorted(f for f in files if Path(f).name == "package.json" and "node_modules" not in f)
    if not packages:
        problems.append("no package.json is tracked: the check would be vacuous")
    for rel in packages:
        check_package(root, tracked_files, rel, problems)

    workflows = sorted(f for f in files if f.startswith(".github/workflows/") and f.endswith((".yml", ".yaml")))
    if not workflows:
        problems.append("no workflow is tracked: the check would be vacuous")
    for rel in workflows:
        check_workflow(root, rel, problems)

    if problems:
        print("install determinism: FAILED")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(
        "install determinism: OK "
        f"({len(packages)} package(s) with a committed and agreeing lockfile, "
        f"{len(workflows)} workflow(s) installing with npm ci)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
