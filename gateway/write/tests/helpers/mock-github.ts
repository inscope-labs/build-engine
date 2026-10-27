/**
 * A mock GitHub, served over real HTTP.
 *
 * The tests drive the **real** client against a **real** server on loopback. That matters more
 * than it sounds: a mock at the interface level would leave the client's own code — the URL it
 * builds, the headers it sends, the timeout it enforces, the way it reads a status — untested,
 * and that code is exactly where a delivery goes wrong.
 *
 * The server implements the part of the Git Data API the gateway uses, over an in-memory
 * repository, and it can be told to fail in the ways a provider fails:
 *
 *  - a route can be scripted to answer a status, once or always;
 *  - a route can be told to hang, so that the client's timeout is what ends the call;
 *  - every request is recorded, so that a test can assert what was sent.
 *
 * The shas are not git's. They are deterministic digests of the content, which is all the
 * gateway needs: the client treats a sha as an opaque name, and the *determinism* is what lets a
 * repeated commit attempt produce the same object.
 *
 * The trees are nested, the way git's are. A tree holds its immediate children, and a child of
 * type `tree` points at another tree. The gateway walks down the task folder one level at a
 * time, and a flat tree would make that walk impossible.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One recorded request. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A scripted failure. */
export interface ScriptedFailure {
  /** The status to answer. */
  status: number;
  /** How many times to answer it. The default is once. */
  times?: number;
  /** How long to wait before answering, in milliseconds. */
  delayMs?: number;
  /** Whether to apply the failure to every matching request until the script is cleared. */
  persistent?: boolean;
  /**
   * How the request is delayed.
   *
   * `"before"` — the answer is delayed and the change is **not** applied: the provider was too
   * slow to do anything.
   * `"after"` — the change **is** applied and the answer is delayed: the provider acted and then
   * stopped talking. This is the case that a blind retry turns into a duplicate commit.
   */
  hang?: "before" | "after";
}

/** A tree entry, as the API returns it. */
export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

/** A commit, as the mock stores it. */
export interface MockCommit {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
}

/** A flat entry: a path and the object it names. */
interface FlatEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export class MockGitHub {
  /** The trees, by sha. Each holds its immediate children. */
  private readonly trees = new Map<string, TreeEntry[]>();
  /** The commits, by sha. */
  private readonly commits = new Map<string, MockCommit>();
  /** The branches, by name. */
  private readonly branches = new Map<string, string>();
  /** The scripted failures, by `METHOD path`. */
  private readonly failures = new Map<string, ScriptedFailure[]>();
  /** Every request the server has seen. */
  readonly requests: RecordedRequest[] = [];
  /** The server. */
  private server: Server | null = null;
  /** The port it is listening on. */
  private port = 0;

