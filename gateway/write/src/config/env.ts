/**
 * The environment (protocol section 12.2).
 *
 * A misconfigured gateway **fails closed**: it serves nothing, and it says what is wrong to the
 * operator, because a gateway that cannot serve a request must still be diagnosable. The message
 * names the setting and never a secret.
 *
 * Everything that names a destination is configuration. No request can influence any of it.
 */
import { DEFAULT_LEASE_SECONDS, DEFAULT_MAX_TTL_SECONDS } from "./constants.ts";

/** A configuration problem. The message names a setting, never a value. */
export class ConfigError extends Error {
  constructor(setting: string, detail: string) {
    super(`${setting}: ${detail}`);
    this.name = "ConfigError";
  }
}

/** The bindings the Worker needs. */
export interface Env {
  /** JSON: `{"k1": "<secret>"}`. A secret; never in wrangler.toml. */
  SIGNING_KEYS: string;
  /** `owner/name` of the submissions repository. */
  SUBMISSIONS_REPO: string;
  /** The isolated branch in the submissions repository. */
  SUBMISSIONS_BRANCH: string;
  /** The task folder template, e.g. `plans/{plan}/submissions/{order}/{task}`. */
  SUBMISSIONS_FOLDER_TEMPLATE: string;
  /** The GitHub credential. A secret. */
  GITHUB_TOKEN: string;
  /** The operator credential. A secret, and a different one from the signing keys. */
  OPERATOR_TOKEN: string;
  /** The maximum lifetime of a capability, in seconds. */
  MAX_TTL_SECONDS?: string;
  /** The writer lease duration, in seconds. */
  LEASE_SECONDS?: string;
  /** The test clock. A production deployment MUST NOT set it. */
  CTXGATE_TEST_CLOCK?: string;
  /** The Durable Object namespace. */
  TASK_SESSION: DurableObjectNamespace;
}

/** The effective configuration. */
export interface Config {
  /** The signing secrets, by key id. */
  keys: Map<string, string>;
  /** The submissions repository. */
  submissionsRepo: string;
  /** The submissions branch. */
  submissionsBranch: string;
  /** The task folder template. */
  folderTemplate: string;
  /** The maximum lifetime of a capability, in seconds. */
  maxTtlSeconds: number;
  /** The writer lease duration, in seconds. */
  leaseSeconds: number;
}

/** The placeholders a folder template may use. */
const ALLOWED_PLACEHOLDERS = new Set(["plan", "order", "task"]);

/**
 * Read and validate the environment.
 *
 * Throws a `ConfigError` naming the setting that is wrong. It never throws with a secret in the
 * message, and it never returns a partially-valid configuration.
 */
export function loadConfig(env: Env): Config {
  const keys = parseKeys(env.SIGNING_KEYS);
  const submissionsRepo = requireSetting("SUBMISSIONS_REPO", env.SUBMISSIONS_REPO);
  const submissionsBranch = requireSetting("SUBMISSIONS_BRANCH", env.SUBMISSIONS_BRANCH);
  const folderTemplate = requireSetting("SUBMISSIONS_FOLDER_TEMPLATE", env.SUBMISSIONS_FOLDER_TEMPLATE);

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(submissionsRepo)) {
    throw new ConfigError("SUBMISSIONS_REPO", "must be owner/name");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(submissionsBranch) || submissionsBranch.includes("..")) {
    throw new ConfigError("SUBMISSIONS_BRANCH", "must be a branch name");
  }
  validateTemplate(folderTemplate);

  requireSetting("GITHUB_TOKEN", env.GITHUB_TOKEN);
  requireSetting("OPERATOR_TOKEN", env.OPERATOR_TOKEN);

  const maxTtlSeconds = positiveInt("MAX_TTL_SECONDS", env.MAX_TTL_SECONDS, DEFAULT_MAX_TTL_SECONDS);
  const leaseSeconds = positiveInt("LEASE_SECONDS", env.LEASE_SECONDS, DEFAULT_LEASE_SECONDS);

  return {
    keys,
    submissionsRepo,
    submissionsBranch,
    folderTemplate,
    maxTtlSeconds,
    leaseSeconds,
  };
}

/** The signing keys, as a map. */
function parseKeys(raw: string | undefined): Map<string, string> {
  if (raw === undefined || raw === "") throw new ConfigError("SIGNING_KEYS", "is not set");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("SIGNING_KEYS", "is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError("SIGNING_KEYS", "must be a JSON object of key id to secret");
  }
  const keys = new Map<string, string>();
  for (const [kid, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret !== "string" || secret === "") {
      throw new ConfigError("SIGNING_KEYS", `has an empty secret for key id "${kid}"`);
    }
    keys.set(kid, secret);
  }
  if (keys.size === 0) throw new ConfigError("SIGNING_KEYS", "has no keys");
  return keys;
}

/** A setting that must be present. */
function requireSetting(name: string, value: string | undefined): string {
  if (value === undefined || value === "") throw new ConfigError(name, "is not set");
  return value;
}

/** An optional positive integer setting. */
function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(name, "must be a positive integer");
  }
  return parsed;
}

/**
 * The folder template.
 *
 * It must use each of the three placeholders exactly once, and no others. A template that is
 * missing a placeholder would put every task in the same folder, and a template with an unknown
 * one would silently drop part of the destination.
 */
function validateTemplate(template: string): void {
  const used = new Set<string>();
  for (const match of template.matchAll(/\{([a-z]+)\}/g)) {
    const name = match[1]!;
    if (!ALLOWED_PLACEHOLDERS.has(name)) {
      throw new ConfigError("SUBMISSIONS_FOLDER_TEMPLATE", `has an unknown placeholder {${name}}`);
    }
    used.add(name);
  }
  for (const name of ALLOWED_PLACEHOLDERS) {
    if (!used.has(name)) {
      throw new ConfigError("SUBMISSIONS_FOLDER_TEMPLATE", `is missing the placeholder {${name}}`);
    }
  }
  if (template.includes("//")) {
    throw new ConfigError("SUBMISSIONS_FOLDER_TEMPLATE", "has an empty path component");
  }
}
