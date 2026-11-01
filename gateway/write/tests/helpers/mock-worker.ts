/**
 * The test helpers: signing a capability, and running the real Durable Object in memory.
 *
 * The helpers exist so that the tests exercise the **real** code — the real signature, the real
 * Durable Object class, the real router — rather than a re-implementation of them that could
 * drift. A test that reimplements the thing it is testing proves nothing.
 */
import { TaskSession } from "../../src/session/task-session.ts";
import { AuditStream } from "../../src/audit/audit-stream.ts";
import type { Capability } from "../../src/types/requests.ts";
import {
  TEST_HEAD,
  TEST_KID,
  TEST_NOW,
  TEST_SECRET,
  capabilityFields,
  capabilityPath,
  signedCapability,
} from "./sign-root.ts";

export {
  TEST_HEAD,
  TEST_KID,
  TEST_NOW,
  TEST_SECRET,
  capabilityFields,
  capabilityPath,
  signedCapability,
};
export type { Capability };

/**
 * An in-memory Durable Object storage.
 *
 * It implements the part of the storage API the session uses: `get`, `put` and `delete`. The
 * Durable Object class is the real one; only the storage underneath is a stand-in.
 */
export class MemoryStorage {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list<T>(): Promise<Map<string, T>> {
    return new Map(this.map as Map<string, T>);
  }
}

/** Anything the Worker can talk to. */
export interface DurableInstance {
  fetch(request: Request): Promise<Response>;
}

/** A Durable Object instance and its storage, so that a test can look inside. */
export interface TestSession {
  /** The stub the Worker talks to. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The storage, so that a test can read the durable state. */
  storage: MemoryStorage;
  /** The instance, so that a test can call it directly. */
  instance: DurableInstance;
}

/**
 * Run a real Durable Object class over an in-memory storage.
 *
 * `blockConcurrencyWhile` is a no-op here: the real runtime serialises the requests that touch
 * one object, and the tests drive them one at a time.
 *
 * The storage is a parameter, so that a test can hand a **surviving** storage to a **new**
 * instance. That is what a Durable Object eviction is: the instance is recycled and its memory
 * goes with it, but the storage is the platform's and stays.
 */
export function testSession(
  env: Record<string, unknown> = {},
  factory: (state: DurableObjectState, env: Record<string, unknown>) => DurableInstance = (state, e) =>
    new TaskSession(state, e as never),
  storage: MemoryStorage = new MemoryStorage(),
): TestSession {
  const state = {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    id: { toString: () => "test-session" },
  } as unknown as DurableObjectState;
  const instance = factory(state, env);
  return {
    storage,
    instance,
    fetch: (url: string, init?: RequestInit) => instance.fetch(new Request(url, init)),
  };
}

/**
 * An in-memory Durable Object namespace.
 *
 * The Worker asks for an object by name and then calls it. This keeps one instance per name, so
 * that two requests for the same task hit the same session, which is the whole point of a
 * Durable Object.
 */
export class MemoryNamespace {
  private readonly sessions = new Map<string, TestSession>();
  /**
   * The storages, by name.
   *
   * The storage outlives the instance, because that is how the platform's storage works: an
   * eviction reclaims the object's memory, not the data the platform keeps for it.
   */
  private readonly storages = new Map<string, MemoryStorage>();
  /**
   * The environment the sessions are created with.
   *
   * The Durable Object reads the environment the way the runtime supplies it, so the namespace
   * has to hold it: the environment is what tells the session where the submissions repository
   * is, and a session created without one cannot commit.
   */
  private env: Record<string, unknown> = {};
  /** The class the namespace creates. */
  private readonly factory: (state: DurableObjectState, env: Record<string, unknown>) => DurableInstance;
  /**
   * The audit stream's namespace.
   *
   * The audit stream is a different Durable Object class, and it is keyed by the order rather
   * than by the task, so it gets its own namespace and its own instances. The audit namespace
   * has no audit namespace of its own, or the construction would never end.
   */
  readonly audit: MemoryNamespace | undefined;

  constructor(
    factory: (state: DurableObjectState, env: Record<string, unknown>) => DurableInstance = (state, e) =>
      new TaskSession(state, e as never),
    withAudit = true,
  ) {
    this.factory = factory;
    this.audit = withAudit
      ? new MemoryNamespace((state, e) => new AuditStream(state, e as never), false)
      : undefined;
  }

  /** Set the environment the sessions are created with. */
  setEnv(env: Record<string, unknown>): void {
    this.env = env;
    this.audit?.setEnv(env);
  }

  idFromName(name: string): { toString: () => string } {
    return { toString: () => name };
  }

  get(id: { toString: () => string }): { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
    const name = id.toString();
    return { fetch: this.session(name).fetch };
  }

  /**
   * The session behind a name, for a test that wants to look inside.
   *
   * The instance is created on demand, over the storage that belongs to the name. The storage
   * outlives the instance — that is the point of the two eviction methods below.
   */
  session(name: string): TestSession {
    let session = this.sessions.get(name);
    if (session === undefined) {
      let storage = this.storages.get(name);
      if (storage === undefined) {
        storage = new MemoryStorage();
        this.storages.set(name, storage);
      }
      session = testSession(this.env, this.factory, storage);
      this.sessions.set(name, session);
    }
    return session;
  }

  /**
   * Recycle the instance, keeping the storage.
   *
   * This is a **Durable Object eviction**: the platform reclaims the object's memory, the
   * staged content goes with it, and the storage — which is the platform's, not the object's —
   * stays. Everything the session recorded durably is still there; the bytes are not.
   */
  restart(name: string): void {
    this.sessions.delete(name);
  }

  /**
   * Drop the instance and the storage.
   *
   * This is the worst case, and it is not something the platform does on its own: the task's
   * durable state is gone as well. A test that asserts the gateway behaves sanely here is
   * asserting that a task whose state has been destroyed is treated as a **new** task, not as a
   * task with a half-remembered history.
   */
  evict(name: string): void {
    this.sessions.delete(name);
    this.storages.delete(name);
  }
}

/** The environment a test drives the Worker with. */
export function testEnv(namespace: MemoryNamespace, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const env: Record<string, unknown> = {
    SIGNING_KEYS: JSON.stringify({ [TEST_KID]: TEST_SECRET }),
    SUBMISSIONS_REPO: "owner/repo",
    SUBMISSIONS_BRANCH: "build-engine",
    SUBMISSIONS_FOLDER_TEMPLATE: "plans/{plan}/submissions/{order}/{task}",
    GITHUB_TOKEN: "test-github-token",
    // The provider's base URL points at a loopback address that nothing listens on, so that a
    // test which forgets to point it at the mock fails fast and locally instead of reaching the
    // real GitHub. The commit driver overrides it with the mock's own address.
    GITHUB_API_BASE: "http://127.0.0.1:1",
    OPERATOR_TOKEN: "test-operator-token",
    MAX_TTL_SECONDS: "604800",
    LEASE_SECONDS: "300",
    // Which environment this is, and which key ids it declares. The test suite drives the
    // production-shaped configuration; the staging rules are exercised by their own tests.
    DEPLOY_ENV: "production",
    SIGNING_KEY_IDS: TEST_KID,
    CTXGATE_TEST_CLOCK: String(TEST_NOW),
    TASK_SESSION: namespace,
    AUDIT_STREAM: namespace.audit ?? namespace,
    ...overrides,
  };
  // The sessions the namespace hands out are created with this environment.
  namespace.setEnv(env);
  return env;
}
