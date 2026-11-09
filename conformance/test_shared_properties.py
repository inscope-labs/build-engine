#!/usr/bin/env python3
"""Tests for the shared-property suite (conformance/harness/run_shared.py).

The suite is only worth having if it cannot be satisfied by accident. These tests check that:
  1. the cases cover every property x format cell exactly once;
  2. every named test really exists in its file (a cheap static check; the runner itself runs them);
  3. the runner fails a cell that names a test that does not exist, a cell with no executable evidence,
     an accepted gap with no decision behind it, and an external cell that claims it was run;
  4. an EXTERNAL cell is never a pass, and --strict turns it into a failure;
  5. the matrix printed in docs/release/CAPABILITY-CONFORMANCE.md equals the one generated from the cases.

The heavy run (the real tests) is `python3 conformance/harness/run_shared.py`, which the S2 gate runs.
Not shipped in releases.
"""
import copy
import importlib.util
import json
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def _load():
    spec = importlib.util.spec_from_file_location("run_shared", HERE / "harness" / "run_shared.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RS = _load()
DATA = RS.load(RS.DEFAULT_CASES)


def cell(prop, fmt):
    return copy.deepcopy(next(c for c in DATA["cells"] if c["property"] == prop and c["format"] == fmt))


class TestCoverage(unittest.TestCase):
    def test_every_property_and_format_has_exactly_one_cell(self):
        self.assertEqual(len(DATA["cells"]), len(RS.PROPERTIES) * len(RS.FORMATS))

    def test_the_shared_properties_are_the_three_the_decision_names(self):
        self.assertEqual(DATA["shared_properties"], ["signing", "expiry", "revocation"])

    def test_an_incomplete_case_file_is_refused(self):
        broken = copy.deepcopy(DATA)
        broken["cells"].pop()
        path = HERE / "cases" / "_tmp_incomplete.json"
        try:
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(SystemExit):
                RS.load(path)
        finally:
            path.unlink(missing_ok=True)

    def test_every_named_test_exists_in_its_file(self):
        for c in DATA["cells"]:
            for ev in c["evidence"]:
                if ev["kind"] in ("ts-write", "ts-read"):
                    source = (REPO / ev["file"]).read_text(encoding="utf-8")
                    for name in ev["names"]:
                        with self.subTest(file=ev["file"], name=name):
                            self.assertEqual(source.count('"%s"' % name), 1,
                                             "a named test must appear exactly once in %s" % ev["file"])
                elif ev["kind"] == "case":
                    ids = {x["id"] for x in json.loads((HERE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["cases"]}
                    for i in ev["ids"]:
                        self.assertIn(i, ids)
                elif ev["kind"] == "script":
                    text = (REPO / ev["script"]).read_text(encoding="utf-8")
                    for t in ev["texts"]:
                        self.assertIn(t, text)

    def test_external_evidence_is_pinned_to_a_commit(self):
        for c in DATA["cells"]:
            for ev in c["evidence"]:
                if ev["kind"] == "external":
                    self.assertRegex(ev["commit"], r"^[0-9a-f]{40}$")
                    self.assertTrue(ev["names"])


class TestTheRunnerCannotBeFooled(unittest.TestCase):
    def test_a_named_test_that_does_not_exist_fails_the_cell(self):
        c = cell("signing", "ctxwrite-v1")
        c["evidence"][0]["names"].append("a test that was never written")
        outcome, details = RS.judge(c)
        self.assertEqual(outcome, "FAIL")
        self.assertTrue(any("named tests ran" in d for d in details), details)

    def test_a_missing_file_fails_the_cell(self):
        c = cell("signing", "ctxwrite-v1")
        c["evidence"][0]["file"] = "gateway/write/tests/unit/auth/no-such.test.ts"
        self.assertEqual(RS.judge(c)[0], "FAIL")

    def test_a_cell_with_no_executable_evidence_cannot_pass(self):
        c = cell("signing", "ctxwrite-v1")
        c["evidence"] = []
        self.assertEqual(RS.judge(c)[0], "FAIL")

    def test_an_accepted_gap_needs_the_decision_that_accepts_it(self):
        c = cell("replay", "ctxwrite-v1")
        c["evidence"] = [e for e in c["evidence"] if e["kind"] != "adr"]
        self.assertEqual(RS.judge(c)[0], "FAIL")

    def test_an_accepted_gap_whose_decision_is_not_decided_fails(self):
        c = cell("replay", "ctxwrite-v1")
        for e in c["evidence"]:
            if e["kind"] == "adr":
                e["file"] = "docs/release/CAPABILITY-CONFORMANCE.md"  # exists, but is not a decided ADR
        self.assertEqual(RS.judge(c)[0], "FAIL")

    def test_an_external_cell_is_never_a_pass(self):
        outcome, details = RS.judge(cell("signing", "ctxop-v1"))
        self.assertEqual(outcome, "EXTERNAL")
        self.assertTrue(all(d.startswith("cited, not run") for d in details))

    def test_an_external_cell_cannot_claim_to_have_run_something(self):
        c = cell("signing", "ctxop-v1")
        c["evidence"].append(cell("signing", "ctxwrite-v1")["evidence"][0])
        self.assertEqual(RS.judge(c)[0], "FAIL")

    def test_external_evidence_without_a_commit_fails(self):
        c = cell("signing", "ctxop-v1")
        c["evidence"][0]["commit"] = "main"
        self.assertEqual(RS.judge(c)[0], "FAIL")


class TestStrict(unittest.TestCase):
    def setUp(self):
        self._judge = RS.judge
        RS.judge = lambda c: ("EXTERNAL", ["cited, not run"])

    def tearDown(self):
        RS.judge = self._judge

    def test_default_run_tolerates_external_cells_and_strict_does_not(self):
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(RS.main([]), 0)
            self.assertEqual(RS.main(["--strict"]), 1)


class TestTheDocumentMatchesTheCases(unittest.TestCase):
    def test_the_matrix_in_the_capability_document_is_the_generated_one(self):
        doc = (REPO / "docs" / "release" / "CAPABILITY-CONFORMANCE.md").read_text(encoding="utf-8")
        found = re.search(r"<!-- shared-evidence:begin -->\n(.*?)<!-- shared-evidence:end -->", doc, re.S)
        self.assertIsNotNone(found, "the evidence matrix markers are missing")
        self.assertEqual(found.group(1), RS.markdown(DATA))


if __name__ == "__main__":
    unittest.main()
