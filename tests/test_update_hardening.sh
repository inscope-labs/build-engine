#!/usr/bin/env bash
# test_update_hardening.sh - Stage 2.4: install/update guarantees, adversarial inputs, and interruption recovery.
# Every case runs in a throwaway consumer repository against artifacts built from this source tree.
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
must_fail() { local name="$1" want="$2"; shift 2; local out rc; out="$("$@" 2>&1)"; rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then ok "$name"; else bad "$name (rc=$rc, wanted '$want', got: $(echo "$out" | tail -2 | tr '\n' ' '))"; fi; }
is() { local name="$1" want="$2" got="$3"; [[ "$got" == "$want" ]] && ok "$name" || bad "$name (wanted '$want', got '$got')"; }
tree() { (cd "$1" && find . -path ./.git -prune -o \( -type f -o -type l \) -print0 | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -c1-16); }
G=(git -c user.name=t -c user.email=t@example.invalid)

build() { # build NAME VERSION [shell mutation run inside the copy, before packaging]
  local name="$1" ver="$2"; shift 2
  rm -rf "$T/s_$name"; mkdir "$T/s_$name"
  (cd "$SRC" && tar --exclude=.git --exclude=dist --exclude=node_modules -cf - .) | tar -C "$T/s_$name" -xf -
  # since Stage 3.1 the artifact is built from the tracked file list: the copy is a git repository and every mutation is committed
  ( cd "$T/s_$name" && git init -q . && git config user.email t@example.invalid && git config user.name t && git add -A && git commit -qm baseline ) >/dev/null 2>&1
  ( cd "$T/s_$name" && release/set-version.sh "$ver" >/dev/null && eval "${*:-true}" && git add -A && git commit -qm mutation --allow-empty >/dev/null 2>&1 ) || { bad "build $name"; return 1; }
  "$T/s_$name/release/package.sh" "$T/r_$name" >/dev/null || { bad "package $name"; return 1; }
}
consumer() { local c="$T/c_$1"; rm -rf "$c"; mkdir -p "$c"; git -C "$c" init -q; "${G[@]}" -C "$c" commit -q --allow-empty -m init; echo "$c"; }
run() { # run CONSUMER RELEASE_DIR VERSION [update.sh args...]   (uses the consumer's own update.sh once installed)
  local c="$1" r="$2" v="$3"; shift 3
  local u="$c/engine/bin/update.sh"; [[ -f "$u" ]] || u="$UPD"
  (cd "$c" && bash "$u" --from-dir "$r" --version "$v" --repo OWNER/build-engine "$@")
}
commit() { (cd "$1" && git add -A && "${G[@]}" commit -q -m "${2:-snapshot}" --allow-empty); }
crafted() { # crafted OUTNAME VERSION LINES_EXPR [EXTRA_EXPR]
  rm -rf "$T/x_$1"; python3 "$SRC/tests/craft_artifact.py" "$T/r_a/build-engine-v0.5.0.tar.gz" "$T/x_$1" "$2" "${3:-lines}" "${4:-[]}" ; }

echo "building releases"
build a 0.5.0 || exit 1
UPD="$T/update.sh"; tar -xzf "$T/r_a/build-engine-v0.5.0.tar.gz" -O engine/bin/update.sh > "$UPD"
build b 0.5.1 'echo "# changed" >> template/docs/OVERVIEW.md; echo "# new" > template/docs/NEW.md; mkdir -p template/docs/sub; echo s > template/docs/sub/X.md; rm template/docs/TEMPLATE.md; echo "{}" > template/engine/extra.json; echo "seed    engine/extra.json" >> release/manifest.txt' || exit 1
build c 0.5.2 'rm -f template/docs/sub/X.md 2>/dev/null; echo "# changed again" >> template/docs/OVERVIEW.md' || exit 1
build d 0.5.3 'sed -i "/plans\/README.md/d" release/manifest.txt; rm template/plans/README.md' || exit 1

