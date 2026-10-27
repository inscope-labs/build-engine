#!/usr/bin/env python3
"""The operational checks of the read gateway, on the staging platform.

The conformance suite judges the SCHEME: the link format, the signature, the expiry, the
refusal rules. It says nothing about how the gateway behaves as a deployed service, which is
what this file is for. Everything here is about the gateway running rather than about the link
being valid.

  - a cold start: the Worker comes up with no state and serves the first request;
  - provider failures: the source API errors, refuses the credential, rate-limits, times out
    or cannot be reached at all, and the gateway maps each of them without serving anything;
  - an unavailable source repository: the repository is gone;
  - expiry: a link past its expiry is refused, and a deployed configuration cannot have its
    expiry extended by a request header;
  - a revoked order: the revoke takes effect, and it stays in effect;
  - key rotation: a second key id is added and an old one is retired, without an outage and
    without losing the revocation set.

The exit gate of Phase 4 is checked here too, because these are the only claims that need a
running gateway: a Class B agent fetches the intended file and nothing else, revocation takes
effect within a documented bound, and the audit trail holds no capability secret.

This runs the Worker on the local Cloudflare Workers runtime - the same runtime, the same code
and the same Durable Object as a deployment. It is NOT a deployment: no environment has been
published, and nothing here is evidence about a running Cloudflare environment. The pilot
(Stage 6) is what will be.

Not shipped in releases: it is a test.
"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from stagingenv import CONFORMANCE, Staging, log  # noqa: E402

# The bound the revocation has to take effect within. The gateway holds the revocation set in
# the Durable Object, so it is the next request, not the next cache refresh. The bound is
# asserted, not assumed: the check below measures the real time and fails if it is exceeded.
REVOCATION_BOUND_SECONDS = 2.0

# A cold start has to be quick enough to be operable. The runtime takes a second or two.
COLD_START_BOUND_SECONDS = 60.0


def main():
    fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]
    work = Path(tempfile.mkdtemp(prefix="ctxgate-staging-"))
    failures = []
    try:
        with Staging(work, fixture, port_offset=80) as env:
            log("worker is up: %s" % json.dumps(env.health))

            # -----------------------------------------------------------------------
            # 1. the cold start, and the file the link names
            # -----------------------------------------------------------------------
            started = time.time()
            status, body, headers = env.request(env.mint())
            cold = time.time() - started
            if status != 200:
                failures.append("the first request after a cold start returned %s, expected 200" % status)
            elif body != b"normative text\n":
                failures.append("the served content is not the content of the pinned commit: %r" % body)
            elif cold > COLD_START_BOUND_SECONDS:
                failures.append("the cold start took %.1fs, more than the %.0fs bound"
                                % (cold, COLD_START_BOUND_SECONDS))
            else:
                log("ok   a cold start serves the intended file in %.2fs (%d bytes)"
                    % (cold, len(body)))

            # The pin is the point of the scheme: the file was revised in a later commit, and
            # the link is pinned to the first one.
            later = env.mint(ref=env.repo_head())
            status, body, _ = env.request(later)
            if status != 200 or body != b"REVISED normative text\n":
                failures.append("a link pinned to the later commit did not serve the later content: %s %r"
                                % (status, body))
            else:
                log("ok   a link pinned to another commit serves that commit's content")

            # The response says what it is, and asks nobody to cache it.
            _, _, headers = env.request(env.mint())
            if "no-store" not in headers.get("Cache-Control", ""):
                failures.append("the response does not forbid caching: %r" % headers.get("Cache-Control"))
            elif "nosniff" not in headers.get("X-Content-Type-Options", ""):
                failures.append("the response does not set nosniff")
            elif not headers.get("X-Content-SHA256"):
                failures.append("the response carries no content digest")
            else:
                log("ok   the response is no-store, nosniff and carries a digest")

            # -----------------------------------------------------------------------
            # 2. only the intended file, and nothing adjacent
            # -----------------------------------------------------------------------
            # A path outside the allowed prefix.
            status, _, _ = env.request(env.mint(path="docs/other.md"))
            if status != 403:
                failures.append("a file outside the allowed prefix was answered with %s, expected 403" % status)
            # A path the deny list names, inside the allowed prefix.
            status, _, _ = env.request(env.mint(path="amk/secrets.md"))
            if status != 403:
                failures.append("a file the deny list names was answered with %s, expected 403" % status)
            # A file that does not exist.
            status, _, _ = env.request(env.mint(path="amk/never-existed.md"))
            if status != 404:
                failures.append("a file that does not exist was answered with %s, expected 404" % status)
            # A path that has been tampered with: the signature binds the path.
            link = env.mint()
            status, _, _ = env.request(link.replace("/amk/spec.md", "/amk/dir%20with%20space/%C3%A9.md"))
            if status != 403:
                failures.append("a tampered path was answered with %s, expected 403" % status)
            # A path whose encoding is unusual but legal: a space, an accent, a plus.
            for path, expected in (("amk/dir with space/é.md", b"accented\n"),
                                   ("amk/a+b.md", b"plus in the name\n")):
                status, body, _ = env.request(env.mint(path=path))
                if status != 200 or body != expected:
                    failures.append("the path %r was answered with %s %r, expected 200 %r"
                                    % (path, status, body, expected))
            if not failures:
                log("ok   only the named file is served: neighbours, denied names, missing files "
                    "and tampered paths are all refused, and unusual but legal paths work")

            # -----------------------------------------------------------------------
            # 3. expiry, and the test clock that must not be on in a deployment
            # -----------------------------------------------------------------------
            expired = env.mint(exp=int(time.time()) - 3600)
            status, _, _ = env.request(expired)
            if status != 403:
                failures.append("an expired link was answered with %s, expected 403" % status)
            # With the conformance clock off, the override header is ignored. A deployment
            # that has the switch on would let a caller extend the life of an expired link.
            status, _, _ = env.request(expired, headers={"X-Conformance-Now": str(int(time.time()) + 3600)})
            if status != 403:
                failures.append("the X-Conformance-Now header extended an expired link in a "
                                "configuration without the test clock: %s" % status)
            if env.health.get("conformance_clock"):
                failures.append("the conformance clock is on in this configuration")
            else:
                log("ok   an expired link is refused, and X-Conformance-Now cannot extend it")

            # -----------------------------------------------------------------------
            # 4. the provider fails
            # -----------------------------------------------------------------------
            link = env.mint()
            expectations = [
                ("server-error", 502, "upstream-error"),
                ("unauthorized", 502, "upstream-unauthorized"),
                ("rate-limited", 503, "upstream-rate-limited"),
                ("unreachable", 502, "upstream-error"),
                ("slow", 504, "upstream-timeout"),
                ("repository-missing", 404, "not-found"),
            ]
            for mode, expected_status, expected_reason in expectations:
                env.set_provider_mode(mode)
                status, body, _ = env.request(link)
                if status != expected_status:
                    failures.append("the provider in mode %r was answered with %s, expected %s"
                                    % (mode, status, expected_status))
                elif b"normative text" in body:
                    failures.append("the provider in mode %r still served the content" % mode)
                else:
                    log("ok   the provider in mode %r is answered with %s" % (mode, expected_status))
            env.set_provider_mode("ok")
            status, body, _ = env.request(link)
            if status != 200 or body != b"normative text\n":
                failures.append("the gateway did not recover when the provider came back: %s" % status)
            else:
                log("ok   the gateway serves again once the provider recovers")

            # The audit trail says what happened, and says nothing it should not.
            status, raw = env.admin("/admin/audit")
            records = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
            reasons = {r["reason"] for r in records}
            for wanted in ("upstream-error", "upstream-timeout", "upstream-unauthorized",
                           "upstream-rate-limited", "expired", "path-denied", "not-found"):
                if wanted not in reasons:
                    failures.append("the audit trail has no %r record: %s" % (wanted, sorted(reasons)))
            blob = json.dumps(records)
            if "test-secret" in blob:
                failures.append("the signing secret appears in the audit trail")
            if "local-staging-token" in blob:
                failures.append("the repository credential appears in the audit trail")
            if "normative text" in blob:
                failures.append("the file content appears in the audit trail")
            if not all(r.get("request_id") for r in records):
                failures.append("an audit record has no request id")
            log("ok   the audit trail records the outcomes without leaking (%d records)" % len(records))

            # The metrics count and disclose nothing.
            status, raw = env.admin("/admin/metrics")
            metrics = json.loads(raw)
            for leak in ("10008-S001", "amk/spec.md", "k1", "test-secret"):
                if leak in json.dumps(metrics):
                    failures.append("the metrics endpoint discloses %r" % leak)
            else:
                log("ok   the metrics endpoint counts without disclosing")

            # -----------------------------------------------------------------------
            # 5. revocation
            # -----------------------------------------------------------------------
            revoked_order = "10008-S700"
            link = env.mint(order=revoked_order)
            status, _, _ = env.request(link)
            if status != 200:
                failures.append("a live link was answered with %s before the revoke" % status)
            revoked_at = time.time()
            status, body = env.admin("/admin/revoke", method="POST", body={"order": revoked_order})
            if status != 200:
                failures.append("the revoke was answered with %s" % status)
            status, _, _ = env.request(link)
            took = time.time() - revoked_at
            if status != 403:
                failures.append("a revoked order was answered with %s, expected 403" % status)
            elif took > REVOCATION_BOUND_SECONDS:
                failures.append("the revocation took %.2fs to take effect, more than the %.0fs bound"
                                % (took, REVOCATION_BOUND_SECONDS))
            else:
                log("ok   a revoked order is refused %.0fms after the revoke, inside the %.0fs bound"
                    % (took * 1000, REVOCATION_BOUND_SECONDS))

            # The revocation survives a restart: it lives in the Durable Object, not in a cache
            # and not in the Worker process.
            env.restart()
            status, _, _ = env.request(link)
            if status != 403:
                failures.append("a revoked order was served after a restart: %s" % status)
            else:
                log("ok   a revoked order is still revoked after the Worker restarts")

            # -----------------------------------------------------------------------
            # 6. key rotation
            # -----------------------------------------------------------------------
            # A key id the gateway does not know is refused before anything else happens.
            status, _, _ = env.request(env.mint(kid="k2", secret="rotated-secret"))
            if status != 403:
                failures.append("a link under an unknown key id was answered with %s, expected 403" % status)
            # Add the new key id: both work, so the rotation needs no outage.
            env.restart(keys={"k1": "test-secret", "k2": "rotated-secret"})
            for kid, secret in (("k1", "test-secret"), ("k2", "rotated-secret")):
                status, _, _ = env.request(env.mint(kid=kid, secret=secret))
                if status != 200:
                    failures.append("a link under the key id %r was answered with %s during the rotation"
                                    % (kid, status))
            # Retire the old key id: its links stop working, the new one does not.
            env.restart(keys={"k2": "rotated-secret"})
            status, _, _ = env.request(env.mint(kid="k1", secret="test-secret"))
            if status != 403:
                failures.append("a link under the retired key id was answered with %s, expected 403" % status)
            status, _, _ = env.request(env.mint(kid="k2", secret="rotated-secret"))
            if status != 200:
                failures.append("a link under the new key id was answered with %s after the rotation" % status)
            # The revocation set survived the rotation.
            status, _, _ = env.request(env.mint(order=revoked_order, kid="k2", secret="rotated-secret"))
            if status != 403:
                failures.append("a revoked order was served after the key rotation: %s" % status)
            else:
                log("ok   a key rotation needs no outage, retires the old key id, and keeps the "
                    "revocation set")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        for failure in failures:
            log("FAIL %s" % failure)
        log("FAILED")
        return 1
    log("PASSED: the gateway behaves as a deployed service")
    return 0


if __name__ == "__main__":
    sys.exit(main())
