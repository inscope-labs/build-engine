# 0001: where the read gateway runs

Status: **decided** (2026-10-26)

## Question
Where does the gateway run? Any small HTTPS endpoint works; the rules need no database, only a revocation list and an audit log.

## Decision
- **Runtime / platform:** Cloudflare (Workers / on-demand serverless).
- **Ownership:** Operator owns and operates the production instance.
- **Tenancy:** Single-operator; multi-tenant support is not required.
- **Availability model:** On-demand / serverless is acceptable and preferred; an always-on process is not required.

## Rationale
Matches the operator’s preferred platform, keeps operational ownership with the operator, and aligns with the existing write-gateway scaffold (also Cloudflare Worker). On-demand execution is sufficient for the expected load of signed-link fetches.

## Consequences
- `gateway/read/production/` may now be structured for a Cloudflare Worker runtime.
- Ops channel for revoke/audit must be reachable by the operator (CLI or API) against the Cloudflare-hosted service.
- Deployment and secret management follow Cloudflare Worker conventions (wrangler, secrets, etc.).

## Blocks resolved
Production path steps that depended on a hosting decision; ops channel design.
