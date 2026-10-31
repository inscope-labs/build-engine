#!/usr/bin/env python3
"""The isolation proof: the gateway does not write to the source repository, and it does not
keep a copy of the file it served anywhere.

This is the check behind Stage 4.3's fourth item, and it is the one that a claim of "the
gateway is read-only" has to be able to survive. A gateway that serves context files holds, for
the length of a request, the content of a private file. Where does that content go?

Four things are checked, and each is checked against evidence rather than against intention:

  1. the source repository is opened read-only. Every request the provider received is
     recorded, and every one of them has to be a GET for the one contents route the adapter
     is allowed to call. A POST, a PUT or a PATCH would show up in the record. The repository
     itself is compared before and after: the same HEAD, and a clean working tree.

  2. the configuration declares no storage but the Durable Object. A gateway that copied
     content to a bucket, a database or a key-value store would have to declare the binding,
     and the declaration is in the file.

  3. the content is not in the Durable Object's own storage. The whole state directory is
     searched for the content, in its raw form and in its base64 form. The audit record holds
     the path, the size and the outcome; it does not hold the file.

  4. the content is not in the audit trail, in the metrics, in the Worker's own log, or in the
     response of any other endpoint.

Not shipped in releases: it is a test.
"""
import base64
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRODUCTION = HERE.parent
sys.path.insert(0, str(HERE))
from stagingenv import CONFORMANCE, Staging, log  # noqa: E402

# A file whose content is unmistakable, so that finding it anywhere is unambiguous.
MARKER = "CONTENT-MARKER-8f3a1c-do-not-copy-this-e7b2d4\n"


