/**
 * The inventory guard: every test file is reachable, and nothing is a stub.
 *
 * This test is the executable form of two claims that are otherwise easy to make and impossible to
 * check:
 *
 *  1. **"No 501 handler or placeholder source/test stubs remain in any feature claimed as
 *     supported."** That is the Phase 5 exit gate, and it is a statement about the *whole* module,
 *     not about the files one stage happened to touch. So it is checked mechanically here: no
 *     source file, script or test file may carry the stub marker, and no test file may be empty of
 *     tests.
 *
 *  2. **"The test runner runs the test suite."** A glob that matches nothing is silent, and a
 *     silent glob is how Stage 5.2 reported 36 passing tests while no unit test had run. So the
 *     runner's globs are read out of `package.json` and every test file in the repository is
 *     checked against them. A test file that no glob reaches is a finding, not a curiosity.
 *
 * The stub marker is the string the scaffolds carried:
 *
 *     // STATUS: scaffold only, not implemented.
 *
 * It is searched for in the source, the scripts and the tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { globToRegExp, listFiles, matchesGlob } from "../../helpers/glob.ts";

/** The gateway's root. The test lives three directories below it. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * The marker every scaffold carried.
 *
 * It is assembled at runtime rather than written out, so that this file — which has to name the
 * marker to look for it — does not match itself.
 */
const STUB_MARKER = ["STATUS", "scaffold only"].join(" ");

/** The scripts the runner is invoked with, and the glob each one uses. */
const RUNNER_SCRIPTS = ["test", "test:unit", "test:integration", "test:load", "test:chaos"] as const;

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as PackageJson;
}

/** The glob inside a runner script, or null when the script has no glob. */
function globOf(script: string): string | null {
  const match = /"([^"]*\*[^"]*)"/.exec(script);
  return match === null ? null : match[1]!;
}

test("the runner's glob reaches every test file in the repository", () => {
  const pkg = readPackageJson();
  const scripts = pkg.scripts ?? {};

  const globs: string[] = [];
  for (const name of RUNNER_SCRIPTS) {
    const script = scripts[name];
    assert.ok(script !== undefined, `package.json has no "${name}" script`);
    const glob = globOf(script!);
    assert.ok(glob !== null, `the "${name}" script has no glob in it`);
    globs.push(glob!);
  }

  // The paths are relative to the gateway's root, because that is how the runner's globs are
  // written: the glob is rooted at the package directory, not at the tests directory.
  const testFiles = listFiles(join(ROOT, "tests"))
    .filter((path) => path.endsWith(".test.ts"))
    .map((path) => `tests/${path}`);
  assert.ok(testFiles.length > 0, "there are test files to check");

  // The whole-suite glob must reach every test file. A file that only the per-suite globs
  // reach would not run in `npm test`, and `npm test` is what the deploy gate runs.
  const whole = globs[0]!;
  const unreachable = testFiles.filter((path) => !matchesGlob(path, whole));
  assert.deepEqual(unreachable, [], `these test files are not reached by "${whole}":`);

  // And each per-suite glob must reach only its own suite's files, so that the CI gates really
  // are separate gates.
  const suites: [string, string][] = [
    ["test:unit", "tests/unit/"],
    ["test:integration", "tests/integration/"],
    ["test:load", "tests/load/"],
    ["test:chaos", "tests/chaos/"],
  ];
  for (const [name, prefix] of suites) {
    const glob = globOf(scripts[name]!)!;
    const matched = testFiles.filter((path) => matchesGlob(path, glob));
    assert.ok(matched.length > 0, `the "${name}" glob matches no test file`);
    for (const path of matched) {
      assert.ok(
        path.startsWith(prefix),
        `the "${name}" glob matches ${path}, which is not in ${prefix}`,
      );
    }
  }

  // Every test file belongs to exactly one suite, and no suite is empty.
  for (const path of testFiles) {
    const owners = suites.filter(([, prefix]) => path.startsWith(prefix));
    assert.equal(owners.length, 1, `${path} belongs to ${owners.length} suites`);
  }
});

test("no source file, script or test file is a stub", () => {
  const roots = ["src", "scripts", "tests"];
  const findings: string[] = [];

  for (const root of roots) {
    for (const path of listFiles(join(ROOT, root))) {
      if (!/\.(ts|mjs|js)$/.test(path)) continue;
      const text = readFileSync(join(ROOT, root, path), "utf-8");
      if (text.includes(STUB_MARKER)) findings.push(`${root}/${path}`);
      // The other shape of a stub: a module that exports nothing at all.
      if (/^export \{\};?$/m.test(text) && text.trim().split("\n").length <= 4) {
        findings.push(`${root}/${path} (exports nothing)`);
      }
    }
  }

  assert.deepEqual(findings, [], "these files are still stubs:");
});

test("no test file is empty of tests", () => {
  const findings: string[] = [];

  for (const path of listFiles(join(ROOT, "tests"))) {
    if (!path.endsWith(".test.ts")) continue;
    const text = readFileSync(join(ROOT, "tests", path), "utf-8");
    const calls = /^\s*(?:test|it|describe)\s*\(/gm.test(text);
    if (!calls) findings.push(path);
  }

  assert.deepEqual(findings, [], "these test files declare no test:");
});

test("the matcher is the one the runner uses: a single star does not cross a directory", () => {
  // The trap from Stage 5.2, written down so that it cannot come back.
  assert.ok(
    matchesGlob("tests/unit/auth/root-url.test.ts", "tests/unit/**/*.test.ts"),
    "a double star reaches into a subdirectory",
  );
  assert.ok(
    !matchesGlob("tests/unit/auth/root-url.test.ts", "tests/unit/*.test.ts"),
    "a single star does not reach into a subdirectory",
  );
  assert.ok(
    matchesGlob("tests/unit/session/sequence.test.ts", "tests/unit/**/*.test.ts"),
    "a double star also matches the directory itself",
  );
  assert.ok(
    !matchesGlob("tests/unit/auth/root-url.test.ts", "tests/integration/**/*.test.ts"),
    "a suite's glob reaches only its own suite",
  );
});

test("the matcher treats a path as a path, not as a string to be matched loosely", () => {
  assert.ok(globToRegExp("tests/**/*.test.ts") instanceof RegExp);
  assert.ok(!matchesGlob("tests/unit/root-url.test.ts.bak", "tests/**/*.test.ts"));
  assert.ok(!matchesGlob("src/index.ts", "tests/**/*.test.ts"));
  // A `**` segment matches zero segments, so `a/**/b` matches `a/b`.
  assert.ok(matchesGlob("a/b", "a/**/b"));
  assert.ok(matchesGlob("a/x/b", "a/**/b"));
});
