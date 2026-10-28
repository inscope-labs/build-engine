/**
 * The commit: the one operation that leaves the gateway and touches the outside world.
 *
 * The contract specifies it in section 8.1, and the shape of the implementation follows the
 * contract's order of preconditions:
 *
 *   1. the session is open (the session layer decides this);
 *   2. the selection is not empty;
 *   3. every selected path is a live staged file;
 *   4. every selected file passes the type policy and the size limits;
 *   5. the selection contains no tombstoned path;
 *   6. **the branch head still equals the capability's `head`**;
 *   7. the idempotency key is new, or is being replayed with the same payload.
 *
 * Precondition 6 is the interesting one. The capability is signed, so the agent cannot choose
 * the parent of its commit: the parent is the head the operator saw when the capability was
 * minted. If the branch has moved since, the commit is refused. That single check is what stops
 * two writers — or an agent and an operator — from racing each other onto the branch.
 *
 * **The commit is made in two steps, and the split is deliberate.**
 *
 * The first step creates the *objects*: a blob per file, a tree, and a commit. None of them is
 * referenced by anything, so a failure here leaves garbage that the provider collects and no
 * trace on the branch. It is safe to retry, and it is safe to repeat.
 *
 * The second step *moves the branch*. It is one call, it is not retried blindly, and if it fails
 * in a way that leaves the outcome unknown, the gateway **goes and looks**:
 *
 *   - the branch points at our commit — it landed; the commit is a fact;
 *   - the branch still points at the expected head — it did not land; the update is repeated;
 *   - the branch points somewhere else — **we cannot tell**, and the answer is
 *     `409 reconcile-required`, never a second commit.
 *
 * That last case is the one the contract insists on (section 13.3): "the gateway MUST NOT guess,
 * and MUST NOT issue a second commit to find out."
 */
import { commitMessage } from "../config/constants.ts";
import { GitHubClient, ProviderError } from "./github-client.ts";
import { providerCode, providerMessage, withRetry, type RetryPolicy } from "./retry.ts";
import type { SelectedFile } from "./selection.ts";

/** What the commit needs to know. */
export interface CommitInput {
  /** The client. */
  client: GitHubClient;
  /** The task folder, relative to the repository root. */
  folder: string;
  /** The task. */
  task: string;
  /** The work order. */
  order: string;
  /** The head the capability was minted against. The commit's only parent. */
  expectedHead: string;
  /** The commit's timestamp, in unix seconds. Fixed, so that a repeated attempt is the same commit. */
  startedAt: number;
  /** The validated selection. */
  files: SelectedFile[];
  /** The retry policy. */
  policy: RetryPolicy;
  /** The sleep between attempts. */
  sleep: (ms: number) => Promise<void>;
  /** The commit's author name. */
  authorName: string;
  /** The commit's author email. */
  authorEmail: string;
}

/** The result of a commit attempt. */
export type CommitResult =
  | { ok: true; sha: string; treeSha: string; message: string }
  | { ok: false; code: string; message: string };

/**
 * Create the commit object.
 *
 * Nothing on the branch changes here. The result is a sha that can be pointed at, and the caller
 * records it before it points at it, so that a crash between the two leaves a trace that the next
 * attempt can follow.
 */
export async function createCommitObject(input: CommitInput): Promise<CommitResult> {
  const { client, policy, sleep } = input;

  // Precondition 6: the head the capability names is the head the branch has.
  let head: string;
  try {
    head = await withRetry(() => client.getBranchHead(), policy, sleep);
  } catch (e) {
    return { ok: false, code: providerCode(e, headMissingCode(e)), message: providerMessage(providerCode(e, headMissingCode(e))) };
  }
  if (head !== input.expectedHead) {
    return {
      ok: false,
      code: "expected-sha-conflict",
      message: "the submissions branch moved since the capability was issued",
    };
  }

  // The base tree: everything already in the repository, carried over untouched.
  let treeSha: string;
  try {
    const info = await withRetry(() => client.getCommit(input.expectedHead), policy, sleep);
    treeSha = info.treeSha;
  } catch (e) {
    const code = providerCode(e);
    return { ok: false, code, message: providerMessage(code) };
  }

  // The task folder must already exist. The gateway does not create it: the folder is the
  // operator's, and a commit that silently created one would be a commit outside the task.
  const folder = await resolveFolderTree(client, treeSha, input.folder, policy, sleep);
  if (!folder.ok) {
    // The walk distinguishes "the folder is not there" from "the provider let us down". A
    // transient provider failure is not a missing folder, and answering `404 task-folder-missing`
    // for it would send the agent to the operator for something that a retry fixes.
    const code = folder.code === "missing" ? "task-folder-missing" : providerCode(folder.error);
    return { ok: false, code, message: providerMessage(code) };
  }

  // The blobs.
  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of input.files) {
    let blob: string;
    try {
      blob = await withRetry(() => client.createBlob(file.content), policy, sleep);
    } catch (e) {
      const code = providerCode(e);
      return { ok: false, code, message: providerMessage(code) };
    }
    entries.push({ path: file.repositoryPath, mode: "100644", type: "blob", sha: blob });
  }

  // The tree: the base tree plus the selected files, at their paths in the task folder.
  let newTree: string;
  try {
    newTree = await withRetry(() => client.createTree(treeSha, entries), policy, sleep);
  } catch (e) {
    const code = providerCode(e);
    return { ok: false, code, message: providerMessage(code) };
  }

  // The commit object. Its date is fixed by the caller, so that the same payload committed twice
  // is the same commit object, and so that a repeated attempt points at the same sha.
  const message = commitMessage(input.task, input.order, input.files.map((file) => file.path));
  const date = new Date(input.startedAt * 1000).toISOString();
  let sha: string;
  try {
    sha = await withRetry(
      () =>
        client.createCommit({
          tree: newTree,
          parents: [input.expectedHead],
          message,
          date,
          authorName: input.authorName,
          authorEmail: input.authorEmail,
        }),
      policy,
      sleep,
    );
  } catch (e) {
    const code = providerCode(e);
    return { ok: false, code, message: providerMessage(code) };
  }

  return { ok: true, sha, treeSha: newTree, message };
}

