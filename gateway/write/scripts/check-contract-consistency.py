#!/usr/bin/env python3
"""check-contract-consistency.py — check that the ctxwrite-v1 contract documents agree.

Stage 5.1 wrote the write gateway's contract as several documents with one authority per concern
(plan rule G-11). This script checks that they still agree, so that the contract cannot drift
silently:

  1. every section anchor referenced by AGENTS.md or the agent tool prompt exists in protocol.md;
  2. the anchor table in protocol.md lists exactly the anchors that exist;
  3. every error code named in protocol.md exists in the error catalogue;
  4. every code in the error catalogue is anchor-linkable, so {base}/contract/ctxwrite-v1/errors#<code> resolves;
  5. the published quota block in quotas-and-type-policy.md equals src/config/quotas.json;
  6. the published type table in quotas-and-type-policy.md equals src/config/type-policy.json;
  7. the agent tool prompt contains no example host and uses the substitution token instead;
  8. src/config/quotas.json no longer carries the unresolved "KB" note (Stage 1.4.8 decided it).

The JSON files are the authorities; the document mirrors them. The mirror is what a human reads, so
a mismatch is a defect in the mirror.

Stage 5.1 wrote this script and ran it. Stage 5.5.8 wires it into CI.

Usage:  python3 gateway/write/scripts/check-contract-consistency.py
Exit:   0 if every check passes, 1 otherwise.
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WRITE = os.path.dirname(HERE)
DOCS = os.path.join(WRITE, "docs")
CONFIG = os.path.join(WRITE, "src", "config")

FAILURES = []


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


def main():
    protocol = read(os.path.join(DOCS, "protocol.md"))
    catalogue = read(os.path.join(DOCS, "error-catalog.md"))
    published = read(os.path.join(DOCS, "quotas-and-type-policy.md"))
    agents = read(os.path.join(WRITE, "AGENTS.md"))
    prompt = read(os.path.join(DOCS, "proposal", "agent-tool-prompt.md"))
    quotas = json.loads(read(os.path.join(CONFIG, "quotas.json")))
    types = json.loads(read(os.path.join(CONFIG, "type-policy.json")))

    print("1. section anchors resolve")
    anchors = set(re.findall(r'<a id="([^"]+)"></a>', protocol))
    check(bool(anchors), "protocol.md defines %d section anchors" % len(anchors))
    for name, doc in (("AGENTS.md", agents), ("agent-tool-prompt.md", prompt)):
        refs = set(re.findall(r"contract/ctxwrite-v1#([a-z0-9-]+)", doc))
        missing = sorted(refs - anchors)
        check(not missing, "%s: %d anchor references, all resolve%s"
              % (name, len(refs), "" if not missing else " MISSING " + ", ".join(missing)))

    print("2. the anchor table matches the anchors")
    declared = set(re.findall(r"^\| `#([a-z0-9-]+)` \|", protocol, re.M))
    check(declared == anchors, "the table in protocol.md lists exactly the %d anchors that exist" % len(anchors))

    print("3. error codes agree")
    codes = set(re.findall(r'<a id="([a-z0-9-]+)"></a>', catalogue))
    named = set(re.findall(r"`([a-z]+(?:-[a-z0-9]+)+)`", protocol))
    # Only codes that look like catalogue entries; a protocol may mention other hyphenated words.
    unknown = sorted(n for n in named if n.endswith(("-conflict", "-exceeded", "-sealed", "-revoked", "-closed",
                                                       "-mismatch", "-allowed", "-invalid", "-staged", "-gap",
                                                       "-exists", "-required", "-moved", "-count", "-not-allowed",
                                                       "-authorised", "-expired", "-limited", "-unavailable",
                                                       "-misconfigured", "-selectable", "-operation", "-parameter",
                                                       "-selection", "-utf8", "-text", "-not-found", "-not-staged",
                                                       "-not-authorised", "-missing", "-not-permitted", "-not-implemented"))
                       and n not in codes)
    check(not unknown, "every error code named in protocol.md is in the catalogue%s"
          % ("" if not unknown else " UNKNOWN " + ", ".join(unknown)))

    print("4. the catalogue is linkable")
    check(len(codes) >= 30, "the catalogue defines %d anchor-linkable codes" % len(codes))
    for status in ("400", "401", "403", "404", "405", "409", "410", "413", "429", "503"):
        check("| %s |" % status in catalogue, "the catalogue uses status %s" % status)

    print("5. the quota mirror matches the authority")
    block = re.search(r"```json\n(\{\n  \"max_files\".*?\n\})\n```", published, re.S)
    check(block is not None, "the published document carries a quota block")
    if block:
        want = {k: quotas[k] for k in ("max_files", "max_total_bytes", "max_file_bytes", "rate_limit", "max_concurrency")}
        check(json.loads(block.group(1)) == want, "the published quota block equals src/config/quotas.json")

    print("6. the type-policy mirror matches the authority")
    rows = re.findall(
        r'\{ "id": "([a-z]+)",\s+"media_type": "([^"]+)",\s+"extensions": (\[[^\]]*\]),'
        r'\s+"max_bytes": (\d+),\s+"allow_empty": (true|false),\s+"schema": null \}', published)
    doc_types = {r[0]: r[1:] for r in rows}
    check(len(doc_types) == len(types["types"]),
          "the published table lists all %d types (found %d)" % (len(types["types"]), len(doc_types)))
    for t in types["types"]:
        row = doc_types.get(t["id"])
        check(row is not None
              and row[0] == t["media_type"]
              and json.loads(row[1]) == t["extensions"]
              and int(row[2]) == t["max_bytes"]
              and row[3] == str(t["allow_empty"]).lower(),
              "type %s matches src/config/type-policy.json" % t["id"])
    denied = re.search(r'"denied_extensions": (\[[^\]]*\])', published)
    check(denied is not None and json.loads(denied.group(1)) == types["denied_extensions"],
          "the published denied_extensions list matches src/config/type-policy.json")

    print("7. the agent prompt")
    check("example.com" not in prompt and "https://example/" not in prompt,
          "the agent prompt contains no example host")
    check("{{WRITE_GATEWAY_BASE}}" in prompt, "the agent prompt uses the substitution token")
    check("https://example.internal" not in prompt, "the agent prompt hard-codes no host")

    print("8. the resolved decisions")
    check("KB is undefined" not in read(os.path.join(CONFIG, "quotas.json")),
          "src/config/quotas.json no longer carries the unresolved-units note")
    check("TBD" not in agents, "AGENTS.md has no TBD sections left")
    check("ctxwrite-v1" in protocol and "ctxgate-v1" in protocol,
          "protocol.md names both domain separators, so neither scheme can be replayed against the other")

    print("")
    if FAILURES:
        print("FAILED: %d check(s)" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("OK: the contract documents agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
