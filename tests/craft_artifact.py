#!/usr/bin/env python3
"""Test helper (source repository only, never shipped): repack a release artifact with a hostile or edited manifest.

  craft_artifact.py SRC.tar.gz OUT_DIR VERSION [LINES_EXPR] [EXTRA_EXPR]

LINES_EXPR is a Python expression over `lines` (the RELEASE-MANIFEST lines) and `first` (index of the first data line) returning the new lines.
EXTRA_EXPR evaluates to a list of (name, bytes, kind, linkname) extra tar members; kind is file|symlink|dir|hardlink.
A matching .sha256 sidecar is written, so the artifact passes the checksum and fails only on what was crafted.
"""
import gzip, hashlib, io, os, sys, tarfile

src, out, ver = sys.argv[1:4]
lines_expr = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else "lines"
extra_expr = sys.argv[5] if len(sys.argv) > 5 else "[]"
os.makedirs(out, exist_ok=True)
tin = tarfile.open(src)
members = {m.name: (m, tin.extractfile(m).read()) for m in tin.getmembers()}
lines = members["engine/RELEASE-MANIFEST"][1].decode().splitlines()
first = next(i for i, l in enumerate(lines) if l and not l.startswith("#"))  # index of the first data line
new_lines = eval(lines_expr, {"lines": lines, "first": first, "hashlib": hashlib, "members": members})
m0 = members["engine/RELEASE-MANIFEST"][0]
members["engine/RELEASE-MANIFEST"] = (m0, ("\n".join(new_lines) + "\n").encode())
extra = eval(extra_expr, {"hashlib": hashlib})
name = "build-engine-v%s.tar.gz" % ver
buf = io.BytesIO()
with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz, tarfile.open(fileobj=gz, mode="w") as o:
    for n, (m, d) in sorted(members.items()):
        m.size = len(d)
        o.addfile(m, io.BytesIO(d))
    for n, data, kind, link in extra:
        ti = tarfile.TarInfo(n)
        ti.mode = 0o644
        if kind == "symlink":
            ti.type, ti.linkname = tarfile.SYMTYPE, link
        elif kind == "hardlink":
            ti.type, ti.linkname = tarfile.LNKTYPE, link
        elif kind == "dir":
            ti.type, ti.mode = tarfile.DIRTYPE, 0o755
        else:
            ti.size = len(data)
        o.addfile(ti, io.BytesIO(data) if kind == "file" else None)
open(os.path.join(out, name), "wb").write(buf.getvalue())
open(os.path.join(out, name + ".sha256"), "w").write("%s  %s\n" % (hashlib.sha256(buf.getvalue()).hexdigest(), name))
