# conformance/harness

The runner that drives an implementation against the shared suite. It speaks the **protocol**, not an
implementation, so it does not force a runtime choice on `gateway/read/production/`: a gateway is any
base URL that serves the link format, and a signer is either the shipped client or a small adapter.

## Running it

```bash
# the signing vectors, against the shipped client
conformance/harness/run.py vectors

# the behaviours B1-B10, against the proof-of-concept gateway in this repository
conformance/harness/run.py cases --reference

# both, and a machine-readable report
conformance/harness/run.py all --reference --json /tmp/report.json
```

Against a gateway that is already running:

```bash
conformance/harness/run.py cases \
  --gateway https://gw.example \
  --ref 0123456789abcdef0123456789abcdef01234567 \
  --audit-log /var/log/ctxgate/audit.jsonl
```

`--ref` is the commit the gateway serves from, and `--audit-log` is where it writes its audit records.
The audit cases (B10) need the log; without it, they are reported as not checkable rather than passed.

## Driving a signer that is not the shipped client

A signer is a program that reads one JSON object per line on stdin and writes one JSON object per line on
stdout (the contract is in `conformance/SCHEME.md` section 11):

```
in : {"op":"mint","secret":"...","kid":"k1","exp":2000000000,"order":"10008-S001","ref":"...","path":"..."}
out: {"signature":"...","url_path":"/v1/k1/2000000000/10008-S001/.../..."}
out: {"error":"..."}          when the input is invalid and must be refused
```

```bash
conformance/harness/run.py vectors --signer "node my-signer.js"
conformance/harness/run.py vectors --signer "python3 conformance/harness/signer_adapter.py"
```

`signer_adapter.py` is a worked example over the shipped client. A port in another language writes its
own; it is about twenty lines.

## The test clock

B3 and B5 are about the exact comparison against `exp`, so the gateway under test needs a controllable
notion of "now". The reference implementation reads `CTXGATE_NOW` and, when the process was started with
`CTXGATE_TEST_CLOCK=1`, honours a per-request `X-Conformance-Now` header. The harness sends that header
on every request.

A production deployment must not set `CTXGATE_TEST_CLOCK`: the override would let a caller extend the
life of an expired link. A port that provides no test clock cannot be checked on the exact expiry
boundary, and the harness will fail the boundary cases rather than quietly pass them.

## What the harness does not do

It does not check the *source* of the file, the deployment, the rate limiting, the retention of the audit
log, or the behaviour behind a real GET-only proxy. It checks the scheme and the gateway's protocol
behaviour, and nothing else.
