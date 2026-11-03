# 0008: hosting scope, hostnames, and repositories (amends 0001)

Status: **decided** (2026-11-02), with open items listed below

Closes plan decision D-6. Amends ADR 0001 as closed in pull request #33 (hosting scope and production hostname).

## Question
Which services does the Cloudflare Workers decision cover, on which hostnames do they run, and which repositories do the gateways read and write?

## Decision
1. **Scope.** ADR 0001 also covers Gateway A, the operator gateway in operator-console, in addition to the read and write gateways.
2. **Production on `workers.dev`.** The operator chose `workers.dev` for production as well as staging (D-6.1, option b). The repository's gates currently forbid this, so the gates are to be changed (see Consequences). Until they are changed, the gates keep refusing to publish production on `workers.dev`.
3. **Hostnames.** The operator supplied `qnuralink.workers.dev` as the host for the read gateway, the write gateway and Gateway A, in every environment. As far as the platform's naming scheme goes, a Worker is served at `<worker-name>.<account-subdomain>.workers.dev`, and every Worker and environment needs its own hostname because a link or work order pins the host (ADR 0002). So `qnuralink.workers.dev` is recorded as the account zone, and the exact per-Worker hostnames are fixed at first deployment and recorded then.
4. **Shared zone mitigations.** Because staging, production and Gateway A share one zone, the operator asked that side effects be mitigated: distinct Worker names per gateway and environment; distinct signing keys and distinct GitHub credentials per environment (ADR 0001 closure); no wildcard routes; distinct destinations per environment; links minted per environment host so a link from one environment is not accepted by another; explicit operator approval for every production deploy.
5. **Submissions and read repositories are per plan.** A read or write operation needs a work order, which needs a task, which needs a plan, which needs a private submissions repository, linked to a public repository that surfaces the final task pull request. The operator creates these through the operator console during plan onboarding. The submissions repository and the production read repository (`GITHUB_REPO`) are therefore **not known beforehand** and are not recorded here.
6. **Pilot repositories.** Disposable pilot repositories will be created by the operator and the staging token's repository selection widened to them. Names: to be supplied.
7. **Stray repositories.** The operator will delete `build-engine-staging-source`, `build-engine-staging-submissions` and `be-staging-probe2` by hand.

## Rationale
Records the operator's hosting and repository choices as given, and makes the gate conflict explicit instead of leaving it implicit.

## Consequences
- **Gate change needed (separate authorization).** `gateway/read/production/ops/render-environments.py` and `environments.json`/`environments.md` forbid production on `workers.dev`; the write gateway's production block pins `workers_dev = false` (protocol section 12.5). Changing them is code work outside this assignment's authorized paths.
- **Open item DX-1, credential model for per-plan repositories.** Both gateways currently take a fixed repository in configuration, and a fine-grained token cannot be scoped to a repository that does not exist yet. How a gateway learns and is authorized for a repository created at onboarding is not decided here. It must be decided before any production deploy.
- **Open item DX-2.** Exact hostnames, the pilot repository names and the plan tier are to be supplied.

## Blocks resolved
D-6 as far as it can be decided today; hostname question in ADR 0001 closure.

## Operator authorization
Recorded from the operator's completed decisions questionnaire, uploaded 2026-11-02. Approver: John Wendell, operator and lead architect, inscope-labs. Statements 1-8 were answered YES (decisions closed as answered; pull requests on both repositories limited to decision and release documents; no merge, tag, release or push to `main` by Claude; session token used for this assignment only; signed acceptance of the D-5 risks). Statement 9 was answered NO: nothing on Cloudflare is created, changed or deployed, and no secret is handled, in this assignment.
