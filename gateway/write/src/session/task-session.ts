/**
 * The Durable Object: one instance per task, holding the session's control plane.
 *
 * The split between this object and the Worker follows ADR 0001:
 *
 *  - **durable** (this object): the writer lease, the session state, the file inventory, the
 *    sequence metadata, the quota ledger, the idempotency store and the commit record;
 *  - **ephemeral** (this object's memory, and nowhere else): the staged file contents.
 *
 * The contents live in a plain `Map` on the instance. They are never written to the Durable
 * Object's storage, to disk, or to any third-party object store (ADR 0002). The consequence is
 * the one the contract states plainly: **the inventory of a task is durable and the content of a
 * task is not.** When an instance is recycled, the inventory is still there and the bytes are
 * gone, and the session reports the difference.
 *
 * The Worker authenticates before it gets here. The order of the checks below is the contract's
 * verification order (section 14.3), and the Worker has already done the first six.
 */
import { OPERATIONS, type Operation } from "../config/constants.ts";
import { authorizeSession, isDestinationParameter } from "../auth/policy-authz.ts";
import { decodeComponent, parseQuery } from "../auth/root-url.ts";
import { errorSpec } from "../http/status-codes.ts";
import { nextLinks } from "../hypermedia/links.ts";
import { indexResult } from "../hypermedia/index.ts";
import { countRequest } from "../policy/rate-limit.ts";
import { checkTypeAllowed } from "../policy/type-policy.ts";
import { checkFileCount } from "../policy/quotas.ts";
import { sealSession } from "../seal/seal.ts";
import { appendChunk } from "../staging/append.ts";
import { replaceContent } from "../staging/replace.ts";
import { deleteStaged } from "../staging/delete.ts";
import { readStaged } from "../staging/read.ts";
import { scaffold } from "../staging/scaffold.ts";
import { quotaView, snapshot } from "../staging/status.ts";
import { claimLease } from "./writer-claim.ts";
import { emptyQuota, reconcile } from "./quota-accounting.ts";
import type { Capability } from "../types/requests.ts";
import type { Link } from "../types/responses.ts";
import type {
  ChunkIdentity,
  CommitRecord,
  FileEntry,
  IdempotencyEntry,
  QuotaState,
  RateWindow,
  SessionState,
  WriterLease,
} from "../types/session.ts";

const SESSION_KEY = "session:v1";

/** The durable part of a session. */
export interface StoredSession {
  state: SessionState;
  writer: WriterLease | null;
  files: Record<string, FileEntry>;
  chunks: Record<string, ChunkIdentity[]>;
  quota: QuotaState;
  idempotency: Record<string, IdempotencyEntry>;
  commit: CommitRecord | null;
  rate: RateWindow | null;
}

/** The request the Worker sends to the Durable Object. */
export interface InternalRequest {
  /** The operation segment, or null for the index. */
  op: string | null;
  /** The raw query string. */
  query: string;
  /** The capability, already authenticated by the Worker. */
  capability: Capability;
  /** The current time, in unix seconds. */
  now: number;
  /** The request id, for correlation. */
  requestId: string;
  /** The configuration the session needs. */
  config: { folderTemplate: string; leaseSeconds: number };
}

/** The answer the Durable Object sends back. */
export interface InternalResponse {
  ok: boolean;
  op: string;
  state: SessionState;
  result: unknown;
  next: Link[];
  error: { code: string; message: string; retryable: boolean } | null;
}

/** A fresh session. */
function freshSession(): StoredSession {
  return {
    state: "open",
    writer: null,
    files: {},
    chunks: {},
    quota: emptyQuota(),
    idempotency: {},
    commit: null,
    rate: null,
  };
}

export class TaskSession {
  /** The Durable Object state. */
  private readonly state: DurableObjectState;
  /** The durable state, loaded on first use. */
  private session: StoredSession | null = null;
  /** The ephemeral content. In memory, and nowhere else. */
  private readonly contents = new Map<string, string>();
  /**
   * The request queue.
   *
   * A Durable Object is single-threaded, but a handler that awaits something that is not a
   * storage operation — a digest, a text decoder — yields, and another request's handler can
   * start in the meantime. Two concurrent appends would then both read the same `last_seq`, both
   * decide that the chunk is new, and both apply it.
   *
   * So the handlers are serialised explicitly: each one waits for the previous one to finish.
   * That is what makes the session's state transitions atomic, which is what the contract's
   * sequence, quota and lease rules assume.
   */
  private queue: Promise<unknown> = Promise.resolve();

