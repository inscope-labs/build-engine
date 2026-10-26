# rules

The ten checks, in order; the first failure ends the request and every outcome is audited
(full table: `template/docs/CONTEXT-EXPORT.md` section 6):

1. method is GET or HEAD (else 405)
2. no encoded separators (`%2f`, `%5c`, `%00`)
3. link parses; path has no `..`, `.`, empty or absolute parts
4. key id known
5. signature valid, constant-time compare, before anything else is revealed
6. not expired
7. `exp - now <= max_ttl`
8. order not revoked
9. path inside an allowed prefix and not on the deny list
10. read the blob (404 not found, 413 over `max_bytes`)

All failures before step 10 return the same 403 body. Success returns 200, `text/plain`, `Cache-Control: private,
no-store`, `X-Content-Type-Options: nosniff`, `X-Content-SHA256`, `X-Ctx-Order`. No listing, search or write path.

This directory holds the port of those checks to the chosen runtime. The signing vectors and the eleven behaviours the
port must pass are in `conformance/`; the Python implementation in `../../reference/` is the model. Planned contents:
this README, then the implementation once the runtime is chosen.
