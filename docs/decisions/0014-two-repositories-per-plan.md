# 0014: two repositories per plan; submissions repository and branch for the pilot

Status: **decided** (2026-11-10)

Resolves the condition recorded in ADR 0012 (section "condition on the submissions repository"). Records the operator's decision after the S5 entry-gate review of 2026-11-10.

## Question
ADR 0012 names `acme-pilot-dev` as both the read repository and the submissions repository. The S5 entry gate requires the submissions repository to be distinct from the read repository and from the consumer repository, unless the operator records a new decision accepting that or naming a separate repository. Which applies, and which branch and folder does the pilot plan use?

## Decision
1. **Two repositories per plan.** A plan has a private development repository and a public upstream repository. For the pilot these are `acme-pilot-dev` (private) and `acme-pilot` (public). The development repository holds the plan, is read by the workers, the Supervisor and the operator console, and receives submissions. The public repository is the consumer: it surfaces the final task pull request. A third repository per plan is not created.
2. **Weaker separation accepted.** `acme-pilot-dev` is the read repository and the submissions repository. The operator accepts that the write gateway's credential can therefore write to the repository that holds the plan, and that the S6 transfer of a sealed submission is a copy within the development repository. Strengthening the separation between read and write inside the repository is left to a later release. No work or release is committed by this decision.
3. **Submissions branch and task folder (pilot plan).** Branch `submissions`. The task folder is the write gateway's existing template, unchanged: `plans/{plan}/submissions/{order}/{task}`, filled from the signed capability (for example `plans/<plan>/submissions/<work-order>/<task-id>`). The branch name is a plan value, not a build-engine convention. The template is engine configuration today; moving it out of the infrastructure is P-003.
4. **Credentials.** The operator states that the read token and the write token are scoped to `acme-pilot-dev` only. The write gateway has no access to the public repository `acme-pilot`.
5. **What S5 still checks.** Without waiving the rest of the entry gate, S5 verifies by API read that the branch `submissions` exists in `acme-pilot-dev` with the task folders; that the configured write credential, used inside the workflow and never printed, reaches `acme-pilot-dev` only and not `acme-pilot`; and that the write gateway production secrets exist by name. The gateway never creates the branch or the folders.

## Consequences
- The S5 entry condition on the submissions repository is met once the branch and folders exist and the credential check passes. If a check fails, S5 is BLOCKED-EXTERNAL and the report says which.
- Plan-specific repository, branch and folder values remain in gateway configuration for 0.6.0 (the ADR 0012 allowlist model). Moving them out of the infrastructure is recorded as pending decisions P-002 and P-003 in `docs/PENDING-REGISTER.md`, target 0.6.1.
- Decision 3 is recorded in the ADR index as closing the "branch not named" part of ADR 0012 item 4.

## Records
Approver: John Wendell, operator and lead architect, inscope-labs. Recorded from the operator's instructions of 2026-11-10: two repositories per plan, `acme-pilot-dev` for both read and submissions, branch name `submissions` approved as suggested (the folder follows the gateway's existing template), read and write token scoped to the development repository only.
