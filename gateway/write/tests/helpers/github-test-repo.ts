/**
 * The driver for the commit tests: a worker, a real Durable Object, and a mock provider.
 *
 * The driver is the same shape as the one the other integration tests use, with the mock GitHub
 * wired in as the provider. Everything else is the shipped code: the Worker's `fetch`, the
 * router, the Durable Object, the staging operations and the commit itself.
 */
import {
  MemoryNamespace,
  capabilityFields,
  signedCapability,
  testEnv,
  type Capability,
} from "./mock-worker.ts";
import { base64url } from "../../src/util/base64.ts";
import { sha256Hex, utf8 } from "../../src/util/hash.ts";
import type { MockGitHub } from "./mock-github.ts";

const BASE = "https://write.example.internal";

/**
 * A query string from a plain object, in a stable order.
 *
 * The `files` parameter is built the way the contract says: each path is percent-encoded on its
 * own, and the separator between them is a **literal** comma. The gateway splits the raw value
 * on commas and decodes each element afterwards, so that a file name may contain a comma — and
 * the cost of that rule is that a caller which encodes the separator too sends one path with a
 * comma in it.
 */
export function buildSearch(params: Record<string, string | undefined>): string {
  return Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined)
    .map((key) => {
      const value = params[key]!;
      if (key === "files") {
        const encoded = value.split(",").map((part) => encodeURIComponent(part)).join(",");
        return `files=${encoded}`;
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

/** The driver. */
export interface CommitDriver {
  /** The environment, with the mock provider wired in. */
  env: Record<string, unknown>;
  /** The namespace, so that a test can look inside the session. */
  namespace: MemoryNamespace;
  /** The capability, minted against the mock branch's head. */
  capability: Capability;
  /** The mock provider. */
  github: MockGitHub;
  /** Stage a file: create it, then append its content. */
  stage(path: string, content: string): Promise<void>;
  /** Stage a file in another task's session. */
  stageWith(capability: Capability, path: string, content: string): Promise<void>;
  /** Make a request against the capability. */
  get(
    operation: string,
    query?: Record<string, string | undefined>,
  ): Promise<{ response: Response; body: Record<string, unknown> }>;
  /** Make a request with a different capability. */
  getWith(
    capability: Capability,
    operation: string,
    query?: Record<string, string | undefined>,
  ): Promise<{ response: Response; body: Record<string, unknown> }>;
}

/**
 * Build a driver.
 *
 * The capability is minted against the mock branch's current head, because that is what the
 * contract's expected-head precondition compares against. A test that wants a stale head mints
 * its own capability.
 */
export async function commitDriver(
  github: MockGitHub,
  providedEnv?: Record<string, unknown>,
  signingSecret?: string,
): Promise<CommitDriver> {
  const namespace = new MemoryNamespace();
  const head = github.branchHead("build-engine") ?? "0".repeat(40);
  const { capability } = await signedCapability(capabilityFields({ head }), signingSecret);

  // The environment has to be the one the **namespace** holds, not a copy of it: the Durable
  // Object reads its own environment, and the provider's address is part of it. A copy would
  // leave the Durable Object pointing at the default loopback address, and every commit would
  // fail to reach the mock.
  const env = testEnv(namespace, {
    GITHUB_API_BASE: github.baseUrl,
    GITHUB_TIMEOUT_MS: "2000",
    ...(providedEnv ?? {}),
  });

  const getWith = async (
    cap: Capability,
    operation: string,
    query?: Record<string, string | undefined>,
  ): Promise<{ response: Response; body: Record<string, unknown> }> => {
    const parts = [
      `/w1/${cap.kid}/${cap.exp}/${cap.order}/${cap.plan}`,
      `/${cap.task}/${cap.writer}/${cap.head}/${cap.sig}`,
    ].join("");
    const search = query === undefined ? "" : `?${buildSearch(query)}`;
    const { default: worker } = await import("../../src/index.ts");
    const response = await worker.fetch(new Request(`${BASE}${parts}/${operation}${search}`), env as never);
    return { response, body: (await response.json()) as Record<string, unknown> };
  };

  const stageWith = async (cap: Capability, path: string, content: string): Promise<void> => {
    const created = await getWith(cap, "create", { path });
    if (created.response.status !== 200) {
      throw new Error(`create failed: ${JSON.stringify(created.body)}`);
    }
    const bytes = utf8(content);
    const written = await getWith(cap, "append", {
      path,
      seq: "1",
      hash: await sha256Hex(bytes),
      data: base64url(bytes),
    });
    if (written.response.status !== 200) {
      throw new Error(`append failed: ${JSON.stringify(written.body)}`);
    }
  };

  return {
    env,
    namespace,
    capability,
    github,
    stage: (path: string, content: string) => stageWith(capability, path, content),
    stageWith: async (cap: Capability, path: string, content: string) => {
      const created = await getWith(cap, "create", { path });
      if (created.response.status !== 200) {
        throw new Error(`create failed: ${JSON.stringify(created.body)}`);
      }
      const bytes = utf8(content);
      const written = await getWith(cap, "append", {
        path,
        seq: "1",
        hash: await sha256Hex(bytes),
        data: base64url(bytes),
      });
      if (written.response.status !== 200) {
        throw new Error(`append failed: ${JSON.stringify(written.body)}`);
      }
    },
    get: (operation, query) => getWith(capability, operation, query),
    getWith,
  };
}
