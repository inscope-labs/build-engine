# 0001: where the gateways run (read and write)

Status: **closed** (2026-11-01). Originally decided 2026-10-26; closed with deployment model, environment separation, operator ownership, accepted risks, and operator authorization.

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

---

## Closure (2026-11-01)

Closes RELEASE-PLAN.md Stage 1.3.1: hosting/runtime, deployment model, environment separation, and operator ownership.

### Scope
- Both gateways are hosted on Cloudflare Workers: the read gateway (`gateway/read/production`) and the write gateway (`gateway/write`).
- This decision does not change the 0.5.0 release. Gateways remain source-only and are not part of the consumer artifact. Deployment is post-0.5.0 work targeting 0.6.0.

### Deployment model
- **Topology:** two separate Workers (read, write), each with its own configuration, secrets, and deploys.
- **Read source adapter:** fetch single authorized files from GitHub at the pinned commit, using a read-only credential held as a Worker secret.
- **Write gateway state:** Durable Objects hold coordination and metadata only (single-writer lease, quotas, idempotency). File content is never copied to third-party storage.
- **Deployment mechanism:** GitHub Actions running Wrangler from protected, reviewed refs only. Deploy jobs never run from pull-request jobs (RELEASE-PLAN 5.4.6).
- **Hostnames:** `workers.dev` hostnames are used for all environments for now. Exact hostnames are recorded at first deployment. Per ADR 0002, the gateway host must appear in the work order and be reachable by the agent proxy; a hostname change therefore requires re-minting affected links. A custom operator-owned domain may replace `workers.dev` later through a follow-up decision.
- **Platform logging:** persistent platform request logs and traces are disabled for the write gateway; only the gateway’s own redacted audit events are retained. Read-gateway logging follows the same redaction rules.
- **Audit sink:** to be chosen during Phase 4/5 implementation. Required properties: operator-reachable, redacted, retention stated.

### Environment separation
- **Environments:** `staging` and `production`.
- **Account boundary:** one Cloudflare account; separate Workers, separate secrets, and separate hostnames per environment.
- **Keys and secrets:** distinct signing keys (distinct key IDs) and distinct GitHub credentials per environment. No secret is shared across environments.
- **Data and destinations:** staging uses a disposable test repository or an isolated test branch/folder with test-only credentials. Production uses the real submissions destination.
- **Promotion rule:** a staging deploy with passing conformance and tests is required before production. Each production deploy needs explicit operator approval.
- **Secret storage:** Worker secrets for runtime; GitHub Actions environment secrets for deploy tokens. Nothing in source, fixtures, or logs.

### Operator ownership
- **Account owner:** John Wendell, as operator, under the InScope Labs organization.
- **Production deploys:** operator only. Agents never hold Cloudflare or deploy credentials.
- **Revoke work orders, rotate keys, read audit data:** operator only.
- **Cloudflare API token:** a dedicated deploy token scoped to the specific Workers/zone, separate from any personal or global key, stored only as a GitHub environment secret.
- **Account protection:** two-factor authentication required on the Cloudflare account; the recovery contact is recorded outside the repository.
- **Key rotation:** on suspected exposure, on any ownership change, and at least every 90 days.
- **Rollback and incident owner:** operator. Rollback is a redeploy of the previous Worker version followed by revoking affected orders. The runbook lives in each gateway’s operations documentation.

### Accepted risks
The operator accepts the following residual risks:
- **R-04:** platform-level request logs and edge infrastructure may see URL query data on the write route.
- **R-05:** a repository-scoped GitHub token is not folder-scoped; path limits are enforced by code, not by the credential.
- **R-06:** ephemeral state can be lost on isolate eviction; resulting ambiguity is resolved by operator reconcile.
- **Vendor dependency:** Cloudflare lock-in is accepted. Cloudflare-specific logic should stay behind a thin adapter layer.
- **Plan tier:** to be confirmed at first deployment. No cost figure is recorded here.

### Production status
Cloudflare Workers is approved for production hosting of both gateways, and the write route is marked **production approved** at the hosting level. This approval records the operator’s acceptance of the risks above. It does not waive the implementation and verification gates in RELEASE-PLAN Phases 4–6 (no-store and cache controls, log-hygiene tests with sentinel secrets, conformance, staging pilot). Implementation status is tracked in `docs/STATUS.md`, not in this ADR.

### Operator authorization
Recorded from the operator’s completed closure questionnaire, 2026-11-01. Approver: John Wendell, operator and lead architect, inscope-labs.

1. YES: the operator chooses Cloudflare Workers as the hosting platform for the build-engine gateways, on the terms above.
2. YES: Claude may prepare this closure on a new branch and open a pull request touching only this ADR file.
3. YES: Claude does not merge, tag, release, or push to `main`; the operator reviews and merges.
4. YES: the session token supplied is for this task only, is not stored in memory, files, or logs, and the operator will revoke it after the PR is opened.
5. NO: no creation, change, or deployment of anything on Cloudflare is authorized by this task. This change is documentation only.