echo "2.4.1 first install into an empty repository"
C="$(consumer a1)"; run "$C" "$T/r_a" 0.5.0 >"$T/o" 2>&1 && ok "installs into an empty git repository" || bad "first install: $(tail -2 "$T/o")"
managed_n="$(grep -c '^managed' "$SRC/release/manifest.txt")"
check "lock records every managed file once" bash -c "[[ \$(grep -c '^file ' '$C/.build-engine.lock') -ge $managed_n ]] && [[ -z \$(grep '^file ' '$C/.build-engine.lock' | awk '{print \$3}' | sort | uniq -d) ]]"
check "seed config is created" test -f "$C/engine/engine.json"
check "nothing was committed or staged" bash -c "cd '$C' && [[ -z \$(git diff --cached --name-only) ]] && [[ \$(git rev-list --count HEAD) -eq 1 ]]"
C="$(consumer a2)"; mkdir -p "$C/sub/dir"
( cd "$C/sub/dir" && bash "$UPD" --from-dir "$T/r_a" --version 0.5.0 --repo OWNER/build-engine ) >/dev/null 2>&1; check "run from a subdirectory installs at the repository root" test -f "$C/engine/VERSION"
mkdir "$T/nogit"; must_fail "outside a git repository it refuses" "not inside a git repository" bash -c "cd '$T/nogit' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0"
( cd "$T/nogit" && bash "$UPD" --from-dir "$T/r_a" --version 0.5.0 --root "$T/nogit" ) >/dev/null 2>&1; check "--root installs into a non-git directory" test -f "$T/nogit/engine/VERSION"
C="$(consumer a3)"; before="$(tree "$C")"; must_fail "--dry-run on a first install reports" "dry run" bash -c "cd '$C' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0 --dry-run && exit 1"
is "...and creates nothing" "$before" "$(tree "$C")"
C="$(consumer a4)"; mkdir -p "$C/engine"; echo mine > "$C/engine/AGENTS.md"; before="$(tree "$C")"
must_fail "an unrecorded file at a managed path blocks first install" "was not installed by update.sh" run "$C" "$T/r_a" 0.5.0
is "...and nothing changed" "$before" "$(tree "$C")"

echo "2.4.2 / 2.4.6 update from the previous release"
C="$(consumer b1)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; mkdir -p "$C/plans/demo"; echo '{"mine":1}' > "$C/plans/demo/plan.json"; echo "my notes" > "$C/docs/mine.md"; echo "scratch" > "$C/stray.txt"
commit "$C" base; head0="$(git -C "$C" rev-parse HEAD)"; plans0="$(tree "$C/plans" 2>/dev/null)"
run "$C" "$T/r_b" 0.5.1 >"$T/o" 2>&1 && ok "update to the next release" || bad "update: $(tail -3 "$T/o")"
check "changed file updated, new file added, dropped file removed" bash -c "grep -q '# changed' '$C/docs/OVERVIEW.md' && test -f '$C/docs/NEW.md' && test ! -e '$C/docs/TEMPLATE.md'"
check "untracked consumer files survive" bash -c "test -f '$C/docs/mine.md' && test -f '$C/stray.txt'"
is "consumer-owned plan data is untouched" "$plans0" "$(tree "$C/plans" 2>/dev/null | head -c 16)"
check "no commit, no staging, no branch change" bash -c "cd '$C' && [[ \$(git rev-parse HEAD) == $head0 ]] && [[ -z \$(git diff --cached --name-only) ]] && [[ \$(git branch | wc -l) -eq 1 ]]"
check "lock moved to the new version" grep -q '^version=0.5.1$' "$C/.build-engine.lock"
before="$(tree "$C")"; run "$C" "$T/r_b" 0.5.1 >"$T/o" 2>&1; check "re-running the same version changes nothing" test "$(tree "$C")" = "$before"
rm "$C/docs/NEW.md"; run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1; check "a locally deleted managed file is restored" test -f "$C/docs/NEW.md"
C="$(consumer b2)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; echo "mine" > "$C/docs/NEW.md"
must_fail "a new managed file that already exists locally is a conflict" "was not installed by update.sh" run "$C" "$T/r_b" 0.5.1

echo "2.4.3 seed files"
C="$(consumer s1)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; echo '{"mine": true}' > "$C/engine/engine.json"; rm -f "$C/engine/extra.json"
run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1; check "an edited seed is never overwritten" grep -q '"mine": true' "$C/engine/engine.json"
check "a seed introduced by the new release is created when absent" test -f "$C/engine/extra.json"
echo '{"keep":1}' > "$C/engine/extra.json"; run "$C" "$T/r_c" 0.5.2 >/dev/null 2>&1; check "...and kept when present" grep -q '"keep":1' "$C/engine/extra.json"
rm -f "$C/engine/engine.json"; run "$C" "$T/r_c" 0.5.2 >/dev/null 2>&1; check "a deleted seed is re-created from the release" test -f "$C/engine/engine.json"