  // The field is declared rather than written as a parameter property: Node's type stripping
  // only erases types, and a parameter property is a constructor assignment, not a type.
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Run one request to completion, after every earlier request has finished.
   *
   * The chain is kept alive even when a request fails, so that one failure does not wedge the
   * session.
   */
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The body is read before the request enters the queue, so that reading it cannot hold the
    // queue up.
    let body: unknown = null;
    try {
      if (request.method === "POST") body = await request.json();
    } catch {
      body = null;
    }
    return this.run(() => this.dispatch(url.pathname, body));
  }

  /** The internal routes. */
  private async dispatch(pathname: string, body: unknown): Promise<Response> {
    try {
      switch (pathname) {
        case "/session":
          return Response.json(await this.handleSession(body as InternalRequest));
        case "/admin/revoke":
          return Response.json(await this.revoke());
        case "/admin/close":
          return Response.json(await this.close());
        case "/admin/reset-quota":
          return Response.json(await this.resetQuota());
        case "/admin/commit-record":
          return Response.json(await this.recordCommit((body as { commit: CommitRecord }).commit));
        default:
          return new Response("not found\n", { status: 404 });
      }
    } catch {
      // The state channel fails closed: a session that cannot be read serves nothing. The message
      // is fixed, because an exception can carry state that must not be echoed.
      return Response.json(
        { ok: false, error: { code: "state-unavailable", message: "the session state is unavailable", retryable: true } },
        { status: 503 },
      );
    }
  }

  /**
   * Load the durable state and reconcile it with the ephemeral content.
   *
   * The reconciliation is what notices an eviction: a file that the inventory says has content,
   * but that this instance has never seen, lost its content when the previous instance was
   * recycled. The quota is brought back in line, and the loss is counted.
   */
  private async load(): Promise<StoredSession> {
    if (this.session !== null) return this.session;

    const stored = await this.state.storage.get<StoredSession>(SESSION_KEY);
    const session = stored ?? freshSession();

    let liveFiles = 0;
    let liveBytes = 0;
    for (const entry of Object.values(session.files)) {
      if (entry.content === "present" && !this.contents.has(entry.path)) {
        // The content was lost when the previous instance was recycled. The inventory is still
        // here; the bytes are not.
        entry.content = "missing";
        entry.bytes = 0;
      }
      if (entry.content === "present") {
        liveFiles += 1;
        liveBytes += entry.bytes;
      }
    }
    session.quota = reconcile(session.quota, liveFiles, liveBytes);

    this.session = session;
    return session;
  }

  /** Persist the durable state. */
  private async save(session: StoredSession): Promise<void> {
    this.session = session;
    await this.state.storage.put(SESSION_KEY, session);
  }

  /** The main operation. */
  private async handleSession(request: InternalRequest): Promise<InternalResponse> {
    const session = await this.load();

    // The rate limit is a resource control and runs first, so that a flood is bounded before any
    // other work is done. The read gateway does the same with its abuse gate.
    const rate = countRequest(session.rate, request.now);
    if (!rate.ok) {
      return failure(session.state, request.op ?? "index", "rate-limited", rate.message);
    }
    session.rate = rate.window;

    // The session state, before the operation is even looked at (protocol section 14.3).
    const op = (request.op ?? "index") as Operation;
    const stateError = authorizeSession(session.state, op);
    if (stateError !== null) return failure(session.state, op, stateError.code, stateError.message);

    if (!isKnownOperation(op)) {
      return failure(session.state, op, "unknown-operation", "that operation is not part of the protocol");
    }

    // The parameters.
    const params = parseOperationParams(op, request.query);
    if (!params.ok) return failure(session.state, op, params.code, params.message);

    // The writer lease. One writer per task.
    const lease = claimLease(
      session.writer,
      request.capability.writer,
      request.now,
      request.config.leaseSeconds,
    );
    if (!lease.ok) return failure(session.state, op, lease.code, lease.message);
    session.writer = lease.lease;

    const ctx = {
      files: session.files,
      chunks: session.chunks,
      contents: this.contents,
      quota: session.quota,
    };

    const outcome = await this.perform(session, ctx, op, params.params, request);
    if (!outcome.ok) {
      await this.save(session);
      return failure(session.state, op, outcome.code, outcome.message);
    }

    session.quota = ctx.quota;
    await this.save(session);

    const rawPath = params.params.path;
    const path = typeof rawPath === "string" ? rawPath : undefined;
    const next = nextLinks({
      op,
      state: session.state,
      committed: session.commit !== null,
      path,
    });

    return {
      ok: true,
      op,
      state: session.state,
      result: outcome.result,
      next,
      error: null,
    };
  }

  /** The operation implementations. */
  private async perform(
    session: StoredSession,
    ctx: {
      files: Record<string, FileEntry>;
      chunks: Record<string, ChunkIdentity[]>;
      contents: Map<string, string>;
      quota: QuotaState;
    },
    op: Operation,
    params: Record<string, string | string[] | number | undefined>,
    request: InternalRequest,
  ): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; code: string; message: string }> {
    switch (op) {
      case "index":
        return {
          ok: true,
          result: indexResult({
            writer: request.capability.writer,
            expiresAt: request.capability.exp,
            plan: request.capability.plan,
            order: request.capability.order,
            task: request.capability.task,
            folderTemplate: request.config.folderTemplate,
            state: session.state,
            committed: session.commit,
          }),
        };

      case "status":
        return {
          ok: true,
          result: {
            ...snapshot(ctx, session.state, session.writer, session.commit),
            quota: quotaView(ctx.quota),
          },
        };

      case "create": {
        const path = params.path as string;
        const typeCheck = checkTypeAllowed(path);
        if (!typeCheck.ok) {
          return { ok: false, code: typeCheck.reason, message: "that file type is not allowed" };
        }
        // The file count is a quota, and a quota is checked before the thing it limits. A file
        // that already exists is not a new file, so the check comes after the scaffold decision.
        const existing = ctx.files[path];
        if (existing === undefined || existing.content === "present") {
          const count = checkFileCount(ctx.quota.liveFiles);
          if (!count.ok) return { ok: false, code: count.code, message: count.message };
        }
        const outcome = scaffold(ctx, path);
        return outcome.ok
          ? { ok: true, result: { ...outcome.result, replayed: outcome.replayed } }
          : { ok: false, code: outcome.code, message: outcome.message };
      }

      case "append": {
        const path = params.path as string;
        const outcome = await appendChunk(
          ctx,
          path,
          params.seq as number,
          params.hash as string,
          params.data as string,
        );
        return outcome.ok
          ? { ok: true, result: { ...outcome.result, replayed: outcome.replayed } }
          : { ok: false, code: outcome.code, message: outcome.message };
      }

      case "replace": {
        const path = params.path as string;
        const outcome = await replaceContent(
          ctx,
          path,
          params.seq as number,
          params.hash as string,
          params.data as string,
        );
        return outcome.ok
          ? { ok: true, result: { ...outcome.result, replayed: outcome.replayed } }
          : { ok: false, code: outcome.code, message: outcome.message };
      }

      case "read": {
        const path = params.path as string;
        const outcome = await readStaged(ctx, path);
        return outcome.ok
          ? { ok: true, result: { ...outcome.result, replayed: outcome.replayed } }
          : { ok: false, code: outcome.code, message: outcome.message };
      }

      case "delete": {
        const path = params.path as string;
        const outcome = deleteStaged(ctx, path);
        return outcome.ok
          ? { ok: true, result: { ...outcome.result, replayed: outcome.replayed } }
          : { ok: false, code: outcome.code, message: outcome.message };
      }

      case "commit":
        // Stage 5.3 implements the GitHub delivery. Until then the route exists, the session
        // answers, and the refusal says exactly that.
        return {
          ok: false,
          code: "not-implemented",
          message: "the commit route is not implemented yet; this build of the gateway cannot deliver",
        };

      case "seal": {
        const decision = sealSession(session.commit, request.now);
        if (!decision.ok) return { ok: false, code: decision.code, message: decision.message };
        session.state = decision.state;
        return { ok: true, result: decision.result };
      }
    }
  }

  /** The operator's revocation. */
  private async revoke(): Promise<{ state: SessionState }> {
    const session = await this.load();
    if (session.state === "open") session.state = "revoked";
    await this.save(session);
    return { state: session.state };
  }

  /** The operator's closure of the work order. */
  private async close(): Promise<{ state: SessionState }> {
    const session = await this.load();
    if (session.state === "open") session.state = "closed";
    await this.save(session);
    return { state: session.state };
  }

  /** The operator's quota reset, after an eviction. */
  private async resetQuota(): Promise<{ quota: QuotaState }> {
    const session = await this.load();
    session.quota = { ...emptyQuota(), bytesAcceptedTotal: session.quota.bytesAcceptedTotal, bytesLost: session.quota.bytesLost };
    await this.save(session);
    return { quota: session.quota };
  }

  /**
   * Record a successful commit.
   *
   * Stage 5.3 calls this once the GitHub commit has succeeded. The record is what the seal
   * precondition checks, and it is what makes a repeated seal idempotent.
   */
  private async recordCommit(commit: CommitRecord): Promise<{ commit: CommitRecord }> {
    const session = await this.load();
    session.commit = commit;
    await this.save(session);
    return { commit };
  }
}

