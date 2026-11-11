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


def repo(name, private=False, push=False, admin=False):
    return {"full_name": name, "private": private, "permissions": {"push": push, "admin": admin}}


class Verdict(unittest.TestCase):
    def test_exactly_the_submissions_repository_passes(self):
        problems, _ = verify.evaluate([repo(EXPECTED, True, push=True)], EXPECTED, CONSUMER)
        self.assertEqual(problems, [])

    def test_a_read_only_public_consumer_is_allowed(self):
        repos = [repo(EXPECTED, True, push=True), repo(CONSUMER, False)]
        problems, evidence = verify.evaluate(repos, EXPECTED, CONSUMER)
        self.assertEqual(problems, [])
        self.assertTrue(evidence["consumer_listed"])
        self.assertFalse(evidence["consumer_write"])

    def test_write_on_the_consumer_fails(self):
        repos = [repo(EXPECTED, True, push=True), repo(CONSUMER, False, push=True)]
        problems, _ = verify.evaluate(repos, EXPECTED, CONSUMER)
        self.assertTrue(any("consumer" in p for p in problems))

    def test_missing_submissions_repository_fails(self):
        problems, _ = verify.evaluate([repo(CONSUMER)], EXPECTED, CONSUMER)
        self.assertTrue(any("not in" in p for p in problems))

    def test_no_push_on_the_submissions_repository_fails(self):
        problems, _ = verify.evaluate([repo(EXPECTED, True, push=False)], EXPECTED, CONSUMER)
        self.assertTrue(any("cannot push" in p for p in problems))

    def test_another_writable_repository_fails(self):
        repos = [repo(EXPECTED, True, push=True), repo("acme/other", False, push=True)]
        problems, _ = verify.evaluate(repos, EXPECTED, CONSUMER)
        self.assertTrue(any("write rights" in p for p in problems))

    def test_another_private_repository_fails(self):
        repos = [repo(EXPECTED, True, push=True), repo("acme/secret", True)]
        problems, _ = verify.evaluate(repos, EXPECTED, CONSUMER)
        self.assertTrue(any("private" in p for p in problems))

    def test_the_names_of_other_repositories_are_not_in_the_evidence(self):
        repos = [repo(EXPECTED, True, push=True), repo("acme/secret", True)]
        _, evidence = verify.evaluate(repos, EXPECTED, CONSUMER)
        self.assertNotIn("acme/secret", str(evidence))

    def test_the_expected_repository_is_read_from_the_gateway_configuration(self):
        self.assertRegex(verify.expected_repository(), r"^[^/]+/[^/]+$")


if __name__ == "__main__":
    unittest.main()
