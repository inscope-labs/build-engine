# 0001: where the read gateway runs

Status: open

## Question
Where does the gateway run? Any small HTTPS endpoint works; the rules need no database, only a revocation list and an audit log. The always-on service can be avoided entirely by the object-storage variant.

## Proposed in the design
No hosting is proposed; the decision is the operator's. Constraint from 0002. The write gateway (`gateway/write`) is a Cloudflare Worker, so sharing that platform is an option, not a recommendation.

## Blocks
`gateway/read/production/` (no runtime directory can be created until this is decided), `ops/` (including the revoke and audit channel), the pilot.