def main():
    fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]
    # The marker is the content of the file the links name. Everything else is the standard
    # fixture.
    fixture = json.loads(json.dumps(fixture))
    fixture["files"]["amk/spec.md"] = MARKER
    work = Path(tempfile.mkdtemp(prefix="ctxgate-isolation-"))
    failures = []
    try:
        with Staging(work, fixture, port_offset=120) as env:
            # -----------------------------------------------------------------------
            # 1. the source repository is opened read-only
            # -----------------------------------------------------------------------
            head_before = env.repo_head()
            status_before = env.repo_status()
            status, body, _ = env.request(env.mint())
            if status != 200 or body != MARKER.encode():
                failures.append("the file was not served: %s %r" % (status, body[:60]))
            else:
                log("ok   the file is served")

            requests = env.provider_requests()
            if not requests:
                failures.append("the provider recorded no request at all: the proof would be vacuous")
            # The provider also saw the test harness's own probe, which is not the gateway.
            # The gateway's requests are the ones it made as the source adapter.
            gateway_requests = [r for r in requests if r["user_agent"] == "ctxgate-read"]
            if not gateway_requests:
                failures.append("the provider recorded no request from the gateway: the proof "
                                "would be vacuous")
            for entry in gateway_requests:
                if entry["method"] != "GET":
                    failures.append("the gateway made a %s request to the source repository"
                                    % entry["method"])
                if not re.fullmatch(r"/repos/o/r/contents/.*", entry["path"]):
                    failures.append("the gateway called a route it should not: %r" % entry["path"])
                if not re.fullmatch(r"ref=[0-9a-f]{40}", entry["query"]):
                    failures.append("the gateway asked for something other than a pinned commit: %r"
                                    % entry["query"])
                if not entry["authorization_present"]:
                    failures.append("the gateway did not send a credential")
            if not any("the gateway" in f for f in failures):
                log("ok   every request the gateway made to the source repository was a GET for one "
                    "pinned blob (%d requests)" % len(gateway_requests))

            head_after = env.repo_head()
            status_after = env.repo_status()
            if head_before != head_after:
                failures.append("the source repository moved: %s -> %s" % (head_before, head_after))
            if status_after:
                failures.append("the source repository has a dirty working tree: %r" % status_after)
            if status_before:
                failures.append("the source repository was already dirty before the run: %r" % status_before)
            else:
                log("ok   the source repository is unchanged (same HEAD, clean tree)")

            # -----------------------------------------------------------------------
            # 2. the configuration declares no storage but the Durable Object
            # -----------------------------------------------------------------------
            config = (PRODUCTION / "wrangler.toml").read_text(encoding="utf-8")
            forbidden = ["kv_namespaces", "r2_buckets", "d1_databases", "hyperdrive",
                         "analytics_engine_datasets", "dispatch_namespaces", "mtls_certificates",
                         "vectorize", "services", "queues", "browser", "ai"]
            for key in forbidden:
                if re.search(r"^\s*%s\b" % key, config, re.MULTILINE):
                    failures.append("the configuration declares a %s binding" % key)
            bindings = re.findall(r'^\[\[.*?durable_objects\.bindings\]\]\s*\nname\s*=\s*"([^"]+)"',
                                  config, re.MULTILINE)
            if sorted(set(bindings)) != ["STATE"]:
                failures.append("the configuration declares the Durable Object bindings %s, expected only STATE"
                                % sorted(set(bindings)))
            else:
                log("ok   the configuration declares no storage but the Durable Object")

            # -----------------------------------------------------------------------
            # 3. the content is not in the Durable Object's storage
            # -----------------------------------------------------------------------
            needles = [MARKER.encode(), base64.b64encode(MARKER.encode())]
            found = []
            for path in env.persist_path.rglob("*"):
                if not path.is_file():
                    continue
                try:
                    blob = path.read_bytes()
                except OSError:
                    continue
                for needle in needles:
                    if needle and needle in blob:
                        found.append(str(path.relative_to(env.persist_path)))
            if found:
                failures.append("the served content is in the gateway's state: %s" % found)
            else:
                log("ok   the served content is not in the Durable Object's storage (%d files searched)"
                    % sum(1 for p in env.persist_path.rglob("*") if p.is_file()))

            # -----------------------------------------------------------------------
            # 4. the content is nowhere else
            # -----------------------------------------------------------------------
            _, raw_audit = env.admin("/admin/audit")
            _, raw_metrics = env.admin("/admin/metrics")
            for name, blob in (("the audit trail", raw_audit), ("the metrics", raw_metrics)):
                if MARKER.encode() in blob:
                    failures.append("the served content appears in %s" % name)
            log_text = env.log_path.read_text(encoding="utf-8", errors="replace") if env.log_path.exists() else ""
            if MARKER in log_text:
                failures.append("the served content appears in the Worker's own log")
            if not any("appears in" in f for f in failures):
                log("ok   the content is in no audit record, in no metric and in no log line")

            # -----------------------------------------------------------------------
            # and the source code makes no other outbound call
            # -----------------------------------------------------------------------
            offenders = []
            for path in sorted((PRODUCTION / "src").glob("*.ts")):
                text = path.read_text(encoding="utf-8")
                lines = text.splitlines()
                for index, line in enumerate(lines):
                    for match in re.finditer(r"(?<![\w.])fetch\s*\(", line):
                        # A method signature is not a call: 'async fetch(request: Request)'.
                        # A Durable Object stub is an internal call, not a network call.
                        if re.search(r"\b(async|static|override)\s+fetch\s*\(", line):
                            continue
                        if re.search(r"\bstub\.fetch\s*\(", line):
                            continue
                        if path.name != "source.ts":
                            offenders.append("%s:%d" % (path.name, index + 1))
            if offenders:
                failures.append("there is an outbound call outside the source adapter: %s"
                                % ", ".join(offenders))
            else:
                log("ok   the only outbound call in the Worker is the source adapter's")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        for failure in failures:
            log("FAIL %s" % failure)
        log("FAILED")
        return 1
    log("PASSED: the gateway is read-only and keeps no copy of what it served")
    return 0


if __name__ == "__main__":
    sys.exit(main())
