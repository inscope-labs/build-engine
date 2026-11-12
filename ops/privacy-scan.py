#!/usr/bin/env python3
"""privacy-scan.py — scan a capture for the shapes a credential takes.

The exit gates ask that a capture hold no root URL, no capability signature, no payload, no
private content and no credential. That is a claim about a file, so it needs a tool that can be
pointed at any file and always reports the same way.

Two kinds of check:

  - **Shapes.** The patterns a credential, a capability and a private payload take, however they
    got there. These find the *accidental* leak: a URL in a log line, a token in an error
    message, a header that should not have been there.
  - **Needles.** Exact values the operator holds — a signing secret, the operator token, the
    repository credential — read from a file the caller names, so that the value never appears
    in a command line, a process list, a shell history or this script's own output. A needle is
    the strong check: a shape is a guess about a value, a needle is the value.

**Nothing this script prints is ever a matched value.** A hit is reported as a shape name and a
count, and the line number. That is the rule from F0-076: a report names the credential-shaped
sentinel, it does not reproduce it.

Usage:
    python3 ops/privacy-scan.py --file <capture> [--file <capture> ...]
    python3 ops/privacy-scan.py --file <capture> --needle-file <secrets, one per line>
    python3 ops/privacy-scan.py --file <capture> --fixture <content file>

Exit: 0 when nothing was found, 1 when something was.
"""

import argparse
import os
import re
import sys

# The shapes. Each is a name and a pattern; the name is what a report cites.
SHAPES = [
    ("a capability root URL",
     re.compile(r"https?://[^\s\"'<>]*/(?:v1|w1)/[A-Za-z0-9_\-]{2,}/\d{1,12}/[^\s\"'<>]+")),
    ("a capability path",
     re.compile(r"/(?:v1|w1)/[A-Za-z0-9_\-]{2,}/\d{1,12}/[^\s\"'<>]{2,}/[^\s\"'<>]{2,}/[^\s\"'<>]{2,}")),
    ("a bearer literal",
     re.compile(r"[Bb]earer\s+[A-Za-z0-9._\-=]{16,}")),
    ("a GitHub token",
     re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}")),
    ("a fine-grained PAT",
     re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}")),
    ("a private key header",
     re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("an operator token or a signing secret in an assignment",
     re.compile(r"(?i)\b(?:operator[_-]?token|signing[_-]?secret|signing[_-]?key|api[_-]?token)\s*[=:]\s*[\"']?([A-Za-z0-9._\-]{16,})")),
    ("a Cloudflare API token",
     re.compile(r"\b[A-Za-z0-9_\-]{40}\b(?=[^\n]{0,40}CF_API|CLOUDFLARE)")),
]


def scan_text(text, needles):
    """Every shape that appears in the text, and where."""
    hits = []
    for name, pattern in SHAPES:
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            hits.append((name, line))
    for name, value in needles:
        if not value:
            continue
        start = 0
        while True:
            index = text.find(value, start)
            if index < 0:
                break
            hits.append((name, text.count("\n", 0, index) + 1))
            start = index + max(1, len(value))
    return hits


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", action="append", default=[], required=True,
                        help="a capture to scan; repeatable")
    parser.add_argument("--needle-file", default="",
                        help="a file holding one secret per line. The values are never printed.")
    parser.add_argument("--fixture", action="append", default=[],
                        help="a file whose content must not appear in the capture; repeatable")
    parser.add_argument("--label", default="", help="a label for the capture, for the report")
    args = parser.parse_args(argv)

    needles = []
    if args.needle_file:
        try:
            with open(args.needle_file, "r", encoding="utf-8") as handle:
                for index, line in enumerate(handle):
                    value = line.strip()
                    if value:
                        needles.append(("a named secret (line %d of the needle file)" % (index + 1), value))
        except OSError as e:
            print("could not read the needle file: %s" % e, file=sys.stderr)
            return 2

    fixtures = []
    for path in args.fixture:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                content = handle.read()
        except OSError as e:
            print("could not read the fixture: %s" % e, file=sys.stderr)
            return 2
        # A distinctive line of the fixture, not the whole file: the whole file may be empty or
        # a single newline, and a one-character needle would match everything.
        for line in content.splitlines():
            stripped = line.strip()
            if len(stripped) >= 24:
                fixtures.append(("a fixture's content (%s)" % os.path.basename(path), stripped))
                break

    total = 0
    for path in args.file:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as e:
            print("could not read %s: %s" % (path, e), file=sys.stderr)
            return 2
        hits = scan_text(text, needles + fixtures)
        label = args.label or path
        if not hits:
            print("  clean   %s  (%d bytes)" % (label, len(text)))
            continue
        total += len(hits)
        print("  HIT     %s  (%d bytes)" % (label, len(text)))
        seen = {}
        for name, line in hits:
            seen.setdefault(name, []).append(line)
        for name in sorted(seen):
            lines = seen[name]
            print("            %s: %d hit(s), first at line %d" % (name, len(lines), min(lines)))

    if total:
        print("")
        print("FOUND %d hit(s): the capture holds something it should not." % total)
        return 1
    print("")
    print("CLEAN: nothing of the shapes above is in the capture.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
