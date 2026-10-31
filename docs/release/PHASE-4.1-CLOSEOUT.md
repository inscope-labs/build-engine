BUILD ENGINE — STAGE 4.1 CLOSEOUT (conformance foundation)
Repository: https://github.com/inscope-labs/build-engine
Date: 2026-10-26
Version: 0.5.0
Plan stage: RELEASE-PLAN.md Phase 4, Stage 4.1 (conformance foundation)

STATUS: STAGE 4.1 IS COMPLETE. The conformance suite exists, is executable, and is wired into CI.
The production read gateway (Stage 4.2) has not been started; this stage only built the thing that
will judge it.

WHAT STAGE 4.1 ASKED FOR, AND WHAT EXISTS NOW

  4.1.1  Complete conformance/signing-vectors.json, including the ASCII and non-ASCII/space cases.
         DONE. 17 valid vectors and 19 invalid inputs. The published vector (V01) is unchanged, and
         the vector with a space and a non-ASCII character (V02) that used to live only in
         template/engine/tools/test_ctxlink.py is now in the shared file.

  4.1.2  Specify canonical UTF-8 message construction, HMAC-SHA256, base64url without padding, path
         normalization, key IDs, expiry and order binding.
         DONE. conformance/SCHEME.md is the normative description. It also states the things that
         were previously only implied by the code: that there is no Unicode normalisation, that a
         path component may contain ".." as a substring, that the verifier percent-decodes and never
         form-decodes, and that the order of the verification checks is part of the scheme.

  4.1.3  Build an executable harness for signer and gateway implementations.
         DONE. conformance/harness/run.py drives any gateway over plain HTTP and any signer over a
         small JSON-lines contract (conformance/harness/signer_adapter.py is a worked example). It
         imposes no runtime on a port: a port in any language is driven the same way.

  4.1.4  Turn behaviours B1-B11 into executable cases.
         DONE for B1-B10 (conformance/cases/behaviours.json, 53 cases) and B11 (the signing vectors).

  4.1.5  Ensure the Python client and reference gateway pass the same shared vectors and tests.
         DONE. conformance/test_conformance.py is the CI gate; it fails if the shipped client and
         the shared vectors disagree, if the reference gateway fails a shared case, if the published
         vector drifts from the two other places it is quoted, or if a behaviour loses its coverage.

WHAT WAS FOUND AND FIXED
  F0-024  A context path could contain control characters. The path rule is now written normatively
          and ctxlink.safe_path() was tightened to match. The rule is a strict subset of what was
          accepted before, so no legitimate link is affected.
  F0-025  The scheme had no written normative description at all. That is what this stage was for.

WHAT THE SUITE IS WORTH
  A suite that cannot fail proves nothing, so the suite was checked against deliberate breakage of
  the reference gateway. Thirteen defects were injected one at a time and every one is caught by a
  named case: an off-by-one in the expiry comparison, a path check written as a substring glob, the
  signature check moved after the expiry check, refusal bodies that differ per reason, the
  allow-prefix ignored, the pinned commit ignored, the TTL check disabled, the revocation check
  disabled, the size limit disabled, a wrong hash header, POST allowed, the audit path dropped, and
  a file that exists only after the pinned commit served anyway.

  Three of those thirteen were NOT caught by the first version of the suite and were added as cases
  afterwards: the signature-check ordering, the canonical form of the URL, and the pinning of the
  content to the named commit. They are recorded here because the point of a conformance suite is
  that it is checked, not that it exists.

CHANGES OUTSIDE conformance/
  template/engine/tools/ctxlink.py        safe_path() now refuses control characters (F0-024)
  template/engine/tools/test_ctxlink.py   three new shipped tests for the path rules
  gateway/read/reference/ctxgate.py        the test clock (CTXGATE_TEST_CLOCK + X-Conformance-Now),
                                          inert unless the switch is set, and the 15 existing tests
                                          now cite the behaviour IDs they cover
  .github/workflows/ci.yml                 two new steps: the conformance suite and the harness

WHAT THIS STAGE DOES NOT ESTABLISH
  Nothing about the production gateway. It has no code. The suite is ready to judge it: Stage 4.2
  must pass conformance/harness/run.py against the deployed port, and the port's signer must be
  driven through the adapter contract rather than a bespoke test.
  The test clock is a test-mode switch. A production deployment must not set CTXGATE_TEST_CLOCK.
  The conformance suite is a development asset and is not shipped to consumers; release/manifest.txt
  does not allowlist it, and test_conformance.py asserts that it does not.
