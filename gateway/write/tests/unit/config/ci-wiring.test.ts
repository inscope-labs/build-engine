/**
 * The CI wiring (plan task 5.5.8).
 *
 * The gates are written twice on purpose: once as a definition in `gateway/write/ci/*.yml`, where
 * a reader can see what the gate *is*, and once as a job in the repository's root
 * `.github/workflows/`, because GitHub only runs workflows from there. Two copies of the same
 * gate are two things that can drift apart, and a gate that has drifted is worse than no gate:
 * it looks like a gate.
 *
 * So the two copies are checked against each other, here:
 *
 *  - every definition has a job with the same name in one of the root workflows;
 *  - the job runs the **same commands** the definition runs;
 *  - the pull-request workflow is triggered by a pull request, and the scheduled workflow is not;
 *  - no pull-request-triggered workflow names a deployment credential.
 *
 * The YAML is read with a small reader rather than a parser, because the only thing that matters
 * here is the shape of these particular files: the job names and the commands they run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** The gateway's root. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The root workflows. */
const WORKFLOWS = join(ROOT, "..", "..", ".github", "workflows");

/** The job definitions. */
const DEFINITIONS = join(ROOT, "ci");

/** The names that mean a deployment credential. The same list the deploy gate uses. */
const DEPLOYMENT_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "WRANGLER_API_TOKEN",
  "GITHUB_TOKEN",
  "DEPLOY_TOKEN",
];

/** The job names of a workflow: the keys under `jobs:`. */
function jobNames(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === "jobs:");
  if (start === -1) return [];
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) {
      if (/^ {2}\S/.test(line)) break;
      continue;
    }
    names.push(line.trim().replace(":", ""));
  }
  return names;
}

/** The body of one job: the lines from its name to the next job. */
function jobBody(text: string, job: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() !== "" && line.trim().startsWith("#") === false && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

/** The npm commands a piece of YAML runs. */
function npmCommands(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/npm run ([a-z:_-]+)/g)) found.add(`npm run ${match[1]}`);
  if (/(^|\s)npm test(\s|$)/m.test(text)) found.add("npm test");
  return [...found].sort();
}

/** Whether the workflow is triggered by a pull request. */
function triggeredByPullRequest(text: string): boolean {
  return /pull_request(_target)?\s*:/.test(text);
}

/** Every workflow file. */
function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(WORKFLOWS, name));
}

test("every gate definition has a job with the same name in a root workflow", () => {
  const workflows = workflowFiles();
  const wired = new Map<string, { file: string; text: string }>();
  for (const file of workflows) {
    const text = readFileSync(file, "utf-8");
    for (const job of jobNames(text)) wired.set(job, { file, text });
  }

  const definitions = readdirSync(DEFINITIONS).filter((name) => name.endsWith(".yml"));
  assert.ok(definitions.length >= 6, `the gate definitions are present: ${definitions.join(", ")}`);

  for (const name of definitions) {
    const text = readFileSync(join(DEFINITIONS, name), "utf-8");
    const jobs = jobNames(text);
    assert.equal(jobs.length, 1, `${name} defines exactly one job`);
    const job = jobs[0]!;
    assert.ok(wired.has(job), `${name}: the job "${job}" is wired into a root workflow`);
  }
});

test("a wired job runs the same commands as its definition", () => {
  const workflows = workflowFiles();

  for (const name of readdirSync(DEFINITIONS).filter((file) => file.endsWith(".yml"))) {
    const definition = readFileSync(join(DEFINITIONS, name), "utf-8");
    const job = jobNames(definition)[0]!;
    const expected = npmCommands(definition);
    assert.ok(expected.length > 0, `${name} runs at least one command`);

    let checked = false;
    for (const file of workflows) {
      const text = readFileSync(file, "utf-8");
      if (!jobNames(text).includes(job)) continue;
      const actual = npmCommands(jobBody(text, job));
      assert.deepEqual(
        actual,
        expected,
        `${name}: the job "${job}" in ${file.split("/").pop()} runs the same commands as its definition`,
      );
      checked = true;
    }
    assert.ok(checked, `${name}: the job "${job}" is wired somewhere`);
  }
});

