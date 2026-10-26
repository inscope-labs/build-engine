# Gateway behaviours a production port must pass

From Appendix B of `template/docs/CONTEXT-EXPORT.md`. Each ID is stable; a test, in any language, cites its ID.

| ID | Behaviour |
|---|---|
| B1 | A valid link returns the exact bytes, the correct hash header, and `no-store` |
| B2 | HEAD returns headers and no body; POST, PUT, DELETE and PATCH return 405 |
| B3 | An expired link is refused; the expiry boundary is inclusive (valid at `exp`, refused at `exp + 1`) |
| B4 | Tampering with any of kid, exp, order, sig, ref or path is refused |
| B5 | A link whose lifetime exceeds `max_ttl` is refused |
| B6 | Revoking an order kills its links and no one else's |
| B7 | A validly signed link to a denied or out-of-prefix path is refused |
| B8 | `..`, encoded slashes and NUL bytes are refused |
| B9 | Not-found and too-large appear only after a valid signature; forged links never learn existence |
| B10 | Every request writes one audit record; `audit` reports served, never-fetched and refused |
| B11 | The signing vectors reproduce exactly |

Status per implementation (update as work proceeds):

| Implementation | B1 to B11 |
|---|---|
| `template/engine/tools/ctxlink.py` (client) | B11 only (signing) |
| `gateway/read/reference/` | covered by `test_ctxgate.py` (mapping to IDs not yet recorded) |
| `gateway/read/production/` | not started |
