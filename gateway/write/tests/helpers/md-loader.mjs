/**
 * The loader hook that lets the Node test runner import the contract documents.
 *
 * The bundler loads a `.md` file as text (the `Text` rule in wrangler.toml). The Node test
 * runner has no such rule, so this hook does the same thing: a `.md` import becomes a module
 * whose default export is the file's text.
 *
 * The hook is registered by `tests/helpers/register.mjs`, which the `test` script passes with
 * `node --import`.
 */
import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".md")) {
    const source = await readFile(new URL(url), "utf-8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(source)};`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
