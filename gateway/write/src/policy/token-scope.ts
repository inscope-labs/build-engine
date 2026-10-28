/**
 * The credential's scope (protocol section 12; plan task 5.4.5 and 5.5.8).
 *
 * The gateway's provider credential is **repository-scoped, not path-scoped**. That is the honest
 * description of what a GitHub credential can do, and the protocol says so in section 12.4 rather
 * than pretending otherwise. The confinement of the *files* — the paths, the branch, the folder —
 * is the gateway's own code, and the credential is the last line of defence around it.
 *
 * Two things follow, and this module holds the decision for both.
 *
 * **The static half.** The gateway's client has a fixed set of methods, and every one of them
 * reaches one repository and one branch. There is no method that creates a branch, merges,
 * deletes, force-pushes, opens a pull request or writes anywhere else. That is a property of the
 * *code*, and it can be checked without a credential — which is why it can be a CI gate.
 *
 * **The live half.** The credential itself may carry more authority than the gateway needs. The
 * scopes that the gateway has no business holding — the ones that would let it modify CI, delete
 * a repository, or reach the organisation — are refused outright, and a token whose scopes cannot
 * be determined is **not** passed silently: the check fails and says what to confirm by hand.
 *
 * The rules are here, in the source, rather than in the script, so that they can be unit-tested
 * and so that the script and the test cannot disagree.
 */

/** The scopes the gateway has no business holding. */
export const FORBIDDEN_SCOPES: readonly string[] = [
  // The gateway must not be able to change CI. A credential that can write a workflow file can
  // run code on the repository's runners.
  "workflow",
  // Administration of the repository or the organisation.
  "admin:org",
  "admin:org_hook",
  "admin:repo_hook",
  "admin:repo",
  "admin:sso",
  "admin:public_key",
  "admin:gpg_key",
  "delete_repo",
  // The gateway writes files into one folder. It has no business with packages, pages or gists.
  "write:packages",
  "delete:packages",
  "pages",
  "gist",
  // The gateway is a machine, not a person: it has no notifications, no profile and no keys.
  "notifications",
  "user",
  "read:user",
  "write:user",
];

/** The scope a classic token needs, to write into one repository. */
export const REQUIRED_CLASSIC_SCOPES: readonly string[] = ["repo"];

/** What the check concluded. */
export interface ScopeVerdict {
  /** Whether the credential may be used as it is. */
  ok: boolean;
  /** The scopes, or null when they could not be determined. */
  scopes: string[] | null;
  /** What is wrong, one line per problem. */
  findings: string[];
  /** A note for the operator. It is not a finding. */
  note: string;
}

/**
 * Judge a set of scopes.
 *
 * `scopes` is null when the provider did not say — which is what a fine-grained token looks like
 * from the outside, because its permissions are not expressed as OAuth scopes. A null verdict is
 * **not** a pass: the check cannot confirm the scope, and the operator has to.
 */
export function evaluateScopes(scopes: string[] | null): ScopeVerdict {
  if (scopes === null) {
    return {
      ok: false,
      scopes: null,
      findings: [
        "the credential's scopes could not be determined; confirm them by hand before deploying",
      ],
      note:
        "a fine-grained token does not report OAuth scopes, so the check cannot confirm them. " +
        "It must grant write access to the submissions repository and to nothing else.",
    };
  }

  const findings: string[] = [];
  for (const scope of FORBIDDEN_SCOPES) {
    if (scopes.includes(scope)) findings.push(`the credential carries the "${scope}" scope, which the gateway does not need`);
  }
  for (const scope of REQUIRED_CLASSIC_SCOPES) {
    if (!scopes.includes(scope)) {
      findings.push(`the credential does not carry the "${scope}" scope, so it cannot write to the submissions repository`);
    }
  }

  return {
    ok: findings.length === 0,
    scopes,
    findings,
    note:
      "a classic token with the \"repo\" scope reaches every repository the account can reach, " +
      "not only the submissions repository. That is the residual risk the contract records in " +
      "section 12.4, and a fine-grained token is the way to reduce it.",
  };
}

/**
 * The methods the provider client has.
 *
 * Every one of them reaches the configured repository and the configured branch, and there is
 * deliberately no method that creates a branch, merges, deletes, force-pushes or writes to
 * another repository. This list is the client's *entire* reach, and the check below holds the
 * client to it.
 */
export const EXPECTED_CLIENT_METHODS: readonly string[] = [
  "getBranchHead",
  "getCommit",
  "getTree",
  "createBlob",
  "createTree",
  "createCommit",
  "updateRef",
];

/** The names a method may not have. A new one is a change to the credential's blast radius. */
export const FORBIDDEN_CLIENT_METHODS: readonly string[] = [
  "createRef",
  "deleteRef",
  "merge",
  "createPullRequest",
  "deleteFile",
  "forceUpdateRef",
  "setBranch",
];

/**
 * Judge the provider client's methods.
 *
 * The list is the whole reach of the credential inside this codebase, so a method that is not on
 * the list is either a new capability (which the operator must be told about) or a mistake.
 */
export function evaluateClientMethods(names: readonly string[]): ScopeVerdict {
  const findings: string[] = [];
  for (const name of names) {
    if (FORBIDDEN_CLIENT_METHODS.includes(name)) {
      findings.push(`the provider client has a "${name}" method, which widens the credential's reach`);
    }
  }
  for (const expected of EXPECTED_CLIENT_METHODS) {
    if (!names.includes(expected)) {
      findings.push(`the provider client has no "${expected}" method; the check cannot confirm the credential's reach`);
    }
  }
  return {
    ok: findings.length === 0,
    scopes: null,
    findings,
    note: "the credential's reach inside this codebase is the provider client's method list",
  };
}
