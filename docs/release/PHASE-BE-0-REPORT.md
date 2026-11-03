# Phase BE-0 report: decisions closed (2026-11-02)

Plan: `V0.6.0-BUILD-PLAN.md` (formerly "v0.5.1"). Source: operator decisions questionnaire, uploaded 2026-11-02.

## Decisions recorded

| Question | Operator answer | Recorded in |
|---|---|---|
| Q0.1 release path | No 0.5.1; next release is 0.6.0; claims gated on OC-1..OC-8, BE-4..BE-7, deployed staging, A03 Core acceptance | ADR 0006 |
| Q0.2 release-note wording | Custom wording: gateways and console "production ready, deployed, and supported" | ADR 0006 item 4 (conditional) |
| D-1 | Revise contract; all content lands in 0.6.0 | ADR 0006 |
| D-2 | Left blank; `0.6.0` typed in the identifier field | ADR 0006 item 3 (`build-engine/0.6`, confirm) |
| D-3, D-3b, D-4 | Defaults | ADR 0006 |
| D-5, D-5b | Accepted for staging and production | ADR 0007 |
| D-6.1 | `workers.dev` for production too | ADR 0008 (gate change pending) |
| D-6.2, D-6.3 | Per plan, unknown beforehand | ADR 0008 (open DX-1) |
| D-6.4, D-6.5 | Defaults | ADR 0008 |
| D-6.6 | Leave PR #33 as written, change the gates instead | ADR 0008 |
| D-7 | Answered for operator-console: no protection, AI Studio pushes to `main` | ADR 0009 |
| C-1..C-5 | See operator-console ADR 0007 to 0010 | operator-console |

## Still open
- **BE-0 documents:** `COMPATIBILITY-MATRIX.md`, `CAPABILITY-CONFORMANCE.md`, `CBRIDGE-COVERAGE-MATRIX.md`.
- **DX-1:** credential model for per-plan repositories.
- **DX-2:** exact hostnames, pilot repository names, plan tier.
- **Gate change:** production on `workers.dev` (code, separate authorization).
- **Protocol identifier change** to `build-engine/0.6` (code, templates, tests).
- **Registers:** `DEFECT-REGISTER.md` and `docs/STATUS.md` do not yet reflect ADR 0007.
- **Stage 6.2:** blocked on Cloudflare credentials, which this assignment does not touch.

## Flags for the reviewer
- The Q0.2 wording claims production readiness that no gate has yet passed; it is recorded as a conditional target only.
- D-6.1 conflicts with the gates in force; they stay in force until changed.
- `qnuralink.workers.dev` cannot by itself be one host for four Workers; per-Worker hostnames are fixed at first deployment.

## Operator authorization
Recorded from the operator's completed decisions questionnaire, uploaded 2026-11-02. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1-8 were answered YES (decisions closed as answered; pull requests on both repositories limited to decision and release documents; no merge, tag, release or push to `main` by Claude; session token used for this assignment only; signed acceptance of the D-5 risks). Statement 9 was answered NO: nothing on Cloudflare is created, changed or deployed, and no secret is handled, in this assignment.
