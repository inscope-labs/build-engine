// scripts/check-token-scope.ts: the provider credential's scope check.
//
// The gateway's provider credential is repository-scoped, not path-scoped, and the protocol says
// so plainly (section 12.4). This script is the check behind that claim, and it has two halves.
//
//   1. **The static half** (`--static`, and the default when there is no token): the provider
//      client's method list is the credential's entire reach inside this codebase, and every
//      method in it reaches one repository and one branch. A method that creates a branch,
//      merges, deletes or force-pushes would widen that reach, and the check fails. This half
//      needs no credential, so it runs in CI on every pull request.
//
//   2. **The live half** (a token is given): GitHub is asked what scopes the credential carries,
//      and a scope the gateway has no business holding — `workflow`, `admin:*`, `delete_repo`,
//      `write:packages` and the rest — is refused. A credential whose scopes cannot be
//      determined is **not** passed silently: the check fails and says what to confirm by hand.
//
// The token is read from the environment, never from an argument, so that it does not end up in
// the shell history or in the process list. It is never printed.
//
// Run it with:
//
//     GITHUB_TOKEN=… node --experimental-strip-types scripts/check-token-scope.ts
//     node --experimental-strip-types scripts/check-token-scope.ts --static
import { GitHubClient } from "../src/commit/github-client.ts";
import {
  evaluateClientMethods,
  evaluateScopes,
  type ScopeVerdict,
} from "../src/policy/token-scope.ts";

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
  /** The token, or null when there is none. */
  token: string | null;
  /** The API base. */
  apiBase: string;
  /** Whether the static half alone was asked for. */
  staticOnly: boolean;
  /** A usage problem, or null. */
  problem: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    token: process.env.GITHUB_TOKEN ?? null,
    apiBase: process.env.GITHUB_API_BASE ?? "https://api.github.com",
    staticOnly: false,
    problem: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    switch (argument) {
      case "--static":
        options.staticOnly = true;
        break;
      case "--api-base": {
        const value = argv[++i];
        if (value === undefined) {
          options.problem = "--api-base needs a value";
          return options;
        }
        options.apiBase = value;
        break;
      }
      case "--help":
        options.problem = "usage: check-token-scope [--static] [--api-base URL]";
        return options;
      default:
        options.problem = `unknown argument: ${argument}`;
        return options;
    }
  }
  return options;
}

/** The methods the client actually has. */
function clientMethods(): string[] {
  return Object.getOwnPropertyNames(GitHubClient.prototype).filter(
    (name) => name !== "constructor" && !name.startsWith("#"),
  );
}

/** Ask GitHub what scopes the credential carries. */
async function readScopes(token: string, apiBase: string): Promise<string[] | null> {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "build-engine-write-gateway-scope-check",
    },
  });
  if (!response.ok) {
    throw new Error(`the provider answered ${response.status}`);
  }
  const header = response.headers.get("x-oauth-scopes");
  if (header === null) return null;
  return header
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");
}

/** Print a verdict. */
function report(what: string, verdict: ScopeVerdict): void {
  console.log(`${what}: ${verdict.ok ? "OK" : "FAILED"}`);
  if (verdict.scopes !== null) console.log(`  scopes: ${verdict.scopes.join(", ") || "(none)"}`);
  for (const finding of verdict.findings) console.error(`  - ${finding}`);
  if (verdict.note !== "") console.log(`  note: ${verdict.note}`);
}

const options = parseOptions(process.argv.slice(2));

if (options.problem !== null) fail(options.problem);

// The static half always runs: it needs no credential, and it is the half that CI runs.
const staticVerdict = evaluateClientMethods(clientMethods());
report("the credential's reach in the code", staticVerdict);
if (!staticVerdict.ok) {
  console.error("");
  console.error("token scope check: FAILED");
  process.exit(1);
}

if (options.staticOnly) {
  console.log("");
  console.log("token scope check: OK (the static half only; no credential was presented)");
  process.exit(0);
}

if (options.token === null || options.token === "") {
  console.error("  - no credential was presented; set GITHUB_TOKEN to check its scopes");
  console.error("");
  console.error("token scope check: FAILED");
  fail("", 1);
}

let scopes: string[] | null = null;
try {
  scopes = await readScopes(options.token, options.apiBase);
} catch (e) {
  // The check cannot confirm the scope, so it cannot pass the credential.
  console.error(`  - the provider could not be asked about the credential: ${e instanceof Error ? e.message : "unknown"}`);
  console.error("");
  console.error("token scope check: FAILED");
  fail("", 1);
}

const liveVerdict = evaluateScopes(scopes);
report("the credential's scopes", liveVerdict);
if (!liveVerdict.ok) {
  console.error("");
  console.error("token scope check: FAILED");
  process.exit(1);
}

console.log("");
console.log("token scope check: OK");
