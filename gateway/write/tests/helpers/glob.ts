/**
 * A small glob matcher.
 *
 * It exists for one reason: the repository's test runner is invoked with a glob, and a glob that
 * matches nothing is **silent**. Stage 5.2 lost time to exactly that — `node --test
 * "tests/unit/*.test.ts"` matched nothing when every unit test lived in a subdirectory, the suite
 * reported 36 passing tests and looked green while no unit test had run at all.
 *
 * So the inventory check needs to know what a glob actually matches, and it must not use a
 * different rule from the runner's. The rules are the usual ones:
 *
 *  - `*` matches any run of characters **within one path segment** — it does not cross a `/`;
 *  - `?` matches one character within one path segment;
 *  - `**` as a whole segment matches **zero or more** path segments.
 *
 * That last rule is the difference between the two patterns that matter here. The first one
 * matches a test file that sits directly in `tests/unit/` and nothing below it; the second one
 * matches both. The exact strings are in the test that exercises this matcher, because a glob
 * written in a block comment here would close the comment on the `*` of the pattern.
 *
 * The matcher is exercised by its own unit test, and the inventory check uses it to prove that
 * every test file in the repository is reachable from one of the runner's globs.
 */
import { readdirSync } from "node:fs";
import { posix } from "node:path";

/** Escape the regular-expression metacharacters in a literal. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One path segment of a pattern, as a regular-expression fragment. */
function segmentToFragment(segment: string): string {
  let out = "";
  for (const character of segment) {
    if (character === "*") out += "[^/]*";
    else if (character === "?") out += "[^/]";
    else out += escapeLiteral(character);
  }
  return out;
}

/**
 * Translate a glob into a regular expression.
 *
 * The pattern is written with forward slashes, and so is the path it is matched against; a
 * Windows path is converted before it is matched.
 */
export function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split("/");
  let source = "^";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const last = i === segments.length - 1;
    if (segment === "**") {
      // A `**` segment matches zero or more whole segments. The trailing form swallows the
      // separator as well, so that `a/**/b` matches `a/b` and not only `a/x/b`.
      source += last ? "(?:.*)?" : "(?:[^/]+/)*";
      continue;
    }
    source += segmentToFragment(segment);
    if (!last) source += "/";
  }
  source += "$";
  return new RegExp(source);
}

/** Whether a path matches a glob. */
export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(posix.normalize(path.split("\\").join("/")));
}

/** The files under a directory, recursively, as paths relative to it. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(root, "");
  return out.sort();
}
