/**
 * The gateway's policy: which configuration it runs with, and how a path is judged against it.
 *
 * The policy is read from the Worker's environment (secrets and vars) and is reported on
 * /healthz, but only the parts that change how a link is judged. The allowed prefixes, the
 * deny patterns, the repository and the secrets are protected state and are never reported.
 */
import { DEFAULT_DENY } from "./deny.ts";

export interface Policy {
  /** key id -> signing secret */
  keys: Map<string, string>;
  /** repository paths that may be served at all */
  allowPrefixes: string[];
  /** paths refused even inside an allowed prefix */
  deny: RegExp[];
  maxBytes: number;
  maxTtl: number;
  /** seconds the gateway's clock is assumed to lag the minter's */
  clockSkewTolerance: number;
  sourceTimeoutMs: number;
  rateLimitPerOrder: number;
  rateLimitPerIp: number;
  rateLimitGlobal: number;
  refusalBurst: number;
  refusalCooldownSeconds: number;
  auditRetention: number;
}

export class ConfigError extends Error {}

/** Characters that must be escaped when a prefix is turned into a regular expression. */
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * An allow-list prefix. A prefix must end in '/', and may contain a single '*' to match exactly
 * one path segment, for example "plans/" plus a star plus "/package/". The match is anchored at
 * the start of the path, so "amk/" never matches "amkfoo".
 */
export function prefixToRegExp(prefix: string): RegExp {
  if (!prefix.endsWith("/")) throw new ConfigError(`allow prefix must end in '/': ${prefix}`);
  const source = prefix.split("*").map((part) => part.replace(REGEX_SPECIALS, "\\$&")).join("[^/]*");
  return new RegExp("^" + source);
}

export function isPathAllowed(path: string, prefixes: RegExp[]): boolean {
  return prefixes.some((re) => re.test(path));
}

function intEnv(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer in [${min}, ${max}], got ${value}`);
  }
  return n;
}

/** Build the policy from the Worker environment. Throws ConfigError on a bad configuration. */
export function loadPolicy(env: Record<string, string | undefined>): Policy {
  let keys: Map<string, string>;
  try {
    const raw = JSON.parse(env.SIGNING_KEYS ?? "{}") as Record<string, string>;
    keys = new Map(Object.entries(raw));
  } catch (e) {
    throw new ConfigError(`SIGNING_KEYS is not valid JSON: ${(e as Error).message}`);
  }
  if (keys.size === 0) throw new ConfigError("SIGNING_KEYS names no key id");

  let denySources: string[];
  try {
    denySources = JSON.parse(env.DENY_PATTERNS ?? JSON.stringify(DEFAULT_DENY)) as string[];
  } catch (e) {
    throw new ConfigError(`DENY_PATTERNS is not valid JSON: ${(e as Error).message}`);
  }
  const deny: RegExp[] = [];
  for (const source of denySources) {
    try {
      // A deny list is compiled case-insensitively: .GIT must be refused like .git.
      deny.push(new RegExp(source, "i"));
    } catch (e) {
      throw new ConfigError(`DENY_PATTERNS entry is not a valid regular expression: ${source}`);
    }
  }

  const prefixes = (env.ALLOW_PREFIXES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (prefixes.length === 0) throw new ConfigError("ALLOW_PREFIXES names no prefix");

  return {
    keys,
    allowPrefixes: prefixes,
    deny,
    maxBytes: intEnv(env.MAX_BYTES, 1_048_576, "MAX_BYTES", 1, 64 * 1024 * 1024),
    maxTtl: intEnv(env.MAX_TTL, 259_200, "MAX_TTL", 1, 259_200),
    clockSkewTolerance: intEnv(env.CLOCK_SKEW_TOLERANCE, 120, "CLOCK_SKEW_TOLERANCE", 0, 120),
    sourceTimeoutMs: intEnv(env.SOURCE_TIMEOUT_MS, 5_000, "SOURCE_TIMEOUT_MS", 100, 60_000),
    rateLimitPerOrder: intEnv(env.RATE_LIMIT_PER_ORDER, 60, "RATE_LIMIT_PER_ORDER", 1, 10_000),
    rateLimitPerIp: intEnv(env.RATE_LIMIT_PER_IP, 300, "RATE_LIMIT_PER_IP", 1, 100_000),
    rateLimitGlobal: intEnv(env.RATE_LIMIT_GLOBAL, 600, "RATE_LIMIT_GLOBAL", 1, 1_000_000),
    refusalBurst: intEnv(env.REFUSAL_BURST, 30, "REFUSAL_BURST", 1, 10_000),
    refusalCooldownSeconds: intEnv(env.REFUSAL_COOLDOWN_SECONDS, 300, "REFUSAL_COOLDOWN_SECONDS", 1, 86_400),
    auditRetention: intEnv(env.AUDIT_RETENTION, 500, "AUDIT_RETENTION", 10, 10_000),
  };
}

/** The effective policy as reported on /healthz. Never includes prefixes, patterns or secrets. */
export function healthPayload(policy: Policy, version: string): Record<string, unknown> {
  return {
    status: "ok",
    version,
    scheme: "ctxgate-v1",
    clock_skew_tolerance: policy.clockSkewTolerance,
    max_ttl: policy.maxTtl,
    max_bytes: policy.maxBytes,
    key_ids: [...policy.keys.keys()].sort(),
  };
}