/** Whether the operation is one the contract defines. */
function isKnownOperation(op: string): op is Operation {
  return (OPERATIONS as readonly string[]).includes(op);
}

/** A failure answer. */
function failure(state: SessionState, op: string, code: string, message: string): InternalResponse {
  return {
    ok: false,
    op,
    state,
    result: null,
    next: [],
    error: { code, message, retryable: errorSpec(code).retryable },
  };
}

/**
 * The parameters each operation accepts.
 *
 * A parameter that the operation does not define is refused rather than ignored: an ignored
 * parameter is how a client ends up believing it set something it did not.
 */
const ALLOWED_PARAMS: Record<string, string[]> = {
  index: [],
  status: [],
  create: ["path", "type"],
  append: ["path", "seq", "hash", "data"],
  replace: ["path", "seq", "hash", "data"],
  read: ["path"],
  delete: ["path"],
  commit: ["files", "idem"],
  seal: ["idem"],
};

/** The parameters each operation requires. */
const REQUIRED_PARAMS: Record<string, string[]> = {
  index: [],
  status: [],
  create: ["path"],
  append: ["path", "seq", "hash", "data"],
  replace: ["path", "seq", "hash", "data"],
  read: ["path"],
  delete: ["path"],
  commit: ["files"],
  seal: [],
};

