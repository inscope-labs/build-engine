#!/usr/bin/env python3
"""
The release isolation test: what the consumer receives, and what it must never receive.

This is the proof the rollout plan asks for at stage S1:

    "[R] Release isolation test proves `gateway/**` and conformance assets are outside the
     artifact."

It builds the artifact the way a release builds it - `release/package.sh`, from the tracked
file list and the allowlist, with no other input - and then asserts three separate things:

  1. **The artifact holds exactly the allowlist.** Every member is covered by a path the
     manifest names, and every file the manifest names is a member. Nothing extra entered
     through the build, and nothing was silently dropped.

  2. **The infrastructure stayed out.** No member is under `gateway/`, `conformance/`,
     `ops/`, `variants/` or `.github/`; no member is a deployment configuration
     (`wrangler.toml`, `.dev.vars`, `.wrangler/`, `node_modules/`); and the release machinery
     itself - including `release/rollout-gate.sh` - is not inside the payload.

  3. **No credential is inside.** Every member's bytes are matched against the credential
     shapes in `release/forbidden.txt`, with the same `grep -aE` the verifier uses, so binary
     members are matched too and a NUL byte cannot hide a token.

The rules are read from `release/manifest.txt` and `release/forbidden.txt` at run time, so the
test cannot drift away from the policy it is testing.

Run it from the repository root:

    python3 -m unittest discover -s tests -p 'test_*.py' -v
    python3 tests/test_release_isolation.py
"""
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "release" / "manifest.txt"
FORBIDDEN = REPO / "release" / "forbidden.txt"
PACKAGE = REPO / "release" / "package.sh"

# The infrastructure trees that must never reach a consumer. The path is matched against the
# artifact-relative member name, so a renamed copy under another directory is still caught by
# the forbidden rules; this list is the first, blunt gate.
INFRASTRUCTURE_DIRS = ("gateway", "conformance", "ops", "variants", ".github")

# The deployment configurations and the local state that must never be shipped.
INFRASTRUCTURE_BASENAMES = ("wrangler.toml", ".dev.vars", "node_modules", ".wrangler")

# The one member the artifact carries that is not on the allowlist: `release/package.sh`
# generates it at build time, and `release/verify.sh` says so in its own comment. It is a
# listing of the payload, generated from the same allowlist, and it is verified on both sides.
GENERATED_MEMBERS = ("engine/RELEASE-MANIFEST",)

# The release machinery: it builds the artifact, it is not part of it.
RELEASE_MACHINERY = (
    "rollout-gate.sh",
    "package.sh",
    "verify.sh",
    "set-version.sh",
    "test-release.sh",
    "manifest.txt",
    "forbidden.txt",
)


def manifest_entries():
    """The allowlist, as (mode, path) pairs. A directory entry covers everything beneath it."""
    out = []
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        mode, _, path = line.partition(" ")
        out.append((mode.strip(), path.strip().rstrip("/")))
    return out


def forbidden_rules():
    """The path and text rules in release/forbidden.txt, as ERE patterns.

    They are matched with `grep -E`, exactly as `release/verify.sh` matches them, because the
    rules are POSIX extended regular expressions and Python's `re` is not one.
    """
    paths, texts = [], []
    for line in FORBIDDEN.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("path: "):
            paths.append(line[6:])
        elif line.startswith("text: "):
            texts.append(line[6:])
    return paths, texts


