# conformance

The language-neutral acceptance suite for the signed-link scheme and the read gateway. It exists because the design says
"any implementation must reproduce" the signing vectors and a production port "must pass" eleven behaviours, but today
those live only inside Python tests. Anything that signs or serves links is accepted against this directory: the shipped
client (`template/engine/tools/ctxlink.py`), the reference gateway, and any production port in any language.

| File | Role | Status |
|---|---|---|
| `behaviours.md` | the eleven behaviours a gateway must pass (Appendix B of the design), each with a stable ID | written |
| `signing-vectors.json` | machine-readable signing vectors | stub: to be filled when code work starts |
| `harness/` | how an implementation is driven against a base URL and a scratch repository | structure only |

**The published signing vector** (any implementation must reproduce it): secret `test-secret`, key id `k1`, exp
`2000000000`, order `10008-S001`, ref forty `a` characters, path `amk/amk-ssot.md` gives signature
`b5aVA1G6MJDhZy5mkIkSFeUMFBM0W-tixIb2w4XHEU8`. The message is
`"ctxgate-v1\n" + kid + "\n" + exp + "\n" + order + "\n" + ref + "\n" + path` (UTF-8), HMAC-SHA256, base64url without
padding. The shipped client reproduces this today. A second vector with a space and a non-ASCII character exists in
`template/engine/tools/test_ctxlink.py` and is to be moved into `signing-vectors.json`.

Not shipped in releases (it is a development asset); a consumer never needs it.
