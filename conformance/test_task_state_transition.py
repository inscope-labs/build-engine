#!/usr/bin/env python3
"""Tests for the task-state transition reference decision (conformance/harness/transition_reference.py).

These check three things:
  1. every vector in cases/task-state-transition.json is decided as the vector says;
  2. the reference cannot be satisfied by a wrong implementation: a planted failure is reported;
  3. the reference stays tied to the things it depends on: the shipped task schema's status set,
     the closed set of seal-fact fields in protocol.md section 10.4.1, and the error codes the
     contract document names.

Not shipped in releases.
"""
import importlib.util
import json
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def _load():
    spec = importlib.util.spec_from_file_location("transition_reference", HERE / "harness" / "transition_reference.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REF = _load()
VECTORS = json.loads((HERE / "cases" / "task-state-transition.json").read_text(encoding="utf-8"))["cases"]


class TestVectors(unittest.TestCase):
    def test_every_vector_is_decided_as_written(self):
        for case in VECTORS:
            with self.subTest(case=case["id"]):
                got = REF.evaluate(case["request"])
                want = case["expect"]
                self.assertEqual(got["accepted"], want["accepted"])
                self.assertEqual(got["code"], want.get("code"))
                self.assertEqual(got["http"], want["http"])
                if "new_status" in want:
                    self.assertEqual(got.get("new_status"), want["new_status"])

    def test_the_three_refusals_the_exit_gate_names_are_covered(self):
        by_code = {c["expect"].get("code") for c in VECTORS}
        # unsealed task, wrong state, replayed transition
        self.assertIn("SEAL_NOT_ATTESTED", by_code)
        self.assertIn("TRANSITION_NOT_ALLOWED", by_code)
        self.assertIn("NONCE_REPLAYED", by_code)
        # fail closed when the seal fact cannot be read
        self.assertIn("SEAL_FACT_UNAVAILABLE", by_code)

    def test_every_refusal_has_a_catalogue_code_and_a_message(self):
        for case in VECTORS:
            got = REF.evaluate(case["request"])
            if not got["accepted"]:
                self.assertIn(got["code"], REF.CODES)
                self.assertTrue(got["message"], "a refusal never goes without a message")
                self.assertEqual(got["http"], REF.CODES[got["code"]])

    def test_set_done_has_no_side_door(self):
        # No operation other than SET_DONE can produce `done`.
        for case in VECTORS:
            got = REF.evaluate(case["request"])
            if got["accepted"] and got.get("new_status") == "done":
                self.assertEqual(case["request"]["operation"], "SET_DONE")


class TestPlantedFailure(unittest.TestCase):
    def test_an_implementation_that_skips_the_seal_check_is_caught(self):
        def wrong(request):
            request = dict(request)
            request["seal_fact"] = {"task": request["task"], "order": request["order"], "known": True, "seal_attested": True}
            return REF.evaluate(request)

        failures = [
            c["id"]
            for c in VECTORS
            if (lambda g: g["accepted"] != c["expect"]["accepted"] or g["code"] != c["expect"].get("code"))(wrong(c["request"]))
        ]
        self.assertTrue(failures, "the vectors must fail an implementation that never checks the seal")
        self.assertIn("T03", failures)

    def test_an_implementation_that_fails_open_is_caught(self):
        def wrong(request):
            request = dict(request)
            if request.get("seal_fact") in (None, "unavailable"):
                request["seal_fact"] = {"task": request["task"], "order": request["order"], "known": True, "seal_attested": True}
            return REF.evaluate(request)

        got = wrong(next(c for c in VECTORS if c["id"] == "T11")["request"])
        self.assertTrue(got["accepted"])  # the wrong implementation accepts...
        want = next(c for c in VECTORS if c["id"] == "T11")["expect"]
        self.assertFalse(want["accepted"])  # ...and the vector says it must not.


class TestTies(unittest.TestCase):
    def test_statuses_equal_the_shipped_schema(self):
        schema = json.loads((REPO / "template" / "engine" / "schemas" / "task.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(list(REF.STATUSES), schema["properties"]["status"]["enum"])

    def test_seal_fact_fields_equal_the_protocol_table(self):
        protocol = (REPO / "gateway" / "write" / "docs" / "protocol.md").read_text(encoding="utf-8")
        section = protocol.split("#### 10.4.1 The task-state fact", 1)[1].split("The operator channel is **not**", 1)[0]
        rows = re.findall(r"^\| `([a-z_]+)`(?:, `([a-z_]+)`)? \|", section, re.M)
        documented = {name for row in rows for name in row if name}
        self.assertEqual(documented | {"ok"}, set(REF.SEAL_FACT_FIELDS))

    def test_vector_facts_use_exactly_the_documented_fields(self):
        for case in VECTORS:
            fact = case["request"].get("seal_fact")
            if isinstance(fact, dict):
                with self.subTest(case=case["id"]):
                    self.assertEqual(set(fact), set(REF.SEAL_FACT_FIELDS))

    def test_the_contract_document_names_every_code(self):
        doc = (REPO / "docs" / "release" / "TASK-STATE-TRANSITION-CONTRACT.md").read_text(encoding="utf-8")
        for code, http in REF.CODES.items():
            self.assertIn("`%s`" % code, doc)
            self.assertRegex(doc, r"`%s`[^\n]*\b%d\b" % (code, http))


if __name__ == "__main__":
    unittest.main()
