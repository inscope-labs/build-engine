#!/usr/bin/env python3
"""check-workflow-policy.py - the deployment workflows are fail-closed, or this fails.

The rollout plan's S3 exit gate asks for two things that are easy to state and easy to lose:
no permissive expression in a gateway workflow, and a production deployment that is a
fail-closed sequence. A comment is not a property. This script makes both of them
checkable, so that a later edit that softens either one fails a check instead of passing
quietly.

Four properties:

1. **No permissive expression in the deployment path.** `|| true`, `|| :`,
   `continue-on-error: true` and `set +e` all say "if this fails, carry on". In a gate that
   is the difference between a check and a decoration. The scanned set is the deployment
   path: the workflows, the scripts the workflows run, and the release machinery. The
   shipped consumer payload (`template/`) and the test scripts (`tests/`) are not scanned:
   the payload is the consumer's contract and is changed on its own schedule, and a test
   that captures a failing command's output is not a gate.

2. **A workflow that holds a deployment credential is not triggered by a pull request or a
   push.** A pull request can be written by anyone, and a push to main is a merge - so a
   deployment that either of them can start is a side effect rather than a decision.

3. **The production deployment is a fail-closed sequence.** The order is checked, not just
   the presence of the steps:

       typecheck -> unit and integration -> conformance -> privacy and log hygiene
       -> bundle verification -> staging acceptance -> explicit approval

   The approval is the `environment:` on the publishing job, which is what makes a run
   wait for a reviewer. The staging acceptance is a job of its own, and the publishing job
   waits for it, so a production publication cannot precede an accepted staging deployment.

4. **Every action is pinned to a commit.** A tag can move; a commit cannot.

Usage:
    python3 release/check-workflow-policy.py
    python3 release/check-workflow-policy.py --root DIR

Exit:  0 if every property holds, 1 otherwise. Never shipped: it lives in release/, which
is outside the artifact, and release/manifest.txt does not list it.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# --------------------------------------------------------------------------- the scan set
# Every tracked shell script in these directories, and the workflows themselves.
SCAN_DIRECTORIES = ("ops/", "release/", "gateway/read/production/ops/", "gateway/write/scripts/")
WORKFLOW_DIRECTORY = ".github/workflows/"

# These files have to name the permissive forms, or the commands they forbid, in order to
# look for them, so they exclude themselves. The exclusion is file-scoped, it is named in
# the output, and nothing else is excluded: the point of the check is that it cannot be
# talked out of a hit.
SELF = "release/check-workflow-policy.py"
SELF_EXEMPT = (SELF, "release/check-installs.py")

# The permissive forms. Each one swallows a failure.
PERMISSIVE = [
    (re.compile(r"\|\|\s*true\b"), "a shell fallback that swallows a failure"),
    (re.compile(r"\|\|\s*:\s*$"), "a shell fallback that swallows a failure"),
    (re.compile(r"continue-on-error\s*:\s*true"), "continue-on-error"),
    (re.compile(r"^\s*set\s+\+e\b", re.MULTILINE), "set +e"),
]

# "|| exit 0" is permissive when it hides a command's failure, and it is a guard when the
# left side is a test. "[ -f "$out" ] || exit 0" is a guard: there was nothing to scan.
EXIT_ZERO = re.compile(r"\|\|\s*exit\s+0\b")
TEST_GUARD = re.compile(r"^\s*\[.*\]\s*\|\|\s*exit\s+0\s*$")

# The secrets that make a workflow a deployment. The write gateway's log hygiene gate
# keeps the same list; a workflow that names one of these holds a deployment credential.
DEPLOYMENT_SECRETS = (
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_ZONE_ID",
    "WRANGLER_API_TOKEN",
    "GITHUB_TOKEN",
    "DEPLOY_TOKEN",
)

# --------------------------------------------------------------------------- the policy
# The fail-closed sequence, per publishing workflow. `sequence` is a list of needles that
# must appear, in this order, in the gate. `script` is the file the gate runs, when the
# gate is a script rather than a list of steps.
SEQUENCES = [
    {
        "workflow": ".github/workflows/deploy.yml",
        "gate_job": "gate",
        "script": None,
        "sequence": [
            "npm run typecheck",
            "npm test",
            "conformance/harness/run_shared.py",
            "npm run verify:log-hygiene",
            "npm run check:bundle",
        ],
        "acceptance_job": "staging-acceptance",
        "acceptance_needs": "gate",
        "publish_job": "deploy",
        "publish_needs": ("gate", "staging-acceptance"),
        "publish_environment": "production",
    },
    {
        "workflow": ".github/workflows/deploy-read-gateway.yml",
        "gate_job": "gate",
        "script": "gateway/read/production/ops/deploy-gate.sh",
        "sequence": [
            "npm run typecheck",
            "npm test",
            "ops/bundle-check.sh",
            "npm run test:conformance",
            "npm run test:isolation",
        ],
        "acceptance_job": "staging-acceptance",
        "acceptance_needs": "gate",
        "publish_job": "publish",
        "publish_needs": ("gate", "staging-acceptance"),
        "publish_environment": "${{ inputs.environment }}",
    },
]


# --------------------------------------------------------------------------- a small YAML reader
# The workflows in this repository use a plain style: two-space indentation, one mapping
# key per line, and inline lists for `needs`. This reader understands that style and
# nothing else. It is deliberately small, and it fails loudly rather than guessing: a
# workflow it cannot read is a workflow it cannot check, and that is a failure.
def parse_jobs(text: str) -> dict:
    jobs: dict[str, dict] = {}
    in_jobs = False
    current: str | None = None
    in_steps = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        if indent == 0:
            in_jobs = stripped.startswith("jobs:")
            current = None
            in_steps = False
            continue
        if not in_jobs:
            continue
        if indent == 2 and stripped.endswith(":"):
            current = stripped[:-1].strip()
            jobs[current] = {"needs": [], "attrs": {}, "steps": [], "steps_raw": []}
            in_steps = False
            continue
        if current is None:
            continue
        if indent == 4 and ":" in stripped:
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip()
            in_steps = key == "steps"
            if key == "needs":
                jobs[current]["needs"] = parse_needs(value)
            else:
                jobs[current]["attrs"][key] = value
            continue
        if in_steps and indent == 6 and stripped.startswith("- "):
            body = stripped[2:].strip()
            key, _, value = body.partition(":")
            jobs[current]["steps"].append((key.strip(), value.strip()))
            jobs[current]["steps_raw"].append(stripped)
            continue
        if in_steps and indent >= 8 and jobs[current]["steps_raw"]:
            # A step's own keys and its block scalar belong to the step above it.
            jobs[current]["steps_raw"][-1] += "\n" + raw
            continue
    return jobs


def parse_needs(value: str) -> list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        return [item.strip().strip("'\"") for item in value[1:-1].split(",") if item.strip()]
    if not value:
        return []
    return [value.strip("'\"")]


def job_bodies(job: dict) -> list[str]:
    """The text of a job's steps: the run commands and the multi-line blocks."""
    return job["steps_raw"]


