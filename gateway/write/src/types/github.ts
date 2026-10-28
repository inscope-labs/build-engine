/**
 * The GitHub API shapes the write gateway uses.
 *
 * **Stage 5.3.** The client that calls these (`src/commit/github-client.ts`) is Stage 5.3's work.
 * The types are declared here so that the session and staging layers, which Stage 5.2 implements,
 * can talk about a commit record without depending on the client.
 */

/** A file in the GitHub contents API. */
export interface GitHubContent {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000";
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size: number;
  url: string;
  git_url: string;
  html_url: string;
  download_url: string | null;
}

/** A tree entry in the git data API. */
export interface GitHubTreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000";
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url: string;
}

/** A commit as the git data API returns it. */
export interface GitHubCommit {
  sha: string;
  node_id?: string;
  url: string;
  html_url?: string;
  message: string;
  tree: { sha: string; url: string };
  parents: { sha: string; url: string }[];
}

/** A reference in the git data API. */
export interface GitHubRef {
  ref: string;
  node_id?: string;
  url: string;
  object: { sha: string; type: string; url: string };
}

/** The error body GitHub returns. */
export interface GitHubError {
  message: string;
  documentation_url?: string;
  status?: string;
}

/**
 * The subset of GitHub's status codes the client has to distinguish.
 *
 * The client maps these onto the gateway's own error codes; a GitHub status is never passed
 * through to the agent (protocol section 10.3).
 */
export const GITHUB_STATUS = {
  ok: 200,
  created: 201,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessable: 422,
  tooManyRequests: 429,
  serverError: 500,
  badGateway: 502,
  serviceUnavailable: 503,
  gatewayTimeout: 504,
} as const;
