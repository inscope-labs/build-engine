#!/usr/bin/env python3
"""Reference implementation of the JSON-lines signer contract (conformance/SCHEME.md section 11).

This is a worked example, and it is the adapter the harness uses when it is pointed at the shipped
client. A port in another language writes its own adapter of the same shape: read one JSON object per
line on stdin, write one JSON object per line on stdout.

    in : {"op":"mint","secret":"...","kid":"k1","exp":2000000000,"order":"10008-S001","ref":"...","path":"..."}
    out: {"signature":"...","url_path":"/v1/k1/2000000000/10008-S001/.../..."}
    out: {"error":"..."}          when the input is invalid and must be refused

Run it with the harness:

    conformance/harness/run.py vectors --signer "python3 conformance/harness/signer_adapter.py"
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "template" / "engine" / "tools"))
import ctxlink as cg  # noqa: E402

UNRESERVED = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~")


def encode_segment(seg):
    out = []
    for b in seg.encode("utf-8"):
        c = chr(b)
        out.append(c if c in UNRESERVED else "%%%02X" % b)
    return "".join(out)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req.get("op") != "mint":
                raise ValueError("unknown op %r" % req.get("op"))
            kid, exp, order, ref, path = req["kid"], int(req["exp"]), req["order"], req["ref"], req["path"]
            secret = req["secret"]
            if not cg.KID_RE.match(kid):
                raise ValueError("bad kid")
            if not cg.ORDER_RE.match(order):
                raise ValueError("bad order")
            if not cg.REF_RE.match(ref):
                raise ValueError("bad ref")
            if not cg.safe_path(path):
                raise ValueError("unsafe path")
            sig = cg.sign(secret.encode("utf-8"), kid, exp, order, ref, path)
            enc = "/".join(encode_segment(s) for s in path.split("/"))
            upath = "/v1/%s/%d/%s/%s/%s/%s" % (kid, exp, order, sig, ref, enc)
            print(json.dumps({"signature": sig, "url_path": upath}), flush=True)
        except Exception as e:  # noqa: BLE001 - the contract says: answer with an error
            print(json.dumps({"error": str(e)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