echo "2.4.4 conflicts leave nothing half-updated"
C="$(consumer k1)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; echo "local tweak" >> "$C/engine/AGENTS.md"; commit "$C" base; before="$(tree "$C")"
must_fail "a locally edited managed file blocks the whole update" "conflicts above" run "$C" "$T/r_b" 0.5.1
is "...no other file was updated, added or removed, and the lock is unchanged" "$before" "$(tree "$C")"
run "$C" "$T/r_b" 0.5.1 --force >/dev/null 2>&1; check "--force applies everything and replaces the edited file" bash -c "! grep -q 'local tweak' '$C/engine/AGENTS.md' && test -f '$C/docs/NEW.md' && grep -q '^version=0.5.1\$' '$C/.build-engine.lock'"
C="$(consumer k2)"; run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1; echo "edited" >> "$C/docs/NEW.md"; before="$(tree "$C")"
must_fail "a managed file the release drops, edited locally, is a conflict" "dropped by this release, but edited locally" run "$C" "$T/r_c" 0.5.2
C="$(consumer k3)"; run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1; run "$C" "$T/r_c" 0.5.2 >/dev/null 2>&1; check "an unmodified dropped file is removed, and the directory it alone filled" test ! -e "$C/docs/sub"
check "...but its parent directory with other files stays" test -d "$C/docs"
C="$(consumer k4)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; run "$C" "$T/r_d" 0.5.3 >/dev/null 2>&1; check "dropping plans/README.md never removes the consumer's plans/ directory" test -d "$C/plans"

echo "2.4.5 corrupt state, bad input, wrong versions"
C="$(consumer l1)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; cp "$C/.build-engine.lock" "$T/lock.good"; commit "$C" base
LK="$C/.build-engine.lock"; GOOD="$T/lock.good"
corrupt() { # corrupt NAME  (rewrites $LK from $GOOD)
  case "$1" in
    garbage) printf 'garbage\n' > "$LK" ;;
    binary) printf '\000\001\002' > "$LK" ;;
    truncated) head -c 70 "$GOOD" > "$LK" ;;
    "no version") grep -v '^version=' "$GOOD" > "$LK" ;;
    "bad hash") sed '0,/^file [0-9a-f]\{8\}/s//file zzzzzzzz/' "$GOOD" > "$LK" ;;
    "duplicate entry") { cat "$GOOD"; grep -m1 '^file ' "$GOOD"; } > "$LK" ;;
    "unsafe path") { cat "$GOOD"; echo "file $H64 ../../etc/x"; } > "$LK" ;;
  esac
}
H64="$(printf 'a%.0s' {1..64})"
for n in "garbage" "binary" "truncated" "no version" "bad hash" "duplicate entry" "unsafe path"; do
  corrupt "$n"; before="$(tree "$C")"
  must_fail "corrupt lock ($n) is refused with a clear message" "lock is corrupt" run "$C" "$T/r_b" 0.5.1
  is "...and nothing changed" "$before" "$(tree "$C")"
