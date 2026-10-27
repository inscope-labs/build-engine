#!/usr/bin/env python3
"""conformance harness - drive any implementation of the ctxgate-v1 scheme against the shared suite.

Two things are checked:

  vectors   every valid vector in conformance/signing-vectors.json is reproduced byte for byte, and
            every invalid input in it is rejected.                                     (behaviour B11)

  cases     every case in conformance/cases/behaviours.json is executed against a gateway over
            plain HTTP.                                                                (behaviours B1-B10)

The harness speaks the protocol, not an implementation, so it does not care what language the gateway
or the signer is written in:

  * a gateway is any base URL that serves the link format. Run it yourself, or use --reference to
    boot the proof-of-concept gateway in this repository.
  * a signer is either the shipped Python client (the default) or any program that implements the
    JSON-lines contract in conformance/SCHEME.md section 11. See signer_adapter.py for a worked
    example.

Usage:
  run.py vectors                      check the shipped client against the signing vectors
  run.py cases --reference            boot the reference gateway and run B1-B10 against it
  run.py cases --gateway URL          run B1-B10 against a gateway that is already running
  run.py all --reference              both of the above

  --signer CMD        use an external signer (JSON-lines), default: the shipped client
  --ref SHA           the commit the gateway serves from (external gateways only)
  --audit-log PATH    the gateway's audit log (external gateways only, needed by the B10 cases)
  --json FILE         write a machine-readable report
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFORMANCE = HERE.parent
REPO = CONFORMANCE.parent
UNRESERVED = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~")


# --------------------------------------------------------------------------- signers
def encode_segment(seg):
    out = []
    for b in seg.encode("utf-8"):
        c = chr(b)
        out.append(c if c in UNRESERVED else "%%%02X" % b)
    return "".join(out)


def encode_path(path):
    return "/".join(encode_segment(s) for s in path.split("/"))


def url_path(kid, exp, order, sig, ref, path):
    return "/v1/%s/%d/%s/%s/%s/%s" % (kid, exp, order, sig, ref, encode_path(path))


class SignerError(Exception):
    pass


class PythonSigner:
    """The shipped client: template/engine/tools/ctxlink.py."""

    name = "shipped client (template/engine/tools/ctxlink.py)"

    def __init__(self):
        sys.path.insert(0, str(REPO / "template" / "engine" / "tools"))
        import ctxlink as cg
        self.cg = cg

    def mint(self, secret, kid, exp, order, ref, path):
        cg = self.cg
        if not cg.KID_RE.match(kid):
            raise SignerError("bad kid")
        if not cg.ORDER_RE.match(order):
            raise SignerError("bad order")
        if not cg.REF_RE.match(ref):
            raise SignerError("bad ref")
        if not cg.safe_path(path):
            raise SignerError("unsafe path")
        sig = cg.sign(secret.encode("utf-8") if isinstance(secret, str) else secret, kid, exp, order, ref, path)
        return sig, url_path(kid, exp, order, sig, ref, path)


class ExternalSigner:
    """Any program implementing the JSON-lines signer contract (SCHEME.md section 11)."""

    def __init__(self, command):
        self.name = command
        self.proc = subprocess.Popen(command, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, bufsize=1)

    def mint(self, secret, kid, exp, order, ref, path):
        req = {"op": "mint", "secret": secret, "kid": kid, "exp": exp, "order": order, "ref": ref, "path": path}
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise SignerError("signer exited without answering")
        try:
            resp = json.loads(line)
        except ValueError as e:
            raise SignerError("signer did not answer with JSON: %s" % e)
        if "error" in resp:
            raise SignerError(str(resp["error"]))
        if "signature" not in resp or "url_path" not in resp:
            raise SignerError("signer answered without signature and url_path")
        return resp["signature"], resp["url_path"]


# --------------------------------------------------------------------------- gateway backends
class ReferenceGateway:
    """Boots gateway/read/reference/ctxgate.py in this process, over real HTTP, against a scratch repo."""

    def __init__(self, fixture):
        self.fixture = fixture
        self.tmp = Path(tempfile.mkdtemp(prefix="ctxgate-conformance-"))
        self.repo = self.tmp / "repo"
        self.audit = self.tmp / "audit.jsonl"
        self.revoked = self.tmp / "revoked.json"
        self.srv = None
        self.ref = None

    def _git(self, *args):
        env = dict(os.environ, GIT_AUTHOR_NAME="conformance", GIT_AUTHOR_EMAIL="conformance@example.invalid",
                   GIT_COMMITTER_NAME="conformance", GIT_COMMITTER_EMAIL="conformance@example.invalid")
        return subprocess.run(["git", "-C", str(self.repo)] + list(args), check=True, capture_output=True,
                              text=True, env=env).stdout.strip()

    def _write(self, files):
        for rel, content in files.items():
            p = self.repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, dict):
                p.write_text(content["repeat"] * content["count"], encoding="utf-8")
            else:
                p.write_text(content, encoding="utf-8")

    def start(self):
        sys.path.insert(0, str(REPO / "gateway" / "read" / "reference"))
        sys.path.insert(0, str(REPO / "template" / "engine" / "tools"))
        import ctxgate as cg

        self.repo.mkdir(parents=True)
        self._git("init", "-q", "-b", "main")
        self._write(self.fixture["files"])
        self._git("add", "-A")
        self._git("commit", "-qm", "conformance fixture")
        # the pinned commit is the FIRST one. A second commit on top of it proves that a link
        # serves the content of the commit it names, not whatever the branch points at now.
        self.ref = self._git("rev-parse", "HEAD")
        if self.fixture.get("later_files"):
            self._write(self.fixture["later_files"])
            self._git("add", "-A")
            self._git("commit", "-qm", "later commit")
        self.head = self._git("rev-parse", "HEAD")
        self.revoked.write_text(json.dumps(list(self.fixture.get("revoked_orders", []))), encoding="utf-8")

        gw = cg.Gateway(self.fixture["keys"], cg.GitSource(self.repo, self.fixture["max_bytes"]),
                         allow_prefixes=tuple(self.fixture.get("allow_prefixes", [""])),
                         max_bytes=self.fixture["max_bytes"], max_ttl=self.fixture["max_ttl"],
                         clock_skew_tolerance=self.fixture.get("clock_skew_tolerance", 0),
                         audit_path=str(self.audit), revoked_path=str(self.revoked))
        self.srv = cg.make_server(gw, "127.0.0.1", 0)
        self.base_url = "http://127.0.0.1:%d" % self.srv.server_address[1]
        import threading
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        return self.base_url

    def stop(self):
        if self.srv is not None:
            self.srv.shutdown()
            self.srv.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fetch_health(self):
        status, headers, body = http_request(self.base_url, "/healthz", "GET")
        if status != 200:
            raise RuntimeError("the gateway has no usable /healthz endpoint (HTTP %s)" % status)
        return json.loads(body.decode("utf-8"))

    def read_audit(self):
        if not self.audit.exists():
            return None
        return [json.loads(l) for l in self.audit.read_text(encoding="utf-8").splitlines() if l.strip()]


class HttpGateway:
    def __init__(self, base_url, ref, audit_log):
        self.base_url = base_url.rstrip("/")
        self.ref = ref
        self.audit_log = audit_log
        self.audit_url = None
        self.admin_token = None

    def start(self):
        return self.base_url

    def stop(self):
        pass

    def fetch_health(self):
        status, headers, body = http_request(self.base_url, "/healthz", "GET")
        if status != 200:
            raise RuntimeError("the gateway has no usable /healthz endpoint (HTTP %s)" % status)
        return json.loads(body.decode("utf-8"))

    def read_audit(self):
        """The audit trail, as a list of records."""
        if self.audit_url:
            req = urllib.request.Request(self.audit_url)
            if self.admin_token:
                req.add_header("Authorization", "Bearer " + self.admin_token)
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8")
            text = text.strip()
            if text.startswith("["):
                return json.loads(text)
            return [json.loads(l) for l in text.splitlines() if l.strip()]
        path = self.audit_log
        if not path or not Path(path).exists():
            return None
        return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


# --------------------------------------------------------------------------- the runner
class Report:
    def __init__(self):
        self.results = []

    def add(self, name, ok, detail=""):
        self.results.append({"name": name, "ok": bool(ok), "detail": detail})
        print("  %s %s%s" % ("ok  " if ok else "FAIL", name, ("  -- " + detail) if (detail and not ok) else ""))
        return ok

    @property
    def failed(self):
        return [r for r in self.results if not r["ok"]]


def http_request(base_url, path, method, now=None, timeout=15):
    req = urllib.request.Request(base_url + path, method=method)
    if now is not None:
        req.add_header("X-Conformance-Now", str(int(now)))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def apply_mutation(path, mutate):
    if not mutate:
        return path
    parts = path.split("/")
    kind = mutate["kind"]
    if kind == "field":
        idx = {"kid": 2, "exp": 3, "order": 4, "sig": 5, "ref": 6}[mutate["name"]]
        parts[idx] = mutate["value"]
    elif kind == "path":
        parts = parts[:7] + encode_path(mutate["value"]).split("/")
    elif kind == "raw_path":
        parts = parts[:7] + mutate["value"].split("/")
    elif kind == "raw_path_replace":
        # rewrite bytes in the raw (still encoded) path, to test that the URL form is canonical
        raw = "/".join(parts[7:])
        if mutate["from"] not in raw:
            raise ValueError("mutation %r not present in %r" % (mutate["from"], raw))
        parts = parts[:7] + raw.replace(mutate["from"], mutate["to"]).split("/")
    else:
        raise ValueError("unknown mutation kind %r" % kind)
    return "/".join(parts)


def check_response(report, case, status, headers, body):
    exp = case.get("expect", {})
    name = case["id"]
    if "status" in exp and status != exp["status"]:
        return report.add(name, False, "expected HTTP %s, got %s" % (exp["status"], status))
    if "body" in exp:
        want = exp["body"].encode("utf-8")
        if body != want:
            return report.add(name, False, "body mismatch: wanted %r, got %r" % (want[:80], body[:80]))
    if "body_sha256" in exp:
        want = exp["body_sha256"]
        if want == "$sha256-of-body":
            want = hashlib.sha256(body).hexdigest()
        if hashlib.sha256(body).hexdigest() != want:
            return report.add(name, False, "body hash %s != %s" % (hashlib.sha256(body).hexdigest(), want))
    if "header_hashes_body" in exp:
        h = exp["header_hashes_body"]
        got = headers.get(h, "")
        if got != hashlib.sha256(body).hexdigest():
            return report.add(name, False, "%s=%r does not hash the body" % (h, got))
    for h, want in (exp.get("headers") or {}).items():
        if h == "X-Content-SHA256" and want == "$sha256":
            want = hashlib.sha256(body).hexdigest()
        got = headers.get(h)
        if want == "$present":
            if not got:
                return report.add(name, False, "header %s is missing or empty" % h)
            continue
        if got != want:
            return report.add(name, False, "header %s=%r, expected %r" % (h, got, want))
    for h in (exp.get("headers_absent") or []):
        if h in headers:
            return report.add(name, False, "header %s must not be present" % h)
    return report.add(name, True)


def run_vectors(report, signer):
    doc = json.loads((CONFORMANCE / "signing-vectors.json").read_text(encoding="utf-8"))
    print("signing vectors (%s)" % signer.name)
    for v in doc["vectors"]:
        try:
            sig, upath = signer.mint(v["secret"], v["kid"], v["exp"], v["order"], v["ref"], v["path"])
        except SignerError as e:
            report.add("vector %s %s" % (v["id"], v["name"]), False, "signer refused a valid vector: %s" % e)
            continue
        if sig != v["signature"]:
            report.add("vector %s %s" % (v["id"], v["name"]), False,
                       "signature %s, expected %s" % (sig, v["signature"]))
            continue
        if upath != v["url_path"]:
            report.add("vector %s %s" % (v["id"], v["name"]), False,
                       "url_path %s, expected %s" % (upath, v["url_path"]))
            continue
        report.add("vector %s %s" % (v["id"], v["name"]), True)
    for v in doc["invalid"]:
        args = {"kid": v["kid"] if "kid" in v else "k1", "order": v["order"] if "order" in v else "10008-S001",
                "ref": v["ref"] if "ref" in v else "a" * 40, "path": v["path"] if "path" in v else "amk/spec.md"}
        if v["field"] in args:
            args[v["field"]] = v["value"]
        try:
            signer.mint("test-secret", args["kid"], 2000000000, args["order"], args["ref"], args["path"])
            report.add("reject %s %s" % (v["id"], v["name"]), False, "the signer accepted an invalid %s" % v["field"])
        except SignerError:
            report.add("reject %s %s" % (v["id"], v["name"]), True)
        except Exception as e:  # a signer that raises something else still refused it
            report.add("reject %s %s" % (v["id"], v["name"]), True, detail=str(e))


def summarize_audit(records, order, expected=()):
    """Independent implementation of the audit summary described in SCHEME.md section 10."""
    seen, refused = {}, []
    for r in records:
        if r.get("order") != order:
            continue
        if r.get("status") == 200:
            seen[r.get("path")] = seen.get(r.get("path"), 0) + 1
        else:
            refused.append((r.get("status"), r.get("reason"), r.get("path")))
    return {"served": seen, "refused": refused,
            "never_fetched": [p for p in expected if p not in seen]}


def run_cases(report, signer, gateway, fixture, ref):
    doc = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))
    base = int(time.time())
    os.environ["CTXGATE_NOW"] = str(base)
    os.environ["CTXGATE_TEST_CLOCK"] = "1"

    # the gateway's EFFECTIVE policy, so a deployment is judged as it is configured
    try:
        health = gateway.fetch_health()
    except Exception as e:  # noqa: BLE001
        report.add("the gateway reports its effective policy on /healthz", False, str(e))
        return
    report.add("the gateway reports its effective policy on /healthz", True)
    skew = int(health.get("clock_skew_tolerance", 0))
    max_ttl = int(health.get("max_ttl", 0))
    max_bytes = int(health.get("max_bytes", 0))
    # the operator's approved ceilings (docs/decisions/0003). A gateway that is more permissive
    # than the policy fails here even if every other case passes.
    report.add("clock_skew_tolerance is within the approved ceiling (120 s)", 0 <= skew <= 120,
               "declared %s" % skew)
    report.add("max_ttl is within the approved ceiling (72 h)", 0 < max_ttl <= 259200, "declared %s" % max_ttl)

    cases = doc["cases"]
    requests = [c for c in cases if c.get("kind", "request") == "request"]
    others = [c for c in cases if c.get("kind", "request") != "request"]
    # uniform-refusal must run before the audit cases, which count everything that came before them
    order = {"uniform-refusal": 0, "audit-reason": 1, "audit-invariants": 2, "audit-summary": 3}
    others.sort(key=lambda c: order.get(c["kind"], 9))

    def resolve(value, exp_offset):
        """Resolve a symbolic offset against the gateway's effective policy."""
        if isinstance(value, int):
            return value
        if value == "$max_ttl":
            return max_ttl
        if value == "$max_ttl_plus_1":
            return max_ttl + 1
        if value == "$exp":
            return exp_offset
        if value == "$exp_plus_1":
            return exp_offset + 1
        if value == "$exp_plus_skew":
            return exp_offset + skew
        if value == "$exp_plus_skew_plus_1":
            return exp_offset + skew + 1
        if value == "$expired":
            # an expiry that is past the end of the clock-skew window, relative to the base time
            return -(skew + 1)
        raise ValueError("unknown symbolic offset %r" % value)

    def mint_link(link, mutate=None):
        secret = fixture["keys"][link.get("kid", "k1")]
        exp_offset = resolve(link.get("exp_offset", 600), 0)
        exp = base + exp_offset
        sig, upath = signer.mint(secret, link.get("kid", "k1"), exp, link.get("order", "10008-S001"),
                                 link.get("ref", ref), link["path"])
        return apply_mutation(upath, mutate), exp_offset

    def request_block(block):
        upath, exp_offset = mint_link(block["link"], block.get("mutate"))
        at = base + resolve(block["link"].get("at_offset", 0), exp_offset)
        return http_request(gateway.base_url, upath, block.get("method", "GET"), now=at)

    print("gateway behaviours (%s)" % gateway.base_url)
    for case in requests:
        status, headers, body = request_block(case)
        check_response(report, case, status, headers, body)

    for case in others:
        if case["kind"] == "uniform-refusal":
            bodies, statuses = [], []
            for block in case["requests"]:
                status, headers, body = request_block(block)
                statuses.append(status)
                bodies.append(body)
            exp = case["expect"]
            if any(s != exp["status"] for s in statuses):
                report.add(case["id"], False, "expected every refusal to be %s, got %s" % (exp["status"], statuses))
            elif exp.get("identical_bodies") and len(set(bodies)) != 1:
                report.add(case["id"], False, "refusal bodies differ: %r" % (bodies,))
            else:
                report.add(case["id"], True)
        elif case["kind"] == "audit-reason":
            status, headers, body = request_block(case["request"])
            exp = case["expect"]
            if status != exp.get("status"):
                report.add(case["id"], False, "expected HTTP %s, got %s" % (exp.get("status"), status))
                continue
            records = gateway.read_audit()
            if records is None:
                report.add(case["id"], False, "no audit trail to check (use --audit-url or --audit-log for an external gateway)")
                continue
            if not records:
                report.add(case["id"], False, "the request wrote no audit record")
                continue
            last = records[-1]
            wanted = exp.get("reason")
            allowed = wanted if isinstance(wanted, list) else [wanted]
            if last.get("reason") not in allowed:
                report.add(case["id"], False, "audited as %r, expected %r" % (last.get("reason"), wanted))
                continue
            report.add(case["id"], True)
        elif case["kind"] == "audit-invariants":
            records = gateway.read_audit()
            if records is None:
                report.add(case["id"], False, "no audit trail to check (use --audit-url or --audit-log for an external gateway)")
                continue
            n_requests = (len(requests)
                          + sum(len(c["requests"]) for c in others if c["kind"] == "uniform-refusal")
                          + sum(1 for c in others if c["kind"] == "audit-reason"))
            ok = True
            detail = ""
            if case["expect"].get("records_equal_requests") and len(records) != n_requests:
                ok, detail = False, "%d audit records for %d requests" % (len(records), n_requests)
            if ok and case["expect"].get("no_signature_in_records"):
                # the record must have exactly the documented fields (SCHEME.md section 10) and no capability
                documented = {"ts", "status", "reason", "kid", "order", "ref", "path", "bytes", "request_id"}
                for r in records:
                    extra = set(r) - documented
                    missing = documented - set(r)
                    if extra or missing:
                        ok, detail = False, "audit record fields differ: extra %s, missing %s" % (sorted(extra), sorted(missing))
                        break
            if ok and any("sig" in k.lower() for r in records for k in r):
                ok, detail = False, "an audit record has a signature field"
            if ok and "test-secret" in json.dumps(records):
                ok, detail = False, "the signing secret appears in the audit trail"
            if ok and case["expect"].get("unique_request_ids"):
                ids = [r.get("request_id") for r in records]
                if len(set(ids)) != len(ids):
                    ok, detail = False, "request ids are not unique: %d ids for %d records" % (len(set(ids)), len(ids))
                if any(not i or i == "-" for i in ids):
                    ok, detail = False, "a record has no request id"
            report.add(case["id"], ok, detail)
        elif case["kind"] == "audit-summary":
            records = gateway.read_audit()
            if records is None:
                report.add(case["id"], False, "no audit trail to check (use --audit-url or --audit-log for an external gateway)")
                continue
            exp = case["expect"]
            s = summarize_audit(records, case["order"], expected=list(exp["served"]) + list(exp.get("never_fetched", [])))
            ok = True
            detail = ""
            if sorted(s["served"]) != sorted(exp["served"]):
                ok, detail = False, "served %r, expected %r" % (sorted(s["served"]), sorted(exp["served"]))
            elif sorted(s["never_fetched"]) != sorted(exp.get("never_fetched", [])):
                ok, detail = False, "never_fetched %r, expected %r" % (sorted(s["never_fetched"]), sorted(exp.get("never_fetched", [])))
            elif len(s["refused"]) < int(exp.get("refused_at_least", 0)):
                ok, detail = False, "%d refusals recorded, expected at least %d" % (len(s["refused"]), exp.get("refused_at_least"))
            report.add(case["id"], ok, detail)

    # every behaviour in the suite must be covered by at least one case
    covered = {c["behaviour"] for c in cases}
    missing = [b for b in ["B%d" % i for i in range(1, 11)] if b not in covered]
    report.add("every behaviour B1-B10 has an executable case", not missing, "missing: %s" % missing)