# --------------------------------------------------------------------------- the checks
def tracked(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True
    )
    return out.stdout.splitlines()


def check_permissive(root: Path, files: list[str], problems: list[str]) -> int:
    scanned = 0
    excluded = 0
    for rel in files:
        if rel in SELF_EXEMPT:
            excluded += 1
            continue
        if rel.startswith(WORKFLOW_DIRECTORY) and rel.endswith((".yml", ".yaml")):
            pass
        elif rel.startswith(SCAN_DIRECTORIES) and rel.endswith((".sh", ".ts", ".py", ".yml", ".yaml")):
            pass
        else:
            continue
        scanned += 1
        text = (root / rel).read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), start=1):
            if line.lstrip().startswith("#"):
                continue
            for pattern, what in PERMISSIVE:
                if pattern.search(line):
                    problems.append(f"{rel}:{number}: {what} ({line.strip()[:100]})")
            if EXIT_ZERO.search(line) and not TEST_GUARD.search(line):
                problems.append(
                    f"{rel}:{number}: a fallback that exits 0 whatever happened ({line.strip()[:100]})"
                )
    if excluded:
        print(
            "  note: excluded from the permissive-expression scan (they name the forms): "
            + ", ".join(SELF_EXEMPT)
        )
    return scanned


def check_triggers(root: Path, files: list[str], problems: list[str]) -> int:
    checked = 0
    for rel in files:
        if not (rel.startswith(WORKFLOW_DIRECTORY) and rel.endswith((".yml", ".yaml"))):
            continue
        text = (root / rel).read_text(encoding="utf-8")
        touched = [s for s in DEPLOYMENT_SECRETS if s in text]
        if not touched:
            continue
        checked += 1
        text = (root / rel).read_text(encoding="utf-8")
        # The trigger block is everything between "on:" and the next top-level key.
        triggers = []
        capture = False
        for raw in text.splitlines():
            if raw.startswith("on:"):
                capture = True
                continue
            if capture:
                if raw and not raw[0].isspace():
                    break
                stripped = raw.strip().rstrip(":")
                if stripped:
                    triggers.append(stripped)
        for trigger in triggers:
            if trigger.startswith("pull_request"):
                problems.append(
                    f"{rel}: a workflow that holds {', '.join(touched)} is triggered by "
                    f"'{trigger}'; a deployment must be a decision, not a side effect"
                )
        # A push is a problem when it fires on a branch: a merge must not deploy. A push on
        # a tag is the release mechanism (release.yml), and the tag is the operator's.
        if "push" in triggers:
            block = trigger_block(text)
            if "tags:" not in block:
                problems.append(
                    f"{rel}: a workflow that holds {', '.join(touched)} is triggered by a push "
                    "to a branch; a merge must not deploy"
                )
    return checked


def trigger_block(text: str) -> str:
    """The text of the workflow's trigger block."""
    out = []
    capture = False
    for raw in text.splitlines():
        if raw.startswith("on:"):
            capture = True
            continue
        if capture:
            if raw and not raw[0].isspace():
                break
            out.append(raw)
    return "\n".join(out)


