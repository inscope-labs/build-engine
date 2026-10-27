#!/usr/bin/env python3
"""Build hostile release artifacts for the release self-test.

Every fixture rewrites the checksum sidecar, so the test that uses it fails for the reason the test is
about and not for a checksum mismatch.

    test-fixtures.py add-member ARTIFACT KIND NAME [TARGET]
    test-fixtures.py patch-file  ARTIFACT INNER_PATH      (new content on stdin)
    test-fixtures.py truncate   ARTIFACT

KIND is one of: file, symlink, hardlink, fifo, chr, dir, dup.
"""
import hashlib
import io
import os
import sys
import tarfile


def refresh_sidecar(art):
    digest = hashlib.sha256(open(art, "rb").read()).hexdigest()
    with open(art + ".sha256", "w") as fh:
        fh.write("%s  %s\n" % (digest, os.path.basename(art)))


def read_members(art):
    items = []
    with tarfile.open(art, "r:gz") as tf:
        for member in tf.getmembers():
            data = tf.extractfile(member).read() if member.isreg() else b""
            items.append((member, data))
    return items


def write_members(art, items):
    tmp = art + ".new"
    with tarfile.open(tmp, "w:gz") as out:
        for member, data in items:
            out.addfile(member, io.BytesIO(data) if member.isreg() else None)
    os.replace(tmp, art)
    refresh_sidecar(art)


def add_member(art, kind, name, target):
    items = read_members(art)
    payload = b"hostile\n"
    info = tarfile.TarInfo(name)
    info.mtime = 0
    if kind == "file":
        info.size = len(payload)
    elif kind == "symlink":
        info.type = tarfile.SYMTYPE
        info.linkname = target
    elif kind == "hardlink":
        info.type = tarfile.LNKTYPE
        info.linkname = target
    elif kind == "fifo":
        info.type = tarfile.FIFOTYPE
    elif kind == "chr":
        info.type = tarfile.CHRTYPE
        info.devmajor, info.devminor = 1, 3
    elif kind == "dir":
        info.type = tarfile.DIRTYPE
    elif kind == "dup":
        info.size = len(payload)
    else:
        raise SystemExit("unknown member kind: %s" % kind)
    items.append((info, payload))
    if kind == "dup":
        second = tarfile.TarInfo(name)
        second.mtime = 0
        second.size = len(payload)
        items.append((second, payload))
    write_members(art, items)


def patch_file(art, inner):
    new = sys.stdin.buffer.read()
    items = read_members(art)
    found = False
    for member, data in items:
        if member.name == inner:
            data = new
            found = True
    if not found:
        raise SystemExit("no such file in the artifact: %s" % inner)
    write_members(art, items)


def truncate(art):
    data = open(art, "rb").read()
    with open(art, "wb") as fh:
        fh.write(data[: len(data) // 2])
    refresh_sidecar(art)


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    command, art = argv[1], argv[2]
    if command == "add-member":
        add_member(art, argv[3], argv[4], argv[5] if len(argv) > 5 else "")
    elif command == "patch-file":
        patch_file(art, argv[3])
    elif command == "truncate":
        truncate(art)
    else:
        raise SystemExit("unknown command: %s" % command)


if __name__ == "__main__":
    main(sys.argv)
