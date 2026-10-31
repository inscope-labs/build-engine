#!/usr/bin/env bash
# set-version.sh X.Y.Z - update every place the version and its compatibility record live, so they cannot drift:
#   VERSION, template/engine/VERSION, template/engine/release.json (engine_version + protocol build-engine/<major.minor>),
#   the COMPATIBILITY.md row for X.Y.Z, and the CHANGELOG.md "## X.Y.Z - unreleased" heading (created when missing).
# Safe to run again with the same version: nothing is duplicated.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: set-version.sh X.Y.Z" >&2; exit 2; }
PROTO="build-engine/${V%.*}"
printf '%s\n' "$V" > "$ROOT/VERSION"
printf '%s\n' "$V" > "$ROOT/template/engine/VERSION"
python3 - "$ROOT" "$V" "$PROTO" <<'PY'
import json, re, sys
root, v, proto = sys.argv[1:4]

# release.json: engine_version and protocol; the retired key is dropped
p = root + "/template/engine/release.json"
d = json.load(open(p)); d.pop("implements_abstract", None)
d["engine_version"] = v; d["protocol"] = proto
open(p, "w").write(json.dumps(d, indent=2) + "\n")

# COMPATIBILITY.md: one row per engine version
p = root + "/COMPATIBILITY.md"
lines = open(p).read().split("\n")
row = re.compile(r"^\|\s*" + re.escape(v) + r"( \(unreleased\))?\s*\|([^|]*)\|(.*)$")
for i, l in enumerate(lines):
    m = row.match(l)
    if m:
        lines[i] = "| %s%s | %s |%s" % (v, m.group(1) or "", proto, m.group(3)); break
else:
    sep = next(i for i, l in enumerate(lines) if re.match(r"^\|\s*-+\s*\|", l))
    lines.insert(sep + 1, "| %s (unreleased) | %s | Pending release notes. |" % (v, proto))
open(p, "w").write("\n".join(lines))

# CHANGELOG.md: make sure a heading for this version exists
p = root + "/CHANGELOG.md"
t = open(p).read()
if not re.search(r"^## " + re.escape(v) + r" - ", t, re.M):
    t = t.replace("# Changelog\n", "# Changelog\n\n## %s - unreleased\n- Pending release notes.\n" % v, 1)
    open(p, "w").write(t)
PY
echo "version set to $V, protocol $PROTO"
echo "updated: VERSION, template/engine/VERSION, template/engine/release.json, COMPATIBILITY.md row, CHANGELOG.md heading"
echo "now: write the real CHANGELOG notes and COMPATIBILITY.md notes; the dated heading is set at release-candidate time"
