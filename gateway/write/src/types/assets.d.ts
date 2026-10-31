// src/types/assets.d.ts: the module declarations for the assets the bundler loads as text.
//
// The contract documents are imported as text by the bundler's `Text` rule (see wrangler.toml).
// TypeScript needs to be told that a `.md` import is a string.
//
// The Node test runner uses a loader hook (tests/helpers/md-loader.mjs) to do the same thing
// outside the bundler.

declare module "*.md" {
  const content: string;
  export default content;
}
