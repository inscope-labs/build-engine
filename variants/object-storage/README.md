# variants/object-storage

The gateway-free way to give Class B agents read access, from Appendix A of `template/docs/CONTEXT-EXPORT.md` (the
operator's original proposal, kept as the fallback): the operator exports the order's files to object storage and puts
presigned GET URLs in each context item's `gateway_url`.

| Aspect | This variant | Recommended gateway |
|---|---|---|
| Moving parts | storage + presigning client + upload step + cleanup | one small service |
| Private content at rest outside GitHub | yes, until deleted | no |
| Revocation | delete the objects (presigned URLs cannot be revoked individually) | per order, instant |
| Order integration | identical: `gateway_url` added only when printing, never stored | identical |
| Presigning | needs an S3-compatible client or hand-rolled signing (avoid) | HMAC link, already shipped |

Use it only if running any always-on service is unacceptable (`docs/decisions/0001`).

## Planned components (none written)

| Component | Job |
|---|---|
| bundle builder | collect the order's files and verify each against the order's `sha256` before upload |
| uploader / presigner | upload each file under an order-specific prefix and produce presigned GET URLs |
| `links` integration | feed those URLs into `plan_tool.py links` through `gateway_url`, with no change to the order file |
| cleanup / revoke | delete the order's prefix when the task is done; this is the only revocation |
| audit | storage access logs compared with the order's expected files |

Open: the operator-side tool would ship with `template/operator/` once built, which is the one place this variant
differs from everything else under `variants/`. Acceptance: same order integration as the gateway, and delete-based
revocation proven (production path step 6).
