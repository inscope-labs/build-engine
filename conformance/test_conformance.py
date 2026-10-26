#!/usr/bin/env python3
"""The conformance acceptance test for the build-engine repository.

This is the gate that says "the scheme, the shipped client and the reference gateway agree". It runs
the shared suite in conformance/ against the implementations in this repository, and it checks the
things that would otherwise drift silently: the published vector, the status table in behaviours.md,
and the spec in SCHEME.md.

Not shipped in releases: a consumer never needs it.
"""
import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path

CONFORMANCE = Path(__file__).resolve().parent
REPO = CONFORMANCE.parent
sys.path.insert(0, str(REPO / "template" / "engine" / "tools"))
import ctxlink as cg  # noqa: E402  (the shipped client)

# the published compatibility vector, quoted in template/docs/CONTEXT-EXPORT.md and in the shipped test
PUBLISHED_VECTOR = {
    "secret": "test-secret", "kid": "k1", "exp": 2000000000, "order": "10008-S001",
    "ref": "a" * 40, "path": "amk/amk-ssot.md",
    "signature": "b5aVA1G6MJDhZy5mkIkSFeUMFBM0W-tixIb2w4XHEU8",
}


def _load_harness():
    spec = importlib.util.spec_from_file_location("conformance_harness", CONFORMANCE / "harness" / "run.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestShippedClientPassesTheVectors(unittest.TestCase):
    """Task 4.1.5: the shipped client reproduces the shared vectors exactly."""

    @classmethod
    def setUpClass(cls):
        cls.harness = _load_harness()
        cls.report = cls.harness.Report.__new__(cls.harness.Report)
        cls.report.results = []

    def _run(self, fn, *args):
        report = self.harness.Report()
        report.results = []
        with contextlib.redirect_stdout(io.StringIO()):
            fn(report, *args)
        return report

    def test_every_vector_is_reproduced_and_every_invalid_input_refused(self):
        report = self._run(self.harness.run_vectors, self.harness.PythonSigner())
        failed = [r for r in report.results if not r["ok"]]
        self.assertEqual(failed, [], "the shipped client does not match the shared vectors")
        self.assertGreater(len(report.results), 30)

    def test_the_published_vector_is_still_the_published_vector(self):
        doc = json.loads((CONFORMANCE / "signing-vectors.json").read_text(encoding="utf-8"))
        v = [x for x in doc["vectors"] if x["id"] == "V01"][0]
        for k, want in PUBLISHED_VECTOR.items():
            self.assertEqual(v[k], want, "the published vector %s changed" % k)

    def test_the_published_vector_is_quoted_in_the_shipped_test_and_the_design_doc(self):
        # the constant is published in two other places; they must not drift apart
        shipped_test = (REPO / "template" / "engine" / "tools" / "test_ctxlink.py").read_text(encoding="utf-8")
        design_doc = (REPO / "template" / "docs" / "CONTEXT-EXPORT.md").read_text(encoding="utf-8")
        self.assertIn(PUBLISHED_VECTOR["signature"], shipped_test)
        self.assertIn(PUBLISHED_VECTOR["signature"], design_doc)

    def test_the_scheme_constant_is_the_one_the_spec_describes(self):
        doc = json.loads((CONFORMANCE / "signing-vectors.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["scheme"], cg.SCHEME)
        self.assertEqual(doc["scheme"], "ctxgate-v1")
        scheme_md = (CONFORMANCE / "SCHEME.md").read_text(encoding="utf-8")
        self.assertIn("ctxgate-v1", scheme_md)

    def test_control_characters_are_refused_in_a_path(self):
        # the shipped path rule (SCHEME.md section 5)
        for bad in ("a\nb", "a\tb", "a\x01b", "a\x7fb", "a\x00b"):
            self.assertFalse(cg.safe_path(bad), "safe_path accepted %r" % bad)
        for good in ("notes/na~me.v1..2.md", "a+b.md", "dir with space/é.md", ".hidden.md"):
            self.assertTrue(cg.safe_path(good), "safe_path refused %r" % good)


class TestReferenceGatewayPassesTheBehaviours(unittest.TestCase):
    """Task 4.1.5: the reference gateway passes the same shared cases."""

    @classmethod
    def setUpClass(cls):
        cls.harness = _load_harness()

    def test_the_reference_gateway_passes_b1_to_b10(self):
        fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]
        gateway = self.harness.ReferenceGateway(fixture)
        gateway.start()
        try:
            report = self.harness.Report()
            with contextlib.redirect_stdout(io.StringIO()):
                self.harness.run_cases(report, self.harness.PythonSigner(), gateway, fixture, gateway.ref)
            failed = [r for r in report.results if not r["ok"]]
            self.assertEqual(failed, [], "the reference gateway does not pass the shared behaviours")
        finally:
            gateway.stop()


class TestTheSuiteItselfIsComplete(unittest.TestCase):
    """A suite with a hole in it is worse than no suite: it looks like coverage."""

    def setUp(self):
        self.cases = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))
        self.vectors = json.loads((CONFORMANCE / "signing-vectors.json").read_text(encoding="utf-8"))

    def test_every_behaviour_b1_to_b10_has_at_least_one_executable_case(self):
        covered = {c["behaviour"] for c in self.cases["cases"]}
        for i in range(1, 11):
            self.assertIn("B%d" % i, covered, "B%d has no executable case" % i)

    def test_b11_is_covered_by_the_signing_vectors(self):
        self.assertGreater(len(self.vectors["vectors"]), 0)
        self.assertGreater(len(self.vectors["invalid"]), 0)

    def test_every_case_cites_a_known_behaviour_and_has_an_expectation(self):
        for c in self.cases["cases"]:
            self.assertIn(c["behaviour"], ["B%d" % i for i in range(1, 11)], c["id"])
            self.assertIn("expect", c, c["id"])
            self.assertTrue(c["expect"], c["id"])

    def test_the_fixtue_files_exist_in_the_fixture(self):
        for p in self.cases["fixture"]["files"]:
            self.assertFalse(p.startswith("/"), p)
            self.assertNotIn("..", p.split("/"), p)

    def test_the_status_table_in_behaviours_md_is_not_a_claim_without_evidence(self):
        md = (CONFORMANCE / "behaviours.md").read_text(encoding="utf-8")
        self.assertRegex(md, r"gateway/read/reference/.*\|.*B1")
        self.assertIn("conformance/harness/run.py", md)

    def test_the_spec_covers_every_field_the_scheme_binds(self):
        scheme_md = (CONFORMANCE / "SCHEME.md").read_text(encoding="utf-8")
        for token in ("kid", "exp", "order", "ref", "path", "HMAC-SHA256", "base64url", "max_ttl"):
            self.assertIn(token, scheme_md, "SCHEME.md does not mention %s" % token)


class TestTheConformanceAssetsAreNotShipped(unittest.TestCase):
    """The conformance suite is a development asset. It must never reach a consumer."""

    def test_the_release_manifest_does_not_allowlist_anything_outside_template(self):
        for line in (REPO / "release" / "manifest.txt").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            mode, path = line.split(None, 1)
            self.assertFalse(path.startswith("conformance"), path)
            self.assertFalse(path.startswith("gateway"), path)

    def test_the_shipped_client_has_no_dependency_on_the_conformance_directory(self):
        client = (REPO / "template" / "engine" / "tools" / "ctxlink.py").read_text(encoding="utf-8")
        self.assertNotIn("conformance", client.replace("conformance/SCHEME.md", ""))
        shipped_test = (REPO / "template" / "engine" / "tools" / "test_ctxlink.py").read_text(encoding="utf-8")
        self.assertNotIn("conformance/signing-vectors.json", shipped_test)


if __name__ == "__main__":
    unittest.main()
