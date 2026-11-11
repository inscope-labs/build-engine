#!/usr/bin/env python3
"""ops/test_verify_write_credential_scope.py: the credential-scope verdict, on fixed inputs.

    python3 -m unittest discover -s ops -p 'test_*.py'
"""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "verify_scope", Path(__file__).resolve().parent / "verify-write-credential-scope.py"
)
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)

EXPECTED = "acme/dev"
CONSUMER = "acme/public"


def repo(name, private=False):
    return {"full_name": name, "private": private}


def run(repos, probes):
    return verify.evaluate(repos, EXPECTED, CONSUMER, probes)


class Classify(unittest.TestCase):
    def test_validation_and_empty_repository_answers_mean_the_credential_may_write(self):
        self.assertTrue(verify.classify(422))
        self.assertTrue(verify.classify(409))

    def test_refusals_mean_it_may_not(self):
        for status in (401, 403, 404):
            self.assertFalse(verify.classify(status))

    def test_any_other_answer_is_not_an_answer(self):
        for status in (200, 201, 429, 500, 502):
            with self.assertRaises(ValueError):
                verify.classify(status)

    def test_the_probe_cannot_create_a_reference(self):
        self.assertNotIn("/", verify.PROBE_BODY["ref"].removeprefix("refs/"))
        self.assertEqual(verify.PROBE_BODY["sha"], "0" * 40)


class Verdict(unittest.TestCase):
    def test_a_credential_limited_to_the_submissions_repository_passes(self):
        problems, _ = run([repo(EXPECTED, True), repo(CONSUMER), repo("acme/other")],
                          {EXPECTED: 422, CONSUMER: 403, "acme/other": 403})
        self.assertEqual(problems, [])

    def test_public_repositories_that_refuse_writes_are_not_a_problem(self):
        repos = [repo(EXPECTED, True)] + [repo(f"acme/public-{i}") for i in range(30)]
        probes = {EXPECTED: 422, CONSUMER: 404, **{f"acme/public-{i}": 403 for i in range(30)}}
        problems, evidence = run(repos, probes)
        self.assertEqual(problems, [])
        self.assertEqual(evidence["other_writable"], 0)

    def test_an_empty_consumer_that_accepts_writes_fails(self):
        problems, _ = run([repo(EXPECTED, True), repo(CONSUMER)], {EXPECTED: 422, CONSUMER: 409})
        self.assertTrue(any("consumer" in p for p in problems))

    def test_no_write_on_the_submissions_repository_fails(self):
        problems, _ = run([repo(CONSUMER)], {EXPECTED: 404, CONSUMER: 403})
        self.assertTrue(any("submissions repository" in p for p in problems))

    def test_a_submissions_repository_that_is_not_listed_but_is_writable_passes(self):
        problems, _ = run([repo(CONSUMER)], {EXPECTED: 422, CONSUMER: 403})
        self.assertEqual(problems, [])

    def test_another_writable_repository_fails(self):
        problems, _ = run([repo(EXPECTED, True), repo("acme/other")], {EXPECTED: 422, CONSUMER: 403, "acme/other": 422})
        self.assertTrue(any("accept writes" in p for p in problems))

    def test_another_private_repository_fails(self):
        problems, _ = run([repo(EXPECTED, True), repo("acme/secret", True)],
                          {EXPECTED: 422, CONSUMER: 403, "acme/secret": 403})
        self.assertTrue(any("private" in p for p in problems))

    def test_an_unexpected_probe_answer_is_an_error_not_a_pass(self):
        with self.assertRaises(ValueError):
            run([repo(EXPECTED, True)], {EXPECTED: 422, CONSUMER: 500})

    def test_the_names_of_other_repositories_are_not_in_the_evidence(self):
        _, evidence = run([repo(EXPECTED, True), repo("acme/secret", True)],
                          {EXPECTED: 422, CONSUMER: 403, "acme/secret": 403})
        self.assertNotIn("acme/secret", str(evidence))

    def test_the_expected_repository_is_read_from_the_gateway_configuration(self):
        self.assertRegex(verify.expected_repository(), r"^[^/]+/[^/]+$")


if __name__ == "__main__":
    unittest.main()