/** The parsed parameters of an operation. */
export type ParamResult =
  | { ok: true; params: Record<string, string | string[] | number | undefined> }
  | { ok: false; code: string; message: string };

/**
 * Parse and validate an operation's parameters.
 *
 * The order of the checks follows the contract: a repeated parameter, then a parameter that tries
 * to choose the destination, then an unknown parameter, then a missing one, then a malformed
 * value.
 */
export function parseOperationParams(op: Operation, rawQuery: string): ParamResult {
  const query = parseQuery(rawQuery);

  if (query.repeated !== null) {
    return { ok: false, code: "repeated-parameter", message: `the parameter "${query.repeated}" was given more than once` };
  }

  const allowed = ALLOWED_PARAMS[op] ?? [];
  for (const name of query.entries.keys()) {
    if (isDestinationParameter(name)) {
      return {
        ok: false,
        code: "destination-not-selectable",
        message: "the destination comes from the capability and cannot be chosen by a request",
      };
    }
    if (!allowed.includes(name)) {
      return { ok: false, code: "unknown-parameter", message: `the parameter "${name}" is not part of this operation` };
    }
  }

  const params: Record<string, string | string[] | number | undefined> = {};

  for (const name of REQUIRED_PARAMS[op] ?? []) {
    if (!query.entries.has(name)) {
      return { ok: false, code: "invalid-parameter", message: `the parameter "${name}" is required` };
    }
  }

  for (const [name, entries] of query.entries) {
    const entry = entries[0]!;
    switch (name) {
      case "seq": {
        if (!/^[0-9]+$/.test(entry.value) || Number(entry.value) < 1) {
          return { ok: false, code: "invalid-parameter", message: "seq must be a positive integer" };
        }
        params.seq = Number(entry.value);
        break;
      }
      case "hash": {
        if (!/^[0-9a-f]{64}$/.test(entry.value)) {
          return { ok: false, code: "invalid-parameter", message: "hash must be 64 lowercase hex characters" };
        }
        params.hash = entry.value;
        break;
      }
      case "files": {
        // The split happens on the RAW value, so that a `%2C` inside a file name is not mistaken
        // for the separator (protocol section 4.2.7).
        const parts = entry.raw.split(",").filter((part) => part !== "");
        if (parts.length === 0) {
          return { ok: false, code: "empty-selection", message: "the commit named no files" };
        }
        params.files = parts.map((part) => decodeComponent(part));
        break;
      }
      case "idem": {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(entry.value)) {
          return { ok: false, code: "invalid-parameter", message: "idem must be 8 to 64 characters of A-Z a-z 0-9 _ or -" };
        }
        params.idem = entry.value;
        break;
      }
      default:
        params[name] = entry.value;
    }
  }

  return { ok: true, params };
}
