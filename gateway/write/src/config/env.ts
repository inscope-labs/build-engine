/**
 * The environment (protocol section 12.2).
 *
 * A misconfigured gateway **fails closed**: it serves nothing, and it says what is wrong to the
 * operator, because a gateway that cannot serve a request must still be diagnosable. The message
 * names the setting and never a secret.
 *
 * Everything that names a destination is configuration. No request can influence any of it.
 */
import {
  COMMIT_AUTHOR_EMAIL,
  COMMIT_AUTHOR_NAME,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_MAX_TTL_SECONDS,
  PROVIDER_TIMEOUT_MAX_MS,
  PROVIDER_TIMEOUT_MIN_MS,
  PROVIDER_TIMEOUT_MS,
} from "./constants.ts";

/** A configuration problem. The message names a setting, never a value. */
export class ConfigError extends Error {
  constructor(setting: string, detail: string) {
    super(`${setting}: ${detail}`);
    this.name = "ConfigError";
  }
}

/**
 * The names a deployment may have.
 *
 * A gateway that does not say which environment it is cannot be told apart from the other one.
 * The name is not a secret: it is reported by the health endpoint, and it is what makes a staging
 * pilot provably a staging pilot (protocol section 12.5).
 */
export const DEPLOY_ENVIRONMENTS = ["staging", "production"] as const;

/** Which environment a deployment is. */
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

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
  /** The GitHub API base URL. Defaults to `https://api.github.com`. */
  GITHUB_API_BASE?: string;
  /** The per-call timeout for the GitHub API, in milliseconds. */
  GITHUB_TIMEOUT_MS?: string;
  /** The commit's author identity, `Name <email>`. */
  GITHUB_COMMIT_AUTHOR?: string;
  /** The operator credential. A secret, and a different one from the signing keys. */
  OPERATOR_TOKEN: string;
  /** The maximum lifetime of a capability, in seconds. */
  MAX_TTL_SECONDS?: string;
  /** The writer lease duration, in seconds. */
  LEASE_SECONDS?: string;
  /**
   * Which environment this deployment is: `staging` or `production`.
   *
   * It is not a secret. It is what tells a pilot, and a reviewer looking at a commit, which
   * environment they are talking to.
   */
  DEPLOY_ENV: string;
  /**
   * The key ids this deployment serves, comma separated.
   *
   * A declaration, not a secret: it says which key ids belong to this environment, so that the
   * key ids of two environments can be checked to be disjoint without reading either secret.
   */
  SIGNING_KEY_IDS: string;
  /**
   * The submissions repository the **production** deployment writes to.
   *
   * A staging deployment declares it, and refuses to start if it is pointed at it. That is the
   * rule that makes "staging data can never be mistaken for a production submission" a property
   * of the configuration and not a matter of care (protocol section 12.5).
   */
  PRODUCTION_SUBMISSIONS_REPO?: string;
  /** The test clock. A production deployment MUST NOT set it. */
  CTXGATE_TEST_CLOCK?: string;
  /** The Durable Object namespace. */
  TASK_SESSION: DurableObjectNamespace;
  /** The Durable Object namespace that holds the durable audit stream, one instance per order. */
  AUDIT_STREAM: DurableObjectNamespace;
  /** How long the durable audit stream keeps its records, in seconds. */
  AUDIT_RETENTION_SECONDS?: string;
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
  /** The GitHub API base URL. */
  githubApiBase: string;
  /** The per-call timeout for the GitHub API, in milliseconds. */
  githubTimeoutMs: number;
  /** The commit's author name. */
  commitAuthorName: string;
  /** The commit's author email. */
  commitAuthorEmail: string;
  /** Which environment this deployment is. */
  deployEnv: DeployEnvironment;
  /** The key ids this deployment declares that it serves. */
  signingKeyIds: string[];
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

  const deployEnv = deployEnvironment(env.DEPLOY_ENV);
  const signingKeyIds = declaredKeyIds(env.SIGNING_KEY_IDS);
  for (const kid of keys.keys()) {
    if (!signingKeyIds.includes(kid)) {
      throw new ConfigError(
        "SIGNING_KEY_IDS",
        "does not declare every key id that SIGNING_KEYS holds: a key id this deployment does not declare belongs to another environment",
      );
    }
  }
  checkEnvironmentBoundary(deployEnv, submissionsRepo, env.PRODUCTION_SUBMISSIONS_REPO);

  const maxTtlSeconds = positiveInt("MAX_TTL_SECONDS", env.MAX_TTL_SECONDS, DEFAULT_MAX_TTL_SECONDS);
  const leaseSeconds = positiveInt("LEASE_SECONDS", env.LEASE_SECONDS, DEFAULT_LEASE_SECONDS);
  const githubApiBase = apiBase(env.GITHUB_API_BASE);
  const githubTimeoutMs = boundedInt(
    "GITHUB_TIMEOUT_MS",
    env.GITHUB_TIMEOUT_MS,
    PROVIDER_TIMEOUT_MS,
    PROVIDER_TIMEOUT_MIN_MS,
    PROVIDER_TIMEOUT_MAX_MS,
  );
  const author = commitAuthor(env.GITHUB_COMMIT_AUTHOR);

  return {
    keys,
    submissionsRepo,
    submissionsBranch,
    folderTemplate,
    maxTtlSeconds,
    leaseSeconds,
    githubApiBase,
    githubTimeoutMs,
    commitAuthorName: author.name,
    commitAuthorEmail: author.email,
    deployEnv,
    signingKeyIds,
  };
}

