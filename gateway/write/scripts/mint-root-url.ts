// scripts/mint-root-url.ts: mint a capability URL, locally.
//
// The gateway's own `/admin/mint` route needs a live gateway and the operator credential. This
// script is the offline equivalent: it signs a capability with the **shipped** signing code, so
// that a capability minted here is exactly one the gateway verifies, and it needs nothing but the
// signing key.
//
// The signing keys are read from the `SIGNING_KEYS` environment variable — the same JSON the
// gateway reads — and never from an argument, so that a secret does not end up in the shell
// history or in the process list. The keys are never printed.
//
// Run it with:
//
//     SIGNING_KEYS='{"k1":"…"}' node --experimental-strip-types scripts/mint-root-url.ts \
//       --task 10008-1-001-01 --order 10008-S001 --plan castiel-dev --writer agent-7
import { sign } from "../src/auth/signature.ts";
import { DEFAULT_MAX_TTL_SECONDS } from "../src/config/constants.ts";

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
  kid: string | null;
  task: string | null;
  order: string | null;
  plan: string | null;
  writer: string | null;
  head: string | null;
  ttl: number;
  base: string | null;
  folderTemplate: string;
  problem: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    kid: null,
    task: null,
    order: null,
    plan: null,
    writer: null,
    head: null,
    ttl: 3600,
    base: null,
    folderTemplate: "plans/{plan}/submissions/{order}/{task}",
    problem: null,
  };
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (!argument.startsWith("--")) {
      options.problem = `unexpected argument: ${argument}`;
      return options;
    }
    const name = argument.slice(2);
    if (name === "help") {
      options.problem =
        "usage: mint-root-url --task ID --order ID --plan ID --writer ID [--kid ID] [--ttl SECONDS] [--head SHA] [--base URL]";
      return options;
    }
    const value = argv[++i];
    if (value === undefined) {
      options.problem = `--${name} needs a value`;
      return options;
    }
    values[name] = value;
  }
  options.kid = values.kid ?? null;
  options.task = values.task ?? null;
  options.order = values.order ?? null;
  options.plan = values.plan ?? null;
  options.writer = values.writer ?? null;
  options.head = values.head ?? null;
  options.base = values.base ?? null;
  if (values.folder !== undefined) options.folderTemplate = values.folder;
  if (values.ttl !== undefined) {
    const ttl = Number(values.ttl);
    if (!Number.isInteger(ttl) || ttl <= 0) {
      options.problem = "--ttl must be a positive whole number of seconds";
      return options;
    }
    options.ttl = ttl;
  }
  return options;
}

/** The signing keys, from the environment. */
function readKeys(): Map<string, string> {
  const raw = process.env.SIGNING_KEYS;
  if (raw === undefined || raw === "") {
    throw new Error("SIGNING_KEYS is not set; it must be the same JSON the gateway reads");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SIGNING_KEYS is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SIGNING_KEYS must be a JSON object of key ids to secrets");
  }
  const keys = new Map<string, string>();
  for (const [kid, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret !== "string" || secret === "") {
      throw new Error(`the key id "${kid}" has no secret`);
    }
    keys.set(kid, secret);
  }
  if (keys.size === 0) throw new Error("SIGNING_KEYS has no key ids in it");
  return keys;
}

/** Resolve the task folder, the way the gateway does. */
function resolveFolder(template: string, plan: string, order: string, task: string): string {
  const values: Record<string, string> = { plan, order, task };
  return template.replace(/\{(plan|order|task)\}/g, (_match, name: string) => values[name] ?? "");
}

const options = parseOptions(process.argv.slice(2));

if (options.problem !== null) fail(options.problem);

const task = options.task;
const order = options.order;
const plan = options.plan;
const writer = options.writer;
if (task === null || order === null || plan === null || writer === null) {
  fail("--task, --order, --plan and --writer are all required");
}

let keys: Map<string, string>;
try {
  keys = readKeys();
} catch (e) {
  fail(e instanceof Error ? e.message : "the signing keys could not be read", 1);
}

const kid = options.kid ?? [...keys.keys()].sort()[0]!;
const secret = keys.get(kid);
if (secret === undefined) fail(`the key id "${kid}" is not one of the signing keys`);

const now = Math.floor(Date.now() / 1000);
const ttl = Math.min(options.ttl, DEFAULT_MAX_TTL_SECONDS);
const exp = now + ttl;
const head = options.head ?? "0".repeat(40);

if (!/^[0-9a-f]{40}$/.test(head)) {
  fail("--head must be the 40-character hexadecimal sha of the branch head");
}

const fields = {
  kid,
  exp,
  order,
  plan,
  task,
  writer,
  head,
};
const signature = await sign(secret, fields);

const path =
  `/w1/${kid}/${exp}/${order}/${plan}/${task}/${writer}/${head}/${signature}`;
const base = options.base === null ? "" : options.base.replace(/\/+$/, "");

console.log("capability:      " + base + path);
console.log("key id:          " + kid);
console.log("expires:         " + exp + " (" + new Date(exp * 1000).toISOString() + ")");
console.log("lifetime:        " + ttl + " seconds");
console.log("expected head:   " + head);
console.log("task folder:     " + resolveFolder(options.folderTemplate, plan, order, task));
console.log("");
console.log("The capability is a bearer secret. Hand it to the agent and to nobody else.");
