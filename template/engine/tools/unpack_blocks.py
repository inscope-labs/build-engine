#!/usr/bin/env python3
"""Unpack a worker's chat output into a submission folder.

Usage: unpack_blocks.py INPUT.txt OUTDIR

Input contains blocks:
    === FILE: relative/path ===
    ...content...
    === END FILE ===
"""
import re
import sys
from pathlib import Path


def unpack(text, outdir):
    out = Path(outdir)
    pat = re.compile(r"^=== FILE: (.+?) ===\n(.*?)\n=== END FILE ===[ \t]*$", re.S | re.M)
    written = []
    for m in pat.finditer(text):
        rel, body = m.group(1).strip(), m.group(2)
        parts = Path(rel).parts
        if rel.startswith("/") or "\\" in rel or ".." in parts or not parts:
            raise ValueError("unsafe path in block: %r" % rel)
        body = re.sub(r"^```[A-Za-z0-9]*\n(.*)\n```$", r"\1", body, flags=re.S)  # strip a wrapping code fence
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body.rstrip("\n") + "\n", encoding="utf-8")
        written.append(rel)
    if not written:
        raise ValueError("no file blocks found")
    return written


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    try:
        files = unpack(Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[2])
    except ValueError as e:
        sys.exit("ERROR: %s" % e)
    print("\n".join(files))
    print("%d file(s) written to %s" % (len(files), sys.argv[2]))
