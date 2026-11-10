# 0012: compatibility record, hostnames, repositories and credential model

Status: **decided** (2026-11-08); the condition on the submissions repository is resolved by ADR 0014 (2026-11-10)

Closes Q-4, the compatibility-record schema approval and Q-5 of `docs/release/COMPATIBILITY-MATRIX.md`, and the open items DX-1 and DX-2 of ADR 0008.

## Question
Where does the compatibility record live, is its schema approved, what are the final production hostnames, repositories and plan tier, and how is a gateway authorized for a repository?

## Decision
1. **Q-4, record location.** Both: committed under `release/` so it is reviewable, and published as a release asset so a consumer can fetch it without the repository.
2. **Compatibility-record schema.** Approved as proposed in `COMPATIBILITY-MATRIX.md` section 3, including its six validation rules.
3. **Q-5 and DX-2, final values.** The values recorded in `COMPATIBILITY-MATRIX.md` section 6 are final:
   - read gateway `ctxgate-read.qnuralink.workers.dev`;
   - write gateway `ctxgate-write.qnuralink.workers.dev`;
   - Gateway A `cbridge.qnuralink.workers.dev`;
   - production read repository (`GITHUB_REPO`) `acme-pilot-dev` (private);
   - pilot repositories `acme-pilot` (public) and `acme-pilot-dev` (private);
   - Cloudflare plan: **Paid**.
4. **Submissions repository.** The operator stated `acme-pilot-dev` as the private submissions repository. The submissions branch was not named. See the condition below.
5. **DX-1, credential model.** Confirmed as recorded in section 6: the gateway configuration holds an operator-declared allowlist of plan repositories, the operator widens the GitHub token's repository selection by hand at onboarding, and there is no GitHub App.

## Condition on item 4
The operator's answer names the same repository (`acme-pilot-dev`) as both the read repository and the submissions repository. The write gateway's contract and the S5 entry gate require that the submissions credential reaches the submissions repository only, and that the write gateway has no access to the consumer repository. Using one repository for both removes that separation and makes the S6 transfer (sealed submissions to consumer) a copy within one repository. The S5 entry gate therefore checks that the submissions repository is distinct from the read repository and the consumer repository, and that the submissions branch exists. If the operator keeps the same repository, the operator must record a new decision that accepts the weaker separation and names the branch; until then S5 is BLOCKED-EXTERNAL. This does not block S0 or S1 to S4.

## Rationale
Records the operator's answers to the S0 questionnaire. The values in item 3 were already recorded in section 6 as operator decisions.

## Consequences
- ADR 0008 open items DX-1 and DX-2 are closed. ADR 0008's status line is updated to say so.
- Stages S4 and S5 verify the deployed hostnames against item 3 and the gateway configuration against the allowlist model.
- Stage S8 writes the compatibility record to both places named in item 1.

## Blocks resolved
D-6 open items DX-1 and DX-2; Q-4; Q-4b; Q-5.

## Operator authorization
Recorded from the operator's completed S0 decisions questionnaire, uploaded 2026-11-08. Approver: John Wendell, operator and lead architect, inscope-labs. Answers were the defaults (A), with the submissions repository supplied as `acme-pilot-dev`.
