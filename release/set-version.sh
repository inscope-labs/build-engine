#!/usr/bin/env bash
# set-version.sh X.Y.Z - update every place the version lives, so they cannot drift.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: set-version.sh X.Y.Z" >&2; exit 2; }
printf '%s\n' "$V" > "$ROOT/VERSION"
printf '%s\n' "$V" > "$ROOT/template/engine/VERSION"
python3 - "$ROOT/template/engine/ENGINE.json" "$V" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["engine_version"] = v
open(p, "w").write(json.dumps(d, indent=2) + "\n")
PY
echo "version set to $V (VERSION, template/engine/VERSION, template/engine/ENGINE.json)"
echo "now: add '## $V - YYYY-MM-DD' to CHANGELOG.md and record the protocol version in ENGINE.json + COMPATIBILITY.md"