/**
 * Move the branch to the commit.
 *
 * This is the step that can leave the outcome unknown, and it is the step that is therefore
 * never retried blindly.
 */
export async function deliverCommit(
  input: CommitInput & { sha: string },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { client, policy, sleep, sha, expectedHead } = input;

  // A rate limit is definite: the provider refused the request without acting on it, so the
  // branch did not move and the call can simply be repeated.
  let last: unknown = null;
  for (let attempt = 1; attempt <= Math.max(1, policy.maxAttempts); attempt++) {
    try {
      await client.updateRef(sha);
      return { ok: true };
    } catch (e) {
      last = e;
      if (isRateLimited(e) && attempt < policy.maxAttempts) {
        await sleep(Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs));
        continue;
      }
      break;
    }
  }

  // A definite failure: the provider answered, and the answer says the request was refused.
  if (!isIndeterminate(last)) {
    const code = providerCode(last);
    return { ok: false, code, message: providerMessage(code) };
  }

  // The outcome is unknown. Look at the branch and decide. The read is retried like any other,
  // because a rate limit on the *read* is not a reason to give up on reading it.
  let head: string | null = null;
  try {
    head = await withRetry(() => client.getBranchHead(), policy, sleep);
  } catch {
    head = null;
  }

  if (head === sha) {
    // It landed. The commit is a fact, whatever the response said.
    return { ok: true };
  }

  if (head === expectedHead) {
    // It demonstrably did not land: the branch is exactly where it was. One more attempt, with
    // the same sha, which makes the update idempotent.
    try {
      await client.updateRef(sha);
      return { ok: true };
    } catch (e) {
      if (isRateLimited(e)) {
        const code = providerCode(e);
        return { ok: false, code, message: providerMessage(code) };
      }
      try {
        const again = await client.getBranchHead();
        if (again === sha) return { ok: true };
      } catch {
        // The branch could not be read. The outcome is still unknown.
      }
      return {
        ok: false,
        code: "reconcile-required",
        message: "the commit's outcome is unknown; stop and ask the operator to reconcile the branch",
      };
    }
  }

  return {
    ok: false,
    code: "reconcile-required",
    message: "the commit's outcome is unknown; stop and ask the operator to reconcile the branch",
  };
}

/**
 * Walk the tree to the task folder.
 *
 * Returns the folder's tree sha, or the reason it is not there. The reason matters: "the folder
 * is not there" and "the provider failed while we were looking" are different answers, and only
 * the first one is the operator's fault.
 *
 * The walk is one level at a time rather than one recursive listing, because a recursive listing
 * of a large repository is a large response and can be truncated, and a truncated listing cannot
 * answer the question reliably. The walk is bounded by the folder's depth, which the template
 * fixes.
 */
async function resolveFolderTree(
  client: GitHubClient,
  baseTreeSha: string,
  folder: string,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true; sha: string } | { ok: false; code: "missing"; error?: undefined } | { ok: false; code: "failed"; error: unknown }> {
  let sha = baseTreeSha;
  for (const part of folder.split("/")) {
    if (part === "") return { ok: false, code: "missing" };
    let tree: { entries: { path: string; type: string; sha: string }[] };
    try {
      tree = await withRetry(() => client.getTree(sha), policy, sleep);
    } catch (e) {
      // A 404 means the tree itself is gone, which is the folder being absent. Anything else is
      // the provider's problem.
      if (e instanceof ProviderError && e.kind === "status" && e.status === 404) {
        return { ok: false, code: "missing" };
      }
      return { ok: false, code: "failed", error: e };
    }
    const entry = tree.entries.find((candidate) => candidate.path === part && candidate.type === "tree");
    if (entry === undefined) return { ok: false, code: "missing" };
    sha = entry.sha;
  }
  return { ok: true, sha };
}

/** Whether the provider refused the request with a rate limit. */
function isRateLimited(e: unknown): boolean {
  return e instanceof ProviderError && e.kind === "status" && e.status === 429;
}

/**
 * Whether the outcome is unknown.
 *
 * A timeout, a network failure and a 5xx all leave the question open: the provider may have acted
 * before it failed. A 4xx does not — the provider refused, and refused means refused.
 */
function isIndeterminate(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  if (e.kind === "timeout" || e.kind === "network") return true;
  return e.kind === "status" && e.status !== null && e.status >= 500;
}

/** The code for a head read that found no branch. */
function headMissingCode(e: unknown): string | undefined {
  if (e instanceof ProviderError && e.kind === "status" && e.status === 404) {
    return "gateway-misconfigured";
  }
  return undefined;
}
