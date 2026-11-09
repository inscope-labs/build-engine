#!/usr/bin/env python3
"""run_shared.py - the shared-property conformance suite (ADR 0010, Q-A).

Five properties apply to the three capability formats (ctxop-v1, ctxgate-v1, ctxwrite-v1): signing,
scope, expiry, revocation and replay. The operator chose a shared executable suite for the **shared**
properties (signing, expiry, revocation); each format's own suite keeps the rest. The cases are in
conformance/cases/shared-properties.json and cover all fifteen cells, so the matrix is complete.

Every cell names the tests that prove it, and this runner **runs them** - it does not trust the
names. A cell is:

  PASS      every named executable test ran and passed, and ran exactly as many tests as it names
  PASS (accepted gap)   the gap is recorded in an operator decision that exists and says `decided`,
            and the tests that bound the gap pass
  EXTERNAL  the evidence is in another repository (ctxop-v1, Gateway A in operator-console). It is
            CITED, never run from here, and it is never reported as a pass.
  FAIL      anything else, including a named test that does not exist

An EXTERNAL cell does not fail the default run, because the default run is what a build-engine change
can be judged on. `--strict` fails on any EXTERNAL cell, and is what the S7 gate uses once the
operator-console evidence has been verified.

Usage:
  run_shared.py                 run every executable cell
  run_shared.py --strict        also fail on EXTERNAL cells
  run_shared.py --markdown      print the evidence matrix as Markdown (used by CAPABILITY-CONFORMANCE.md)
  run_shared.py --cases FILE    use another cases file (the tests use this to plant a failure)

Standard library only. Not shipped in releases.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFORMANCE = HERE.parent
REPO = CONFORMANCE.parent
DEFAULT_CASES = CONFORMANCE / "cases" / "shared-properties.json"
BEHAVIOURS = CONFORMANCE / "cases" / "behaviours.json"
READ = REPO / "gateway" / "read" / "production"
WRITE = REPO / "gateway" / "write"

PROPERTIES = ("signing", "scope", "expiry", "revocation", "replay")
FORMATS = ("ctxop-v1", "ctxgate-v1", "ctxwrite-v1")
STATUSES = ("executable", "accepted-gap", "external")

_cache: dict = {}


def _run(cmd: list, cwd: Path, timeout: int = 900) -> tuple:
    key = (tuple(cmd), str(cwd))
    if key not in _cache:
        try:
            proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
            _cache[key] = (proc.returncode, proc.stdout + proc.stderr)
        except (OSError, subprocess.TimeoutExpired) as exc:
            _cache[key] = (127, "could not run: %s" % exc)
    return _cache[key]


def _count(output: str, label: str) -> int:
    match = re.search(r"^# %s (\d+)$" % label, output, re.M)
    return int(match.group(1)) if match else -1


def _node_tests(kind: str, file: str, names: list) -> tuple:
    root, base = (WRITE, ["node", "--import", "./tests/helpers/register.mjs", "--test"]) if kind == "ts-write" else (
        READ, ["node", "--test", "--experimental-strip-types"])
    absolute = REPO / file
    if not absolute.is_file():
        return False, "no such file: %s" % file
    pattern = "^(%s)$" % "|".join(re.escape(n) for n in names)
    code, out = _run(base + ["--test-name-pattern", pattern, str(absolute.relative_to(root))], root)
    passed, failed = _count(out, "pass"), _count(out, "fail")
    if code != 0 or failed != 0:
        return False, "%s: %d failed (exit %d)" % (file, failed, code)
    if passed != len(names):
        return False, "%s: %d of the %d named tests ran (a named test does not exist, or is named twice)" % (file, passed, len(names))
    return True, "%s: %d test(s) passed" % (file, passed)


def _cases(ids: list) -> tuple:
    known = {c["id"] for c in json.loads(BEHAVIOURS.read_text(encoding="utf-8"))["cases"]}
    missing = [i for i in ids if i not in known]
    if missing:
        return False, "case id(s) not in behaviours.json: %s" % ", ".join(missing)
    code, out = _run([sys.executable, "test/run-conformance.py"], READ)
    if code != 0 or "PASSED" not in out:
        return False, "test/run-conformance.py did not pass (exit %d)" % code
    return True, "%d case id(s) exist and test/run-conformance.py passed" % len(ids)


def _script(script: str, texts: list) -> tuple:
    path = REPO / script
    if not path.is_file():
        return False, "no such file: %s" % script
    code, out = _run([sys.executable, str(path.relative_to(READ))], READ)
    if code != 0:
        return False, "%s did not pass (exit %d)" % (script, code)
    missing = [t for t in texts if t not in out]
    if missing:
        return False, "%s passed but did not report: %s" % (script, "; ".join(missing))
    return True, "%s passed and reported %d named check(s)" % (script, len(texts))


def _adr(file: str) -> tuple:
    path = REPO / file
    if not path.is_file():
        return False, "no such decision: %s" % file
    if not re.search(r"^Status: \*\*decided\*\*", path.read_text(encoding="utf-8"), re.M):
        return False, "%s is not status decided" % file
    return True, "%s is decided" % file


def judge(cell: dict) -> tuple:
    """Return (outcome, details) for one cell. Outcome is PASS, PASS (accepted gap), EXTERNAL or FAIL."""
    if cell["status"] not in STATUSES:
        return "FAIL", ["unknown status %r" % cell["status"]]
    details: list = []
    ok = True
    ran_executable = False
    for ev in cell["evidence"]:
        kind = ev["kind"]
        if kind == "external":
            required = ("repo", "commit", "file", "names")
            if any(k not in ev for k in required) or not ev["names"] or len(ev["commit"]) != 40:
                ok = False
                details.append("external evidence must name repo, a 40-character commit, file and tests")
            else:
                details.append("cited, not run: %s@%s %s (%d test(s))" % (ev["repo"], ev["commit"][:7], ev["file"], len(ev["names"])))
            continue
        if kind == "adr":
            result = _adr(ev["file"])
        else:
            ran_executable = True
            if kind in ("ts-write", "ts-read"):
                result = _node_tests(kind, ev["file"], ev["names"])
            elif kind == "case":
                result = _cases(ev["ids"])
            elif kind == "script":
                result = _script(ev["script"], ev["texts"])
            else:
                result = (False, "unknown evidence kind %r" % kind)
        ok = ok and result[0]
        details.append(("ok   " if result[0] else "FAIL ") + result[1])
    if not ok:
        return "FAIL", details
    if cell["status"] == "external":
        if ran_executable:
            return "FAIL", details + ["an external cell must not claim executable evidence"]
        return "EXTERNAL", details
    if not ran_executable:
        return "FAIL", details + ["a cell with no executable evidence cannot pass"]
    if cell["status"] == "accepted-gap":
        if not any(e["kind"] == "adr" for e in cell["evidence"]):
            return "FAIL", details + ["an accepted gap must cite the decision that accepts it"]
        return "PASS (accepted gap)", details
    return "PASS", details


def load(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    seen = {(c["property"], c["format"]) for c in data["cells"]}
    expected = {(p, f) for p in PROPERTIES for f in FORMATS}
    if seen != expected:
        raise SystemExit("the cases must cover every property x format cell exactly once; missing %s, extra %s"
                         % (sorted(expected - seen), sorted(seen - expected)))
    if len(seen) != len(data["cells"]):
        raise SystemExit("a property x format cell is listed twice")
    return data


def markdown(data: dict) -> str:
    out = []
    for prop in PROPERTIES:
        shared = " (shared property)" if prop in data["shared_properties"] else " (owned by each format's own suite)"
        out.append("#### %s%s\n" % (prop, shared))
        out.append("| Format | Status | Evidence |\n|---|---|---|")
        for fmt in FORMATS:
            cell = next(c for c in data["cells"] if c["property"] == prop and c["format"] == fmt)
            parts = []
            for ev in cell["evidence"]:
                if ev["kind"] in ("ts-write", "ts-read", "external"):
                    where = ev["file"] if ev["kind"] != "external" else "%s@%s %s" % (ev["repo"], ev["commit"][:7], ev["file"])
                    parts.append("`%s`: %s" % (where, "; ".join('"%s"' % n for n in ev["names"])))
                elif ev["kind"] == "case":
                    parts.append("cases %s (run by `gateway/read/production/test/run-conformance.py`)" % ", ".join("`%s`" % i for i in ev["ids"]))
                elif ev["kind"] == "script":
                    parts.append("`%s`: %s" % (ev["script"], "; ".join('"%s"' % t for t in ev["texts"])))
                elif ev["kind"] == "adr":
                    parts.append("accepted by `%s` item %s" % (ev["file"], ev["item"]))
            status = {"executable": "executable", "accepted-gap": "accepted gap", "external": "external (cited, not run here)"}[cell["status"]]
            note = (" **Note:** " + cell["note"]) if cell.get("note") else ""
            out.append("| `%s` | %s | %s%s |" % (fmt, status, "<br>".join(parts), note))
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


def main(argv: list | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--strict", action="store_true", help="fail on any EXTERNAL cell")
    ap.add_argument("--markdown", action="store_true", help="print the evidence matrix as Markdown")
    ap.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    args = ap.parse_args(argv)
    data = load(args.cases)
    if args.markdown:
        sys.stdout.write(markdown(data))
        return 0

    counts = {"PASS": 0, "PASS (accepted gap)": 0, "EXTERNAL": 0, "FAIL": 0}
    for prop in PROPERTIES:
        for fmt in FORMATS:
            cell = next(c for c in data["cells"] if c["property"] == prop and c["format"] == fmt)
            outcome, details = judge(cell)
            counts[outcome] += 1
            print("%-10s %-11s %s" % (prop, fmt, outcome))
            for line in details:
                print("             " + line)
            if cell.get("note"):
                print("             note: " + cell["note"])
    print("")
    print("%d PASS, %d PASS (accepted gap), %d EXTERNAL (cited, not run here), %d FAIL"
          % (counts["PASS"], counts["PASS (accepted gap)"], counts["EXTERNAL"], counts["FAIL"]))
    if counts["EXTERNAL"]:
        print("EXTERNAL cells are not passes: their evidence is in operator-console and must be verified at S7.")
    if counts["FAIL"] or (args.strict and counts["EXTERNAL"]):
        print("FAILED" + (" (strict: EXTERNAL cells are failures)" if not counts["FAIL"] else ""))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