def check_pinning(root: Path, files: list[str], problems: list[str]) -> int:
    checked = 0
    for rel in files:
        if not (rel.startswith(WORKFLOW_DIRECTORY) and rel.endswith((".yml", ".yaml"))):
            continue
        checked += 1
        text = (root / rel).read_text(encoding="utf-8")
        for number, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            # A step is written "- uses: action@version", so the list marker is removed
            # before the reference is looked at.
            if stripped.startswith("- "):
                stripped = stripped[2:].strip()
            if not stripped.startswith("uses:"):
                continue
            reference = stripped[len("uses:"):].strip()
            # The reference may carry a comment: "actions/checkout@<sha> # v4".
            reference = reference.split("#")[0].strip()
            if "@" not in reference:
                problems.append(f"{rel}:{number}: 'uses: {reference}' names no version")
                continue
            _, _, version = reference.partition("@")
            if not re.fullmatch(r"[0-9a-f]{40}", version):
                problems.append(
                    f"{rel}:{number}: 'uses: {reference}' is not pinned to a commit; a tag can move"
                )
    return checked


def check_sequences(root: Path, problems: list[str]) -> int:
    checked = 0
    for policy in SEQUENCES:
        rel = policy["workflow"]
        path = root / rel
        if not path.is_file():
            problems.append(f"{rel}: the publishing workflow does not exist")
            continue
        checked += 1
        text = path.read_text(encoding="utf-8")
        jobs = parse_jobs(text)
        if not jobs:
            problems.append(f"{rel}: the workflow reader found no job; the workflow cannot be checked")
            continue

        gate = jobs.get(policy["gate_job"])
        if gate is None:
            problems.append(f"{rel}: there is no '{policy['gate_job']}' job")
        else:
            bodies = job_bodies(gate)
            if policy["script"]:
                script = root / policy["script"]
                if not script.is_file():
                    problems.append(f"{policy['script']}: the gate script does not exist")
                else:
                    bodies = script.read_text(encoding="utf-8").splitlines()
            positions = []
            for needle in policy["sequence"]:
                found = None
                for index, body in enumerate(bodies):
                    if needle in body:
                        found = index
                        break
                if found is None:
                    problems.append(
                        f"{rel}: the gate has no step for '{needle}'"
                        + (f" ({policy['script']})" if policy["script"] else "")
                    )
                else:
                    positions.append((needle, found))
            for (a, ia), (b, ib) in zip(positions, positions[1:]):
                if ia >= ib:
                    problems.append(
                        f"{rel}: the gate runs '{b}' at step {ib + 1} and '{a}' at step {ia + 1}: "
                        "the fail-closed sequence is out of order"
                    )

        acceptance = jobs.get(policy["acceptance_job"])
        if acceptance is None:
            problems.append(f"{rel}: there is no '{policy['acceptance_job']}' job")
        elif policy["acceptance_needs"] not in acceptance["needs"]:
            problems.append(
                f"{rel}: the '{policy['acceptance_job']}' job needs {acceptance['needs']}, "
                f"not '{policy['acceptance_needs']}'"
            )

        publish = jobs.get(policy["publish_job"])
        if publish is None:
            problems.append(f"{rel}: there is no '{policy['publish_job']}' job")
            continue
        for wanted in policy["publish_needs"]:
            if wanted not in publish["needs"]:
                problems.append(
                    f"{rel}: the '{policy['publish_job']}' job needs {publish['needs'] or 'nothing'}, "
                    f"so it does not wait for '{wanted}'"
                )
        environment = publish["attrs"].get("environment", "")
        if environment != policy["publish_environment"]:
            problems.append(
                f"{rel}: the '{policy['publish_job']}' job has environment "
                f"'{environment}', not '{policy['publish_environment']}'; the approval is the environment"
            )

        # Every job's needs must name a job that exists, or the graph was misread.
        for name, job in jobs.items():
            for need in job["needs"]:
                if need not in jobs:
                    problems.append(f"{rel}: the job '{name}' needs '{need}', which does not exist")
    return checked


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()

    try:
        files = tracked(root)
    except subprocess.CalledProcessError as e:
        print(f"could not list the tracked files: {e}", file=sys.stderr)
        return 1

    problems: list[str] = []
    scanned = check_permissive(root, files, problems)
    triggered = check_triggers(root, files, problems)
    pinned = check_pinning(root, files, problems)
    sequenced = check_sequences(root, problems)

    if scanned == 0 or pinned == 0 or sequenced == 0:
        problems.append("the scan was vacuous: nothing was checked")
    if problems:
        print("workflow policy: FAILED")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(
        "workflow policy: OK "
        f"({scanned} deployment-path file(s) free of permissive expressions, "
        f"{triggered} deployment workflow(s) not triggered by a push or a pull request, "
        f"{pinned} workflow(s) with pinned actions, "
        f"{sequenced} publishing workflow(s) with a fail-closed sequence)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