done
rm "$C/.build-engine.lock"; run "$C" "$T/r_b" 0.5.1 --force >/dev/null 2>&1 && ok "recovery: remove the lock and re-run with --force" || bad "recovery with --force failed"
check "...which rewrites a valid lock" grep -q '^version=0.5.1$' "$C/.build-engine.lock"
C="$(consumer l2)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; grep -v ' docs/OVERVIEW.md$' "$C/.build-engine.lock" > "$T/lk" && cp "$T/lk" "$C/.build-engine.lock"; echo x >> "$C/docs/OVERVIEW.md"
must_fail "a missing lock entry for a changed file is a conflict" "was not installed by update.sh" run "$C" "$T/r_b" 0.5.1
mkdir "$T/e1"; cp "$T/r_b"/*.tar.gz "$T/e1/"; must_fail "missing checksum file is refused" "not found" run "$(consumer m1)" "$T/e1" 0.5.1
mkdir "$T/e2"; cp "$T/r_b"/* "$T/e2/"; head -c 2000 "$T/r_b/build-engine-v0.5.1.tar.gz" > "$T/e2/build-engine-v0.5.1.tar.gz"; must_fail "truncated artifact is refused" "checksum mismatch" run "$(consumer m2)" "$T/e2" 0.5.1
mkdir "$T/e3"; cp "$T/r_b"/* "$T/e3/"; sed -i 's/build-engine-v0.5.1/other-name/' "$T/e3/build-engine-v0.5.1.tar.gz.sha256"; must_fail "checksum file naming another file is refused" "checksum mismatch" run "$(consumer m3)" "$T/e3" 0.5.1
must_fail "a version that was never released is refused" "not found" run "$(consumer m4)" "$T/r_a" 9.9.9
for bv in "1.2" "../x" "1.2.3;id" "v1.2.3.4" "latest"; do must_fail "bad --version '$bv' is refused" "bad" bash -c "cd '$(consumer m5)' && bash '$UPD' --from-dir '$T/r_a' --version '$bv' --repo OWNER/build-engine"; done
must_fail "an empty --version is refused" "needs a value" bash -c "cd '$(consumer m5)' && bash '$UPD' --from-dir '$T/r_a' --version ''"
crafted label 0.5.9 && must_fail "an artifact whose contents are another version is refused" "is version 0.5.0 but" run "$(consumer m6)" "$T/x_label" 0.5.9
for bad_repo in "--web" "a b" "../x" "a/b/c" ";id"; do must_fail "bad --repo '$bad_repo' is refused" "bad --repo" bash -c "cd '$(consumer m7)' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0 --repo '$bad_repo'"; done
C="$(consumer d1)"; run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1; before="$(tree "$C")"
must_fail "a downgrade is refused" "refusing to downgrade" run "$C" "$T/r_a" 0.5.0
is "...and nothing changed" "$before" "$(tree "$C")"
run "$C" "$T/r_a" 0.5.0 --allow-downgrade >/dev/null 2>&1 && check "--allow-downgrade permits it" grep -q '^version=0.5.0$' "$C/.build-engine.lock" || bad "--allow-downgrade failed"

echo "2.4.5 malformed manifests and hostile archives"
H64="$(printf 'a%.0s' {1..64})"
while IFS='|' read -r label expr extra want; do
  [[ -z "$label" ]] && continue; crafted "$label" 0.5.0 "$expr" "${extra:-[]}"; C="$(consumer h)"; before="$(tree "$C")"
  must_fail "manifest/archive: $label" "$want" run "$C" "$T/x_$label" 0.5.0; is "...nothing written" "$before" "$(tree "$C")"
done <<EOF2
bad mode|[l.replace(' managed ',' bogus ',1).replace(' seed ',' bogus ',1) if i==first else l for i,l in enumerate(lines)]||bad mode
short hash|[l[8:] if i==first else l for i,l in enumerate(lines)]||bad hash
uppercase hash|[l[:64].upper()+l[64:] if i==first else l for i,l in enumerate(lines)]||bad hash
duplicate path|lines+[lines[first]]||twice
parent traversal|lines+['$H64 managed ../evil']||unsafe path
dot component|lines+['$H64 managed a/./b']||unsafe path
absolute path|lines+['$H64 managed /etc/evil']||unsafe path
backslash path|lines+['$H64 managed a\\\\b']||unsafe path
empty manifest|[]||no files
listed but absent|lines+['$H64 managed docs/ghost.md']||does not match
extra file not listed|lines|[('docs/unlisted.md',b'x','file','')]|not in the release manifest
symlink entry|lines|[('docs/link',b'','symlink','/etc/passwd')]|non-regular
hardlink entry|lines|[('docs/hard',b'','hardlink','engine/VERSION')]|non-regular
directory entry|lines|[('docs/emptydir',b'','dir','')]|non-regular
absolute tar member|lines|[('/tmp/abs',b'x','file','')]|unsafe path
traversal tar member|lines|[('docs/../../up',b'x','file','')]|unsafe path
EOF2
crafted fold 0.5.0 "lines+['%s managed docs/fold-test.md' % hashlib.sha256(b'a').hexdigest(), '%s managed docs/FOLD-TEST.md' % hashlib.sha256(b'b').hexdigest()]" "[('docs/fold-test.md',b'a','file',''),('docs/FOLD-TEST.md',b'b','file','')]"
must_fail "the artifact has no manifest at all" "RELEASE-MANIFEST" bash -c "mkdir -p '$T/nm' && python3 - <<'PY'
import tarfile,io,gzip,hashlib
s=tarfile.open('$T/r_a/build-engine-v0.5.0.tar.gz'); b=io.BytesIO()
with gzip.GzipFile(fileobj=b,mode='wb',mtime=0) as g, tarfile.open(fileobj=g,mode='w') as o:
    for m in s.getmembers():
        if m.name!='engine/RELEASE-MANIFEST': o.addfile(m,s.extractfile(m))
open('$T/nm/build-engine-v0.5.0.tar.gz','wb').write(b.getvalue()); open('$T/nm/build-engine-v0.5.0.tar.gz.sha256','w').write(hashlib.sha256(b.getvalue()).hexdigest()+'  build-engine-v0.5.0.tar.gz\n')
PY
cd '$(consumer n1)' && bash '$UPD' --from-dir '$T/nm' --version 0.5.0"

echo "case-insensitive filesystems (test hook simulates one)"
C="$(consumer f1)"; before="$(tree "$C")"
must_fail "paths differing only by case are refused on a case-insensitive filesystem" "differ only by case" env BUILD_ENGINE_TEST_CASE_INSENSITIVE=1 bash -c "cd '$C' && bash '$UPD' --from-dir '$T/x_fold' --version 0.5.0"
is "...and nothing changed" "$before" "$(tree "$C")"
run "$C" "$T/x_fold" 0.5.0 >/dev/null 2>&1 && ok "the same release installs on a case-sensitive filesystem" || bad "case-sensitive install failed"
C="$(consumer f2)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1 && ok "the real release has no case-colliding paths, so it installs where case is ignored too" || bad "real release install failed"
check "...even on a (simulated) case-insensitive filesystem" bash -c "cd '$(consumer f3)' && BUILD_ENGINE_TEST_CASE_INSENSITIVE=1 bash '$UPD' --from-dir '$T/r_a' --version 0.5.0"

echo "symlinks and non-directories in the way"
C="$(consumer y1)"; mkdir -p "$T/outside"; rm -rf "$T/outside"/*; ln -s "$T/outside" "$C/docs"; before="$(tree "$C")"
must_fail "a managed directory that is a symlink is refused" "symlink" run "$C" "$T/r_a" 0.5.0
is "...and nothing was written outside the repository" "0" "$(find "$T/outside" -type f | wc -l)"
C="$(consumer y2)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; rm "$C/engine/AGENTS.md"; ln -s /etc/hostname "$C/engine/AGENTS.md"; before="$(tree "$C")"
must_fail "a managed file replaced by a symlink is refused, even with --force" "symlink" run "$C" "$T/r_a" 0.5.0 --force
C="$(consumer y3)"; mkdir -p "$C/docs"; echo blocker > "$C/docs/sub"; before="$(tree "$C")"
must_fail "a regular file where a directory is needed is refused before any change" "not a directory" run "$C" "$T/r_b" 0.5.1
C="$(consumer y4)"; mkdir -p "$C/docs/NEW.md"; before="$(tree "$C")"; must_fail "a directory where a file is needed is refused" "is a directory" run "$C" "$T/r_b" 0.5.1

echo "2.4.7 all-or-nothing: interruption and recovery"
ops=0
C="$(consumer t0)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base; ops=$(run "$C" "$T/r_b" 0.5.1 --dry-run 2>/dev/null | grep -cE '^  [+~-] ')
(( ops > 3 )) && ok "release b touches $ops files (enough to interrupt part-way)" || bad "unexpected change count: $ops"
for n in 1 $((ops/2)) $((ops-1)) $ops; do
  C="$(consumer t_f$n)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base; before="$(tree "$C")"
  BUILD_ENGINE_TEST_INTERRUPT="fail:$n" run "$C" "$T/r_b" 0.5.1 >"$T/o" 2>&1; rc=$?
  [[ $rc -ne 0 ]] && ok "interrupted after file $n/$ops: the run fails" || bad "interrupt:$n did not fail"
  is "...every file and the lock are restored" "$before" "$(tree "$C")"
  check "...no journal is left behind" test ! -e "$C/.build-engine.txn"
  run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1 && ok "...and a normal re-run then succeeds" || bad "re-run after rollback failed"
done
for n in 2 $((ops/2)) $((ops+1)); do
  C="$(consumer t_k$n)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base; before="$(tree "$C")"
  BUILD_ENGINE_TEST_INTERRUPT="kill:$n" run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1
  check "hard kill after step $n leaves a journal" test -d "$C/.build-engine.txn"
  must_fail "dry run refuses to proceed past an interrupted update" "interrupted" run "$C" "$T/r_b" 0.5.1 --dry-run
  run "$C" "$T/r_b" 0.5.1 >"$T/o" 2>&1 && ok "next run recovers and completes the update" || bad "recovery run failed: $(tail -3 "$T/o")"
  check "...recovery was reported" grep -q 'recovered from an interrupted update' "$T/o"
  check "...the update is complete and consistent" bash -c "grep -q '^version=0.5.1\$' '$C/.build-engine.lock' && test -f '$C/docs/NEW.md' && test ! -e '$C/.build-engine.txn'"
done
C="$(consumer t_c)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base
BUILD_ENGINE_TEST_INTERRUPT="kill:$((ops+2))" run "$C" "$T/r_b" 0.5.1 >/dev/null 2>&1
run "$C" "$T/r_b" 0.5.1 >"$T/o" 2>&1; check "a kill after the commit marker keeps the finished update" bash -c "grep -q '^version=0.5.1\$' '$C/.build-engine.lock' && test ! -e '$C/.build-engine.txn'"
C="$(consumer t_l)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base; mkdir "$C/.build-engine.txn"; sleep 300 & SP=$!; echo $SP > "$C/.build-engine.txn/pid"; echo applying > "$C/.build-engine.txn/state"
must_fail "a live update in progress blocks a second one" "another update" run "$C" "$T/r_b" 0.5.1; kill $SP 2>/dev/null
C="$(consumer t_p)"; run "$C" "$T/r_a" 0.5.0 >/dev/null 2>&1; commit "$C" base; before="$(tree "$C")"
for i in 1 2 3; do (run "$C" "$T/r_b" 0.5.1 >"$T/par$i.out" 2>&1 &) ; done; sleep 4
check "concurrent runs end in one consistent installed state" bash -c "grep -q '^version=0.5.1\$' '$C/.build-engine.lock' && test ! -e '$C/.build-engine.txn' && test -f '$C/docs/NEW.md'"

echo "preflight"
C="$(consumer p1)"; before="$(tree "$C")"
must_fail "bash 4.0 to 4.3 are refused too (empty arrays are unset under set -u)" "bash 4.4 or newer" env BUILD_ENGINE_TEST_BASH_MAJOR=4 bash -c "cd '$C' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0"
must_fail "bash older than 4.4 is refused with a clear message" "bash 4.4 or newer" env BUILD_ENGINE_TEST_BASH_MAJOR=3 bash -c "cd '$C' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0"
is "...and nothing changed" "$before" "$(tree "$C")"
mkdir "$T/pbin"; for t in bash git tar gzip find sort cut sed mktemp cp mv rm mkdir rmdir cmp tr kill cat head tail dirname basename ls wc grep awk readlink env sleep date ln ps; do p="$(command -v $t)" && ln -sf "$p" "$T/pbin/$t"; done
must_fail "a missing sha256sum is reported with an install hint" "sha256sum not found" env PATH="$T/pbin" bash -c "cd '$C' && bash '$UPD' --from-dir '$T/r_a' --version 0.5.0"
mkdir "$T/pbin2"; cp -P "$T"/pbin/* "$T/pbin2/"; ln -sf "$(command -v sha256sum)" "$T/pbin2/sha256sum"
must_fail "no source given and no gh: clear message" "gh not found" env PATH="$T/pbin2" bash -c "cd '$C' && bash '$UPD' --repo OWNER/build-engine --version 0.5.0"

echo "$PASS passed, $FAILN failed"; [[ $FAILN -eq 0 ]]
