// scripts/verify-log-hygiene.ts: the deploy gate for log hygiene and the credential boundary.
//
// Plan task 5.4.2, and the deployment gate of 5.4.6. It is a **gate**: it exits non-zero when
// something is wrong, and it is what the deployment workflow runs before it deploys.
//
// Four checks:
//
//   1. **The dynamic check.** The gateway is driven through the whole protocol with sentinels in
//      every place a secret could be, and every output it produces is scanned. The driver is the
//      same one the unit test uses, so the gate and the test can never check different things.
//   2. **The static credential scan.** The gateway's own source is scanned for the shapes of real
//      credentials. A credential that was committed is a credential that is in the repository
//      history, whatever happens to the file afterwards.
//   3. **The logging check.** Only the audit logger may write to the platform's log. A
//      `console.log` anywhere else is a line the audit schema does not govern.
//   4. **The workflow check.** A workflow that references a deployment credential must not be
//      triggered by a pull request. The deployment credentials are the ones an untrusted
//      contributor could otherwise reach.
//
// Run it with:
//
//     node --experimental-strip-types scripts/verify-log-hygiene.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY = resolve(HERE, "..");
const REPOSITORY = resolve(GATEWAY, "../..");

/** The shapes of credentials that must never be committed. */
const CREDENTIAL_SHAPES: { name: string; pattern: RegExp }[] = [
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "an AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "an OpenAI-style key", pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "a Cloudflare API token", pattern: /\b[A-Za-z0-9_-]{40}\b(?=[^\n]*CLOUDFLARE)/ },
];

/** The names that mean a deployment credential. */
const DEPLOYMENT_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "WRANGLER_API_TOKEN",
  "GITHUB_TOKEN",
  "DEPLOY_TOKEN",
];

/** The files the static scan covers. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        out.push(path);
      }
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out;
}

/** A finding. */
interface Finding {
  check: string;
  where: string;
  what: string;
}

const findings: Finding[] = [];

// --- 1. the dynamic check ---
const { runHygieneCheck } = await import("../tests/helpers/hygiene.ts");
const hygiene = await runHygieneCheck();
for (const finding of hygiene.findings) {
  findings.push({
    check: "log-hygiene",
    where: finding.where,
    what: `the ${finding.sentinel} sentinel appeared in an output`,
  });
}
console.log(
  `log hygiene: ${hygiene.outputs.length} outputs scanned, ${hygiene.findings.length} findings`,
);

// --- 2. the static credential scan ---
for (const path of [...sourceFiles(join(GATEWAY, "src")), ...sourceFiles(join(GATEWAY, "scripts"))]) {
  const text = readFileSync(path, "utf-8");
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.pattern.test(text)) {
      findings.push({
        check: "static-credentials",
        where: relative(REPOSITORY, path),
        what: `the source contains ${shape.name}`,
      });
    }
  }
}
for (const name of ["wrangler.toml", ".dev.vars.example"]) {
  const path = join(GATEWAY, name);
  const text = readFileSync(path, "utf-8");
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.pattern.test(text)) {
      findings.push({
        check: "static-credentials",
        where: relative(REPOSITORY, path),
        what: `the configuration contains ${shape.name}`,
      });
    }
  }
}
console.log("static credentials: the source and the configuration scanned");

// --- 3. the logging check ---
for (const path of sourceFiles(join(GATEWAY, "src"))) {
  if (path.endsWith(join("audit", "logger.ts"))) continue;
  const text = readFileSync(path, "utf-8");
  if (/\bconsole\.(log|info|warn|error|debug)\s*\(/.test(text)) {
    findings.push({
      check: "logging",
      where: relative(REPOSITORY, path),
      what: "something other than the audit logger writes to the platform's log",
    });
  }
}
console.log("logging: every write to the platform's log goes through the audit logger");

// --- 4. the workflow check ---
const workflows = join(REPOSITORY, ".github", "workflows");
if (statSync(workflows).isDirectory()) {
  for (const name of readdirSync(workflows)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const path = join(workflows, name);
    const text = readFileSync(path, "utf-8");
    const touches = DEPLOYMENT_SECRETS.filter((secret) => text.includes(secret));
    if (touches.length === 0) continue;
    // A workflow that a pull request can trigger must not hold a deployment credential. The
    // deployment is a separate workflow, triggered by a push to a protected ref.
    const onPullRequest = /pull_request(_target)?\s*:/.test(text);
    if (onPullRequest) {
      findings.push({
        check: "workflow",
        where: relative(REPOSITORY, path),
        what: `a pull-request-triggered workflow references ${touches.join(", ")}`,
      });
    }
  }
}
console.log("workflows: no pull-request-triggered workflow holds a deployment credential");

// --- the verdict ---
if (findings.length > 0) {
  console.error("");
  console.error("deploy gate: FAILED");
  for (const finding of findings) {
    console.error(`  [${finding.check}] ${finding.where}: ${finding.what}`);
  }
  process.exit(1);
}
console.log("");
console.log("deploy gate: OK");