def main(argv=None):
    p = argparse.ArgumentParser(prog="run.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=["vectors", "cases", "all"])
    p.add_argument("--reference", action="store_true", help="boot the reference gateway in this repository")
    p.add_argument("--gateway", help="base URL of a gateway that is already running")
    p.add_argument("--signer", help="an external signer program (JSON-lines contract)")
    p.add_argument("--ref", help="the commit the external gateway serves from")
    p.add_argument("--audit-log", help="the external gateway's audit log")
    p.add_argument("--audit-url", help="the external gateway's operator audit endpoint (JSONL)")
    p.add_argument("--admin-token", help="the operator credential for the gateway's admin channel")
    p.add_argument("--json", help="write a JSON report here")
    a = p.parse_args(argv)

    fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]

    signer = ExternalSigner(a.signer) if a.signer else PythonSigner()

    report = Report()
    if a.mode in ("vectors", "all"):
        run_vectors(report, signer)

    if a.mode in ("cases", "all"):
        if a.reference:
            gateway = ReferenceGateway(fixture)
            gateway.start()
        elif a.gateway:
            gateway = HttpGateway(a.gateway, a.ref, a.audit_log)
            gateway.audit_url = a.audit_url
            gateway.admin_token = a.admin_token
            gateway.start()
        else:
            p.error("cases need --reference or --gateway URL")
        try:
            ref = a.ref or getattr(gateway, "ref", None)
            if not ref:
                p.error("an external gateway needs --ref SHA")
            run_cases(report, signer, gateway, fixture, ref)
        finally:
            gateway.stop()

    print("\n%d passed, %d failed" % (len(report.results) - len(report.failed), len(report.failed)))
    if a.json:
        Path(a.json).write_text(json.dumps(report.results, indent=2) + "\n", encoding="utf-8")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
