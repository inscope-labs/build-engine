// scripts/seed-test-repo.ts: prepare a throwaway repository for a rehearsal.
//
// The gateway will not create the submissions branch and will not create the task folder: the
// folder is the operator's, and a gateway that created one would be a gateway writing outside the
// task (protocol section 12.3). So somebody has to create them, and this is that somebody.
//
// It is an **operator tool**, deliberately not part of the gateway: it can create a branch, which
// the gateway's own client has no method to do, and it therefore has a wider reach than the
// gateway's credential. That is why it:
//
//   - reads the credential from the environment, never from an argument;
//   - refuses to run without an explicit confirmation;
//   - refuses to touch a branch that already exists;
//   - never force-pushes and never merges.
//
// The tree it writes holds the placeholder file, `.keep`, because git does not store empty
// folders and the task folder has to exist before the work order is issued.
//
// Run it with:
//
//     GITHUB_TOKEN=… node --experimental-strip-types scripts/seed-test-repo.ts \
//       --repo owner/name --branch build-engine --folder plans/…/10008-1-001-01 \
//       --i-understand-this-writes-to-a-real-repository
import { base64url } from "../src/util/base64.ts";
import { utf8 } from "../src/util/hash.ts";

/**
 * Stop the script.
 *
 * The function is declared with an explicit `never` return type so that the type checker knows
 * the script stops here, rather than carrying on with a value that was never set. The `throw` at
 * the end is unreachable: `process.exit` does not return, but the Workers type declarations make
 * `process` an `any`, so the type checker cannot see that for itself.
 */
function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
  throw new Error("unreachable");
}

interface Options {
  repo: string | null;
  branch: string | null;
  folder: string | null;
  apiBase: string;
  confirmed: boolean;
  problem: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    repo: null,
    branch: null,
    folder: null,
    apiBase: process.env.GITHUB_API_BASE ?? "https://api.github.com",
    confirmed: false,
    problem: null,
  };
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === "--i-understand-this-writes-to-a-real-repository") {
      options.confirmed = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      options.problem = `unexpected argument: ${argument}`;
      return options;
    }
    const name = argument.slice(2);
    if (name === "help") {
      options.problem =
        "usage: seed-test-repo --repo owner/name --branch NAME --folder PATH --i-understand-this-writes-to-a-real-repository";
      return options;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) {
      options.problem = `--${name} needs a value`;
      return options;
    }
    values[name] = value;
  }
  options.repo = values.repo ?? null;
  options.branch = values.branch ?? null;
  options.folder = values.folder ?? null;
  return options;
}

/** One call to the provider. */
async function call(
  method: string,
  path: string,
  body: unknown,
  token: string,
  apiBase: string,
): Promise<{ status: number; value: unknown }> {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "build-engine-write-gateway-seed",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // The provider's body is not JSON; the text is kept for the message.
  }
  return { status: response.status, value };
}

const options = parseOptions(process.argv.slice(2));

if (options.problem !== null) fail(options.problem);

const repo = options.repo;
const branch = options.branch;
const folderArgument = options.folder;
if (repo === null || branch === null || folderArgument === null) {
  fail("--repo, --branch and --folder are all required");
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) fail("--repo must be owner/name");
if (!options.confirmed) {
  fail(
    "this writes to a real repository.\n" +
      "pass --i-understand-this-writes-to-a-real-repository to go ahead.",
  );
}

const token = process.env.GITHUB_TOKEN;
if (token === undefined || token === "") {
  fail("GITHUB_TOKEN is not set; it must be a credential with write access to the repository", 1);
}

const folder = folderArgument.replace(/^\/+|\/+$/g, "");
if (folder === "" || folder.split("/").some((part) => part === "" || part === "." || part === "..")) {
  fail("--folder must be a path inside the repository");
}

const api = options.apiBase;

// The branch must not exist. The tool does not overwrite anything.
const existing = await call("GET", `/repos/${repo}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, undefined, token, api);
if (existing.status === 200) {
  fail(`the branch "${branch}" already exists; this tool does not touch an existing branch`, 1);
}
if (existing.status !== 404) {
  fail(`the provider answered ${existing.status} when the branch was read`, 1);
}

// The placeholder file, because git does not store empty folders.
const placeholder = await call(
  "POST",
  `/repos/${repo}/git/blobs`,
  { content: base64url(utf8("")), encoding: "base64" },
  token,
  api,
);
if (placeholder.status !== 201) {
  fail(`the provider answered ${placeholder.status} when the placeholder was written`, 1);
}
const blob = (placeholder.value as { sha: string }).sha;

const tree = await call(
  "POST",
  `/repos/${repo}/git/trees`,
  { tree: [{ path: `${folder}/.keep`, mode: "100644", type: "blob", sha: blob }] },
  token,
  api,
);
if (tree.status !== 201) {
  fail(`the provider answered ${tree.status} when the tree was written`, 1);
}
const treeSha = (tree.value as { sha: string }).sha;

const commit = await call(
  "POST",
  `/repos/${repo}/git/commits`,
  {
    tree: treeSha,
    parents: [],
    message: `seed the task folder ${folder}`,
    author: { name: "build-engine seed tool", email: "ctxwrite@users.noreply.github.com" },
    committer: { name: "build-engine seed tool", email: "ctxwrite@users.noreply.github.com" },
  },
  token,
  api,
);
if (commit.status !== 201) {
  fail(`the provider answered ${commit.status} when the commit was written`, 1);
}
const commitSha = (commit.value as { sha: string }).sha;

const ref = await call(
  "POST",
  `/repos/${repo}/git/refs`,
  { ref: `refs/heads/${branch}`, sha: commitSha },
  token,
  api,
);
if (ref.status !== 201) {
  fail(`the provider answered ${ref.status} when the branch was created`, 1);
}

console.log(`repository:   ${repo}`);
console.log(`branch:       ${branch}`);
console.log(`task folder:  ${folder}`);
console.log(`commit:       ${commitSha}`);
console.log("");
console.log("The branch now holds the task folder and its placeholder. The gateway can commit into it.");
