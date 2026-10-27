# Releasing

1. Branch from `main`. Make and test the change (`python3 -m unittest discover -s template/engine/tools`, and the other
   commands in the README). Anything new that must ship needs a line in `release/manifest.txt`.
2. Choose the version: `release/set-version.sh X.Y.Z` (updates `VERSION`, `template/engine/VERSION` and
   `template/engine/ENGINE.json` together).
3. Confirm the protocol version this release implements: `protocol` in
   `template/engine/ENGINE.json`, with a matching row in `COMPATIBILITY.md`.
4. Add `## X.Y.Z - YYYY-MM-DD` to `CHANGELOG.md` (replace `unreleased` with the date).
5. Open a pull request; CI must pass (tests, release self-test, update-flow test, a dry-run package + verify).
6. After merge: `git tag vX.Y.Z <commit on main> && git push origin vX.Y.Z`.
7. `release.yml` checks the tag against `VERSION` and `main`, reruns the tests, packages, runs
   `verify.sh --release`, and publishes `build-engine-vX.Y.Z.tar.gz` and its `.sha256`. A failure at any step publishes
   nothing.
8. Consumers update with `engine/bin/update.sh --version X.Y.Z` on a branch and open a pull request with the diff.

Never edit or delete a published release asset; publish a new version instead. Because this repository is private,
fetching assets needs an authenticated `gh` (`gh auth login`) with read access.
