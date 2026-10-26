# Gateway behaviours a production port must pass

From Appendix B of `template/docs/CONTEXT-EXPORT.md`. Each ID is stable; a test, in any language, cites its ID.

The behaviours are now **executable**. They live in `conformance/cases/behaviours.json` and are run by
`conformance/harness/run.py`. A port is conformant when it passes them, and the harness is what decides that —
not a reading of this document.

| ID | Behaviour | Executable cases |
|---|---|---|
| B1 | A valid link returns the exact bytes, the correct hash header, and `no-store` | `B1-valid-read`, `B1-hash-matches-body`, `B1-plus-in-path`, `B1-space-and-non-ascii-in-path`, `B1-url-form-is-canonical`, `B1-content-is-pinned-to-the-named-commit`, `B1-file-added-after-the-pinned-commit-is-not-visible` |
| B2 | HEAD returns headers and no body; POST, PUT, DELETE and PATCH return 405 | `B2-head-no-body`, `B2-post-405`, `B2-put-405`, `B2-delete-405`, `B2-patch-405`, `B2-method-refusal-is-audited-as-method` |
| B3 | An expired link is refused; the expiry boundary is inclusive (valid at `exp`, refused at `exp + 1`) | `B3-valid-at-expiry`, `B3-refused-one-past-expiry`, `B3-expired-refused`, `B3-expired-is-audited-as-expired` |
| B4 | Tampering with any of kid, exp, order, sig, ref or path is refused | `B4-tamper-kid`, `B4-tamper-exp`, `B4-tamper-order`, `B4-tamper-signature`, `B4-tamper-ref`, `B4-tamper-path`, `B4-forged-link-is-audited-as-bad-signature`, `B4-tampered-path-is-audited-as-bad-signature`, `B4-forged-and-expired-is-still-bad-signature`, `B4-forged-and-out-of-prefix-is-still-bad-signature`, `B4-forged-and-revoked-is-still-bad-signature` |
| B5 | A link whose lifetime exceeds `max_ttl` is refused | `B5-ttl-too-long`, `B5-ttl-at-limit`, `B5-ttl-too-long-is-audited-as-ttl-too-long` |
| B6 | Revoking an order kills its links and no one else's | `B6-revoked-order-refused`, `B6-other-order-unaffected`, `B6-revoked-is-audited-as-revoked` |
| B7 | A validly signed link to a denied or out-of-prefix path is refused | `B7-out-of-prefix`, `B7-denied-by-name`, `B7-denied-directory`, `B7-out-of-prefix-is-audited-as-path-denied`, `B7-unknown-key-is-audited-as-unknown-key` |
| B8 | `..`, encoded slashes and NUL bytes are refused | `B8-dotdot-component`, `B8-encoded-slash`, `B8-nul-byte`, `B8-encoded-separator-is-audited-as-encoded-separator`, `B8-dotdot-is-audited-as-malformed` |
| B9 | Not-found and too-large appear only after a valid signature; forged links never learn existence | `B9-not-found-after-valid-signature`, `B9-too-large-after-valid-signature`, `B9-unknown-commit-after-valid-signature`, `B9-forged-link-never-reveals-existence`, `B9-refusals-are-indistinguishable`, `B9-not-found-is-audited-as-not-found`, `B9-too-large-is-audited-as-too-large` |
| B10 | Every request writes one audit record; `audit` reports served, never-fetched and refused | `B10-one-record-per-request`, `B10-audit-summary` |
| B11 | The signing vectors reproduce exactly | `conformance/signing-vectors.json` (17 valid vectors, 19 invalid inputs) |

## Status per implementation

| Implementation | B1 to B11 | How it is checked |
|---|---|---|
| `template/engine/tools/ctxlink.py` (shipped client) | B11 (signing) | `conformance/test_conformance.py` runs every vector against it |
| `gateway/read/reference/` (proof of concept) | B1 to B11 | `conformance/harness/run.py cases --reference` |
| `gateway/read/production/` | not started | — |

## Reading a failure

A failing case names the behaviour it belongs to, so a port's test report can be read against this table
without guessing. The suite is checked against deliberate breakage of the reference gateway — an off-by-one
in the expiry comparison, a path check written as a substring glob, the signature check moved after the
expiry check, a refusal body that differs per reason, a gateway that serves the branch instead of the
pinned commit — and every one of those is caught by a named case.