test("the pull-request workflow is triggered by a pull request, and the scheduled one is not", () => {
  const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf-8");
  assert.equal(triggeredByPullRequest(ci), true, "ci.yml runs on a pull request");

  const nightly = readFileSync(join(WORKFLOWS, "nightly.yml"), "utf-8");
  assert.equal(triggeredByPullRequest(nightly), false, "nightly.yml does not run on a pull request");
  assert.match(nightly, /schedule:/, "nightly.yml runs on a schedule");
});

test("no pull-request-triggered workflow names a deployment credential", () => {
  for (const file of workflowFiles()) {
    const text = readFileSync(file, "utf-8");
    if (!triggeredByPullRequest(text)) continue;
    for (const secret of DEPLOYMENT_SECRETS) {
      assert.ok(
        !text.includes(secret),
        `${file.split("/").pop()} names ${secret} and is triggered by a pull request`,
      );
    }
  }
});

test("the scheduled workflow deploys nothing", () => {
  const nightly = readFileSync(join(WORKFLOWS, "nightly.yml"), "utf-8");
  // `wrangler deploy` publishes. The scheduled workflow may build the bundle and must not
  // publish it, and it must not hold a deployment credential to do so.
  assert.ok(
    !/wrangler deploy(?! --dry-run)/.test(nightly),
    "the scheduled workflow never runs a publishing deploy",
  );
  for (const secret of DEPLOYMENT_SECRETS) {
    assert.ok(!nightly.includes(secret), `the scheduled workflow holds no ${secret}`);
  }
});

test("the write-gateway gates are all wired", () => {
  const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf-8");
  const nightly = readFileSync(join(WORKFLOWS, "nightly.yml"), "utf-8");

  // The pull-request gates.
  for (const job of [
    "write-gateway-lint",
    "write-gateway-unit",
    "write-gateway-integration",
    "write-gateway-deploy-gate",
    "write-gateway-staging-separation",
  ]) {
    assert.ok(jobNames(ci).includes(job), `ci.yml has the ${job} job`);
  }
  // The scheduled gates.
  for (const job of ["write-gateway-load", "write-gateway-chaos"]) {
    assert.ok(jobNames(nightly).includes(job), `nightly.yml has the ${job} job`);
  }
});

test("no workflow has the YAML trap: a plain value that contains a colon", () => {
  // A plain scalar may not contain ": " — the parser reads the text after it as a nested
  // mapping, and the file does not parse at all. GitHub's symptom is silent and confusing:
  // the workflow's name falls back to its path, its triggers are not read, and it creates no
  // jobs. It cost a run to find, so it is checked here.
  //
  // The value has to be quoted, or the colon has to go.
  const offenders: string[] = [];

  for (const file of [...workflowFiles(), ...readdirSync(DEFINITIONS).map((name) => join(DEFINITIONS, name))]) {
    const lines = readFileSync(file, "utf-8").split("\n");
    let inBlock = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      // A block scalar's body is literal text, and a colon in it is not a mapping.
      if (inBlock > 0) {
        if (trimmed !== "" && line.startsWith(" ".repeat(inBlock))) inBlock += 0;
        if (trimmed === "") continue;
        const indent = line.length - line.trimStart().length;
        if (indent > inBlock) continue;
        inBlock = 0;
      }
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      if (/: \||: >$/.test(trimmed)) {
        inBlock = line.length - line.trimStart().length;
        continue;
      }
      const match = /^([^:]+):\s+(.*)$/.exec(trimmed);
      if (match === null) continue;
      const value = match[2]!;
      if (value.startsWith('"') || value.startsWith("'") || value.startsWith("|") || value.startsWith(">")) {
        continue;
      }
      if (value.includes(": ")) offenders.push(`${file.split("/").pop()}: ${trimmed}`);
    }
  }

  assert.deepEqual(offenders, [], "these lines do not parse as YAML:");
});