/**
 * The environment this deployment is.
 *
 * It is required, and it is one of two names. A gateway that does not say which environment it is
 * is a gateway a pilot cannot tell apart from the other one, and "fail closed on missing
 * configuration" is a rule, not a preference.
 */
function deployEnvironment(value: string | undefined): DeployEnvironment {
  if (value === undefined || value === "") throw new ConfigError("DEPLOY_ENV", "is not set");
  if (!(DEPLOY_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new ConfigError("DEPLOY_ENV", "must be one of " + DEPLOY_ENVIRONMENTS.join(", "));
  }
  return value as DeployEnvironment;
}

/**
 * The key ids this deployment declares.
 *
 * A key id is not a secret: it appears in the capability's path and in the health endpoint. The
 * declaration is what lets two environments be checked to be disjoint without reading either
 * one's secret.
 *
 * The declaration is a **superset** of what the secret holds, and that direction is deliberate:
 *
 *  - a key id in the secret that the declaration does not name is refused, because it belongs to
 *    another environment, and a deployment that serves another environment's key id can answer
 *    another environment's capabilities;
 *  - a key id in the declaration that the secret does not hold yet is allowed, because that is
 *    what a rotation looks like: the declaration is deployed first, the new secret follows, and
 *    the gateway serves both key ids throughout (runbook section 6.1).
 */
function declaredKeyIds(value: string | undefined): string[] {
  if (value === undefined || value === "") throw new ConfigError("SIGNING_KEY_IDS", "is not set");
  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (ids.length === 0) throw new ConfigError("SIGNING_KEY_IDS", "declares no key id");
  for (const kid of ids) {
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(kid)) {
      throw new ConfigError("SIGNING_KEY_IDS", "declares a key id that is not a valid kid");
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new ConfigError("SIGNING_KEY_IDS", "declares a key id twice");
  }
  return ids;
}

/**
 * The rule that keeps a staging deployment out of production.
 *
 * A staging deployment declares the repository the production deployment writes to, and refuses
 * to start if it is pointed at it. The refusal is the point: a staging deployment that had been
 * pointed at production by mistake would otherwise serve perfectly well, and the mistake would
 * only be visible in the commits.
 */
function checkEnvironmentBoundary(
  deployEnv: DeployEnvironment,
  submissionsRepo: string,
  productionRepo: string | undefined,
): void {
  if (deployEnv === "production") {
    if (productionRepo !== undefined && productionRepo !== "") {
      throw new ConfigError("PRODUCTION_SUBMISSIONS_REPO", "is only meaningful in a staging deployment");
    }
    return;
  }
  if (productionRepo === undefined || productionRepo === "") {
    throw new ConfigError(
      "PRODUCTION_SUBMISSIONS_REPO",
      "must be set in a staging deployment: it is the repository the staging deployment may not be pointed at",
    );
  }
  if (submissionsRepo === productionRepo) {
    throw new ConfigError(
      "SUBMISSIONS_REPO",
      "is the production submissions repository: a staging deployment may not be pointed at it",
    );
  }
}

/**
 * The API base URL.
 *
 * The default is GitHub's own. A different one is legitimate: GitHub Enterprise Server runs the
 * same API on an operator's own host, and the gateway has to be able to point at it.
 *
 * Plain HTTP is allowed for a **loopback** address only. Everything else must be HTTPS, because
 * the credential is in every request and an unencrypted hop to a remote host would hand it over.
 * The loopback exception is what lets the test suite run the real client against a real local
 * server.
 */
function apiBase(value: string | undefined): string {
  if (value === undefined || value === "") return "https://api.github.com";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("GITHUB_API_BASE", "must be an absolute URL");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol === "https:") return url.origin + url.pathname.replace(/\/+$/, "");
  if (url.protocol === "http:" && loopback) return url.origin + url.pathname.replace(/\/+$/, "");
  throw new ConfigError("GITHUB_API_BASE", "must be https, unless it is a loopback address");
}

/** An integer setting with lower and upper bounds. */
function boundedInt(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(name, `must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

/** The commit's author identity. */
function commitAuthor(value: string | undefined): { name: string; email: string } {
  if (value === undefined || value === "") {
    return { name: COMMIT_AUTHOR_NAME, email: COMMIT_AUTHOR_EMAIL };
  }
  const match = /^(.{1,64}?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(value);
  if (match === null) {
    throw new ConfigError("GITHUB_COMMIT_AUTHOR", "must be of the form \"Name <email>\"");
  }
  return { name: match[1]!, email: match[2]! };
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