def grep_matches(pattern, haystack):
    """True when the POSIX ERE matches. Uses grep, so the semantics are the verifier's."""
    result = subprocess.run(
        ["grep", "-qE", "--", pattern],
        input=haystack,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


class TestReleaseIsolation(unittest.TestCase):
    """The artifact is built once and every assertion reads the same archive."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="build-engine-isolation-")
        result = subprocess.run(
            [str(PACKAGE), cls.tmp],
            cwd=str(REPO),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AssertionError(
                "release/package.sh failed (%d):\n%s\n%s"
                % (result.returncode, result.stdout, result.stderr)
            )
        version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
        cls.artifact = Path(cls.tmp) / ("build-engine-v%s.tar.gz" % version)
        if not cls.artifact.exists():
            raise AssertionError("the artifact was not produced at %s" % cls.artifact)

        cls.extract = Path(cls.tmp) / "extracted"
        cls.extract.mkdir()
        with tarfile.open(cls.artifact, "r:gz") as tf:
            tf.extractall(cls.extract)
            cls.members = tf.getmembers()
        cls.member_names = [m.name for m in cls.members]
        cls.files = [m for m in cls.members if m.isfile()]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # -- 1. the artifact holds exactly the allowlist -----------------------------

    def test_every_member_is_covered_by_the_allowlist(self):
        entries = manifest_entries()
        extra = []
        for name in self.member_names:
            if name in GENERATED_MEMBERS:
                continue
            covered = False
            for _, path in entries:
                if name == path or name.startswith(path + "/"):
                    covered = True
                    break
            if not covered:
                extra.append(name)
        self.assertEqual(
            [],
            extra,
            "the artifact holds paths the allowlist does not cover: %s" % sorted(extra),
        )

    def test_every_allowed_file_is_in_the_artifact(self):
        present = set(self.member_names)
        missing = []
        for mode, path in manifest_entries():
            source = REPO / "template" / path
            if source.is_dir():
                # A directory entry is covered by its contents; it must not be empty.
                if not any(name.startswith(path + "/") for name in present):
                    missing.append(path + "/ (empty)")
            elif path not in present:
                missing.append(path)
        self.assertEqual(
            [],
            missing,
            "allowed file(s) missing from the artifact: %s" % missing,
        )

    # -- 2. the infrastructure stayed out -----------------------------------------

    def test_no_infrastructure_directory_in_the_artifact(self):
        offenders = []
        for name in self.member_names:
            parts = name.split("/")
            for infra in INFRASTRUCTURE_DIRS:
                if infra in parts:
                    offenders.append(name)
                    break
        self.assertEqual(
            [],
            offenders,
            "the artifact carries infrastructure: %s" % sorted(set(offenders)),
        )

    def test_no_deployment_configuration_in_the_artifact(self):
        offenders = []
        for name in self.member_names:
            base = os.path.basename(name)
            if base in INFRASTRUCTURE_BASENAMES or base.startswith(".dev.vars"):
                offenders.append(name)
        self.assertEqual(
            [],
            offenders,
            "the artifact carries a deployment configuration: %s" % sorted(set(offenders)),
        )

    def test_the_release_machinery_is_not_inside_the_artifact(self):
        offenders = [
            name for name in self.member_names
            if os.path.basename(name) in RELEASE_MACHINERY
        ]
        self.assertEqual(
            [],
            offenders,
            "the artifact carries the release machinery: %s" % sorted(set(offenders)),
        )

    def test_the_gate_runner_is_not_shipped(self):
        self.assertNotIn(
            "rollout-gate.sh",
            " ".join(self.member_names),
            "the gate runner must not be shipped",
        )
        self.assertNotIn(
            "rollout-gate.sh",
            MANIFEST.read_text(encoding="utf-8"),
            "the gate runner must not be on the allowlist",
        )

    def test_every_forbidden_path_rule_is_satisfied(self):
        path_rules, _ = forbidden_rules()
        offenders = []
        for name in self.member_names:
            for rule in path_rules:
                if grep_matches(rule, name):
                    offenders.append((name, rule))
                    break
        self.assertEqual(
            [],
            offenders,
            "the artifact breaks a forbidden path rule: %s" % offenders,
        )

    # -- 3. no credential is inside -----------------------------------------------

    def test_no_credential_shape_inside_the_artifact(self):
        _, text_rules = forbidden_rules()
        offenders = []
        for rule in text_rules:
            # grep -a matches binary files too, so a NUL byte cannot hide a token.
            result = subprocess.run(
                ["grep", "-ralE", "--", rule, "."],
                cwd=str(self.extract),
                capture_output=True,
                text=True,
            )
            for hit in result.stdout.split():
                if hit not in (".", "./"):
                    offenders.append((hit, rule))
        self.assertEqual(
            [],
            offenders,
            "the artifact carries a credential shape: %s" % offenders,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
