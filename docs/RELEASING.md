# Releasing

1. Branch from `main`. Make and test the change (`python3 -m unittest discover -s template/engine/tools`, and the other
   commands in the README). Anything new that must ship needs a line in `release/manifest.txt`.
2. Choose the version: `release/set-version.sh X.Y.Z` (updates `VERSION`, `template/engine/VERSION` and
   `template/engine/release.json` together).
3. Confirm the protocol version this release implements: `protocol` in
   `template/engine/release.json`, with a matching row in `COMPATIBILITY.md`.
4. Add `## X.Y.Z - YYYY-MM-DD` to `CHANGELOG.md` (replace `unreleased` with the date).
5. Open a pull request; CI must pass (tests, release self-test, update-flow test, a dry-run package + verify).
6. After merge: `git tag vX.Y.Z <commit on main> && git push origin vX.Y.Z`.
7. `release.yml` checks the tag against `VERSION` and `main`, reruns the tests, packages, runs
   `verify.sh --release`, and publishes `build-engine-vX.Y.Z.tar.gz` and its `.sha256`. A failure at any step publishes
   nothing.
8. Consumers update with `engine/bin/update.sh --version X.Y.Z` on a branch and open a pull request with the diff.

Never edit or delete a published release asset; publish a new version instead. Because this repository is private,
fetching assets needs an authenticated `gh` (`gh auth login`) with read access.

## Packaging rules (Stage 3.1)

`release/package.sh` builds the artifact from the **tracked** files under `template/` that the allowlist covers. It
refuses to build rather than guess:

- **The tree must be committed and clean.** A modified, deleted, staged or untracked file under `template/`, or a
  modified `release/manifest.txt`, fails the build. A local scratch file can therefore never reach a consumer, and a
  release is always built from a state that exists in the repository. This is also why packaging needs `git`: it is
  not an optional convenience.
- **Every manifest line is checked.** A `managed`/`seed` mode, a relative path, no empty, `.` or `..` component, no
  whitespace, a target that exists and is tracked, and no path declared twice, declared as both managed and seed, or
  equal to another path under case folding. The last one matters because the artifact has to install on a
  case-insensitive filesystem, where `engine/ENGINE.json` and `engine/engine.json` would be the same file - which is
  why the managed metadata file is `engine/release.json`.
- **Only regular files are packaged.** A symlink, a device, a socket or a fifo is refused. A tracked generated file
  (a `.pyc`, a `node_modules/` tree, a `.env`, an archive) is refused too, rather than being quietly left out of the
  artifact. A file that is merely *untracked* and ignored by `.gitignore` is not packaged and does not fail the build:
  `.gitignore` is the maintainer's own statement that the file is not part of the tree.
- **The output directory may not be inside `template/`.** An artifact that is written into the packaged tree is
  packaged into the next artifact. The usual `dist/` (git-ignored) is fine.
- **A failed build leaves no artifact.** The previous artifact is removed before the build starts and the new one is
  written to a temporary file and moved into place only when it is complete, so a file in `dist/` is always the
  product of a successful build.

The artifact is deterministic: modes are normalised (0644, or 0755 for a file whose git index mode is 100755), the
mtime, owner and member order are fixed, and the gzip header carries no name or timestamp. The same commit therefore
produces byte-identical artifacts, whatever the builder's umask and whatever the checkout's file modes are.

`release/verify.sh` then inspects the finished artifact independently. It never trusts how it was built.
