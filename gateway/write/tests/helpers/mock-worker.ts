/**
 * The test helpers: signing a capability, and running the real Durable Object in memory.
 *
 * The helpers exist so that the tests exercise the **real** code — the real signature, the real
 * Durable Object class, the real router — rather than a re-implementation of them that could
 * drift. A test that reimplements the thing it is testing proves nothing.
 */
import { TaskSession } from "../../src/session/task-session.ts";
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

/** A Durable Object instance and its storage, so that a test can look inside. */
export interface TestSession {
  /** The stub the Worker talks to. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The storage, so that a test can read the durable state. */
  storage: MemoryStorage;
  /** The instance, so that a test can call it directly. */
  instance: TaskSession;
}

/**
 * Run the real Durable Object class over an in-memory storage.
 *
 * `blockConcurrencyWhile` is a no-op here: the real runtime serialises the requests that touch
 * one object, and the tests drive them one at a time.
 */
export function testSession(): TestSession {
  const storage = new MemoryStorage();
  const state = {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    id: { toString: () => "test-session" },
  } as unknown as DurableObjectState;
  const instance = new TaskSession(state);
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

  idFromName(name: string): { toString: () => string } {
    return { toString: () => name };
  }

  get(id: { toString: () => string }): { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
    const name = id.toString();
    let session = this.sessions.get(name);
    if (session === undefined) {
      session = testSession();
      this.sessions.set(name, session);
    }
    return { fetch: session.fetch };
  }

  /** The session behind a name, for a test that wants to look inside. */
  session(name: string): TestSession {
    let session = this.sessions.get(name);
    if (session === undefined) {
      session = testSession();
      this.sessions.set(name, session);
    }
    return session;
  }

  /** Drop a session, to simulate an isolate eviction. */
  evict(name: string): void {
    this.sessions.delete(name);
  }
}

/** The environment a test drives the Worker with. */
export function testEnv(namespace: MemoryNamespace, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    SIGNING_KEYS: JSON.stringify({ [TEST_KID]: TEST_SECRET }),
    SUBMISSIONS_REPO: "owner/repo",
    SUBMISSIONS_BRANCH: "build-engine",
    SUBMISSIONS_FOLDER_TEMPLATE: "plans/{plan}/submissions/{order}/{task}",
    GITHUB_TOKEN: "test-github-token",
    OPERATOR_TOKEN: "test-operator-token",
    MAX_TTL_SECONDS: "604800",
    LEASE_SECONDS: "300",
    CTXGATE_TEST_CLOCK: String(TEST_NOW),
    TASK_SESSION: namespace,
    ...overrides,
  };
}