  /** The API base URL. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Start listening. */
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = (this.server!.address() as AddressInfo).port;
  }

  /** Stop listening. */
  async stop(): Promise<void> {
    if (this.server === null) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /**
   * Script a failure.
   *
   * The key is `METHOD /path`, and the path may end in `*` to match a prefix. The script is
   * consumed one answer at a time, unless it is persistent.
   */
  fail(method: string, path: string, failure: ScriptedFailure): void {
    const key = `${method.toUpperCase()} ${path}`;
    const list = this.failures.get(key) ?? [];
    list.push(failure);
    this.failures.set(key, list);
  }

  /** Clear every scripted failure. */
  clearFailures(): void {
    this.failures.clear();
  }

  /** The sha a branch points at. */
  branchHead(branch: string): string | undefined {
    return this.branches.get(branch);
  }

  /** The files a branch holds, as full paths. */
  branchFiles(branch: string): string[] {
    const head = this.branches.get(branch);
    if (head === undefined) return [];
    const commit = this.commits.get(head);
    if (commit === undefined) return [];
    return this.flatten(commit.tree)
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path)
      .sort();
  }

  /** The content of a file on a branch. */
  fileContent(branch: string, path: string): string | undefined {
    const head = this.branches.get(branch);
    if (head === undefined) return undefined;
    const commit = this.commits.get(head);
    if (commit === undefined) return undefined;
    const entry = this.flatten(commit.tree).find((candidate) => candidate.path === path);
    if (entry === undefined) return undefined;
    return this.contents.get(entry.sha);
  }

  /** The commit a branch points at. */
  branchCommit(branch: string): MockCommit | undefined {
    const head = this.branches.get(branch);
    if (head === undefined) return undefined;
    return this.commits.get(head);
  }

  /** The number of commits the repository holds. */
  get commitCount(): number {
    return this.commits.size;
  }

  /** The requests that went to a path. */
  requestsTo(method: string, path: string): RecordedRequest[] {
    return this.requests.filter(
      (request) => request.method === method.toUpperCase() && request.path.startsWith(path),
    );
  }

  /**
   * Put a branch in place, with a tree that holds the given files.
   *
   * The files are `path → content`, and the paths are repository-relative. The tree is built
   * level by level, the way git builds one.
   */
  seedBranch(branch: string, files: Record<string, string>, message = "seed"): string {
    const entries: FlatEntry[] = Object.entries(files).map(([path, content]) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: this.blob(content),
    }));
    const tree = this.treeFromPaths(entries);
    const commit = this.writeCommit(tree, [], message);
    this.branches.set(branch, commit.sha);
    return commit.sha;
  }

  /** Move a branch to a commit. */
  setBranch(branch: string, sha: string): void {
    this.branches.set(branch, sha);
  }

  // ---- the server ----

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf-8");
    const method = (request.method ?? "GET").toUpperCase();
    const path = request.url ?? "/";
    this.requests.push({ method, path, headers: request.headers, body });

    const failure = this.takeFailure(method, path);
    if (failure !== null) {
      const delay = failure.delayMs ?? 0;
      if (failure.hang === "after") {
        // The change is applied first, and the answer comes too late for anyone to hear it.
        let result: { status: number; value: unknown };
        try {
          result = this.route(method, path, body);
        } catch (e) {
          result = { status: 500, value: { message: e instanceof Error ? e.message : "error" } };
        }
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        writeJson(response, result.status, result.value);
        return;
      }
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      writeJson(response, failure.status, { message: "scripted failure" });
      return;
    }

    try {
      const result = this.route(method, path, body);
      writeJson(response, result.status, result.value);
    } catch (e) {
      writeJson(response, 500, { message: e instanceof Error ? e.message : "error" });
    }
  }

  /** Take the next scripted failure for a request, if there is one. */
  private takeFailure(method: string, path: string): ScriptedFailure | null {
    for (const [key, list] of this.failures) {
      const [keyMethod, keyPath] = key.split(" ");
      if (keyMethod !== method) continue;
      if (keyPath !== undefined && keyPath.endsWith("*")) {
        if (!path.startsWith(keyPath.slice(0, -1))) continue;
      } else if (keyPath !== path) {
        continue;
      }
      const failure = list.shift()!;
      if (failure.persistent === true) list.push(failure);
      else if (list.length === 0) this.failures.delete(key);
      return failure;
    }
    return null;
  }

  /** The routes. */
  private route(method: string, path: string, body: string): { status: number; value: unknown } {
    const json = (status: number, value: unknown): { status: number; value: unknown } => ({ status, value });

    const match = /^\/repos\/[^/]+\/[^/]+\/git\/(.+)$/.exec(path);
    if (match === null) {
      return json(404, { message: "Not Found" });
    }
    const rest = match[1]!;

    if (method === "GET" && rest.startsWith("ref/heads/")) {
      const branch = decodeURIComponent(rest.slice("ref/heads/".length));
      const sha = this.branches.get(branch);
      if (sha === undefined) {
        return json(404, { message: "Not Found" });
      }
      return json(200, { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } });
    }

    if (method === "PATCH" && rest.startsWith("refs/heads/")) {
      const branch = decodeURIComponent(rest.slice("refs/heads/".length));
      const payload = JSON.parse(body) as { sha: string; force?: boolean };
      const current = this.branches.get(branch);
      if (current === undefined) {
        return json(404, { message: "Not Found" });
      }
      if (!this.commits.has(payload.sha)) {
        return json(422, { message: "Reference update failed" });
      }
      if (payload.force !== true && current !== payload.sha) {
        // A non-fast-forward is refused, the way git refuses it.
        const commit = this.commits.get(payload.sha)!;
        if (!this.isAncestor(commit.parents[0] ?? "", current)) {
          return json(422, { message: "Reference update failed" });
        }
      }
      this.branches.set(branch, payload.sha);
      return json(200, { ref: `refs/heads/${branch}`, object: { sha: payload.sha, type: "commit" } });
    }

    if (method === "GET" && rest.startsWith("commits/")) {
      const sha = decodeURIComponent(rest.slice("commits/".length));
      const commit = this.commits.get(sha);
      if (commit === undefined) {
        return json(404, { message: "Not Found" });
      }
      return json(200, {
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((parent) => ({ sha: parent })),
      });
    }

    if (method === "GET" && rest.startsWith("trees/")) {
      const sha = decodeURIComponent(rest.slice("trees/".length));
      const entries = this.trees.get(sha);
      if (entries === undefined) {
        return json(404, { message: "Not Found" });
      }
      return json(200, { sha, tree: entries });
    }

    if (method === "POST" && rest === "blobs") {
      const payload = JSON.parse(body) as { content: string; encoding: string };
      return json(201, { sha: this.blob(payload.content) });
    }

    if (method === "POST" && rest === "trees") {
      const payload = JSON.parse(body) as { base_tree?: string; tree: TreeEntry[] };
      // The base tree's files are carried over, and the new entries replace what is at the same
      // path. That is what a git tree with a base tree means.
      const base = payload.base_tree === undefined ? [] : this.flatten(payload.base_tree);
      const merged = new Map<string, FlatEntry>();
      for (const entry of base) merged.set(entry.path, entry);
      for (const entry of payload.tree) {
        merged.set(entry.path, { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha });
      }
      return json(201, { sha: this.treeFromPaths([...merged.values()]) });
    }

    if (method === "POST" && rest === "commits") {
      const payload = JSON.parse(body) as {
        tree: string;
        parents: string[];
        message: string;
        author?: { name: string; email: string; date: string };
        committer?: { name: string; email: string; date: string };
      };
      return json(201, this.writeCommit(payload.tree, payload.parents, payload.message));
    }

    return json(404, { message: "Not Found" });
  }

  // ---- the repository model ----

  /** The blob contents, by sha. */
  private readonly contents = new Map<string, string>();

  private blob(content: string): string {
    const sha = digest("blob", content);
    this.contents.set(sha, content);
    return sha;
  }

  /**
   * Build a nested tree from a flat list of paths.
   *
   * A path that has a slash in it becomes a subtree, level by level, the way git builds one.
   */
  private treeFromPaths(entries: FlatEntry[]): string {
    const byHead = new Map<string, FlatEntry[]>();
    for (const entry of entries) {
      const slash = entry.path.indexOf("/");
      const head = slash === -1 ? entry.path : entry.path.slice(0, slash);
      const list = byHead.get(head) ?? [];
      list.push(entry);
      byHead.set(head, list);
    }

    const children: TreeEntry[] = [];
    for (const [head, list] of byHead) {
      if (list.length === 1 && list[0]!.path === head) {
        const only = list[0]!;
        children.push({ path: head, mode: only.mode, type: only.type, sha: only.sha });
        continue;
      }
      const sub = list.map((entry) => ({
        ...entry,
        path: entry.path.slice(head.length + 1),
      }));
      children.push({ path: head, mode: "040000", type: "tree", sha: this.treeFromPaths(sub) });
    }

    children.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const sha = digest(
      "tree",
      children.map((entry) => `${entry.path}\0${entry.mode}\0${entry.type}\0${entry.sha}`).join("\n"),
    );
    this.trees.set(sha, children);
    return sha;
  }

  /** Flatten a tree into full paths. */
  private flatten(treeSha: string): FlatEntry[] {
    const children = this.trees.get(treeSha) ?? [];
    const out: FlatEntry[] = [];
    for (const child of children) {
      if (child.type === "tree") {
        for (const nested of this.flatten(child.sha)) {
          out.push({ ...nested, path: `${child.path}/${nested.path}` });
        }
      } else {
        out.push({ path: child.path, mode: child.mode, type: child.type, sha: child.sha });
      }
    }
    return out;
  }

  private writeCommit(tree: string, parents: string[], message: string): MockCommit {
    const sha = digest("commit", `${tree}\n${parents.join(",")}\n${message}`);
    const commit: MockCommit = { sha, tree, parents, message };
    this.commits.set(sha, commit);
    return commit;
  }

  /** Whether an ancestor is reachable from a commit. */
  private isAncestor(ancestor: string, head: string): boolean {
    let current: string | undefined = head;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      if (current === ancestor) return true;
      seen.add(current);
      current = this.commits.get(current)?.parents[0];
    }
    return false;
  }
}

/** Write a JSON answer. */
function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

/** A deterministic 40-hex digest. */
function digest(kind: string, content: string): string {
  return createHash("sha256").update(`${kind}\0${content}`).digest("hex").slice(0, 40);
}

/** The task folder the test capabilities point at. */
export const TEST_FOLDER = "plans/castiel-dev/submissions/10008-S001/10008-1-001-01";

/**
 * A test repository, with a branch that has the task folder in it.
 *
 * The folder is the one the test capabilities point at, and it holds the operator's placeholder.
 */
export async function testRepo(): Promise<MockGitHub> {
  const github = new MockGitHub();
  await github.start();
  github.seedBranch(
    "build-engine",
    {
      [`${TEST_FOLDER}/.keep`]: "",
      "README.md": "# submissions\n",
    },
    "seed the submissions branch",
  );
  return github;
}
