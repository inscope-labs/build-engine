#!/usr/bin/env python3
"""plan_tool.py - the ONLY writer of plan state in a build-engine repo.

Layout (relative to the repo root, i.e. the parent of engine/):
  engine/            shared, plan-agnostic (this tool, schemas, prompts, templates)
  plans/<plan_id>/   one self-contained directory per plan

Commands:
  plans                                  list plans
  new <plan_id> [--number NNNNN] [--title T]  scaffold a plan (number from plans/counter.json by default)
  check <plan>                           validate everything (exit 1 on errors)
  render <plan> [--check]                (re)generate PLAN.md + CONCURRENCY.md / verify they are current
  next <plan> [--all] [--json]           tasks that may be ordered now      [read-only]
  order <plan> <ids..> [options]         build a TASK ORDER                 [writes only with --write/--start]
  set <plan> <task> <status> --by ...    the sanctioned status transition
  decide <plan> <D-nn> --by X --notes T  resolve a decision in the plan's decision register
  links <plan> <order-id>                re-print a work order with freshly signed gateway links
  verify <plan> <task|--suite> --target DIR   run verification commands
  coverage <plan> [--fail] [--target DIR]     spec-item coverage
  check-submission <plan> <submission_id>     mechanical gates G1/G2 on an uploaded submission

Exit codes: 0 success; 1 validation or operator error (message on stderr, or ERROR lines from check commands);
2 usage error (argument parser); 70 unexpected internal error (re-run with PLAN_DEBUG=1 for a traceback);
130 interrupted. State-changing commands hold a per-plan lock, write files atomically, and restore the files
they already wrote if a multi-file operation fails part-way.

Standard library only.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote
from datetime import datetime, timezone
from pathlib import Path

try:  # advisory locking is available on Linux, Termux and macOS
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

VERSION = "0.1.0"
STATUSES = ("planned", "in_progress", "pr_open", "done", "dropped", "superseded")
STARTED = ("in_progress", "pr_open", "done")
DEAD = ("dropped", "superseded")
TRANSITIONS = {
    ("planned", "in_progress"),
    ("in_progress", "planned"),
    ("in_progress", "pr_open"),
    ("in_progress", "done"),  # operator-executor tasks that ship no code
    ("pr_open", "done"),
    ("pr_open", "planned"),
}
SECRET_RE = re.compile(
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}"
)
# Files the supervisor/operator tooling adds to a submission folder after upload.
IGNORED_IN_SUBMISSION = {"MANIFEST.sha256", "UPLOAD.json", "EXIT-REPORT.md", "RECONCILE.json", "PR-BODY.md"}
ORDER_BEGIN = "=== WORK ORDER BEGIN ==="
ORDER_END = "=== WORK ORDER END ==="
ID_RE = re.compile(r"([0-9]{5})-([1-9][0-9]*)-([0-9]{3})-([0-9]{2})")
PLAN_ID_RE = re.compile(r"[a-z0-9][a-z0-9-]*")
SID_RE = re.compile(r"[0-9]{5}-S[0-9]{3,}")
SHA_RE = re.compile(r"[0-9a-f]{40}")

ROOT = Path(os.environ.get("PLAN_ROOT") or Path(__file__).resolve().parents[2])


class ToolError(Exception):
    pass


# ----------------------------------------------------------------- helpers
def now():
    return os.environ.get("PLAN_NOW") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ToolError("missing file: %s" % path)
    except json.JSONDecodeError as e:
        raise ToolError("invalid JSON in %s: %s" % (path, e))


def write_text_atomic(path, text):
    """Write a file so that readers (and an interrupted run) see either the old or the new content, never a mix."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        if path.exists():
            os.chmod(tmp, path.stat().st_mode & 0o7777)
        else:
            um = os.umask(0)
            os.umask(um)
            os.chmod(tmp, 0o666 & ~um)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def write_json(path, obj):
    write_text_atomic(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


@contextlib.contextmanager
def plan_lock(name):
    """One writer at a time per plan on this machine. The lock dies with the process, so it can never go stale."""
    if fcntl is None:  # pragma: no cover
        yield
        return
    key = hashlib.sha256(str((ROOT / "plans" / name).resolve()).encode()).hexdigest()[:16]
    fh = open(os.path.join(tempfile.gettempdir(), "plan_tool-%s.lock" % key), "a+")
    try:
        deadline = time.monotonic() + float(os.environ.get("PLAN_LOCK_TIMEOUT", "15"))
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise ToolError("another plan_tool process is still writing %s; wait for it to finish and retry" % name)
                time.sleep(0.05)
        yield
    finally:
        fh.close()


class Txn:
    """Group file writes. If anything fails part-way, rollback() restores every file already written."""

    def __init__(self):
        self.undo = []

    def _remember(self, path):
        p = Path(path)
        self.undo.append((p, p.read_bytes() if p.exists() else None))

    def write_text(self, path, text):
        self._remember(path)
        write_text_atomic(path, text)

    def write_json(self, path, obj):
        self.write_text(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

    def create_new(self, path, text):
        """Create a file that must not exist yet; refuse to overwrite (another run may have claimed the name)."""
        p = Path(path)
        fd, tmp = tempfile.mkstemp(prefix="." + p.name + ".", suffix=".tmp", dir=str(p.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
                fh.flush()
                os.fsync(fh.fileno())
            um = os.umask(0)
            os.umask(um)
            os.chmod(tmp, 0o666 & ~um)
            try:
                os.link(tmp, p)  # atomic, fails if the name exists
            except FileExistsError:
                raise ToolError("refusing to overwrite existing %s" % p.name)
            except OSError:  # filesystem without hard links: fall back to exclusive create
                try:
                    fd2 = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
                except FileExistsError:
                    raise ToolError("refusing to overwrite existing %s" % p.name)
                with os.fdopen(fd2, "w", encoding="utf-8", newline="") as fh2:
                    fh2.write(text)
            self.undo.append((p, None))
        finally:
            with contextlib.suppress(OSError):
                os.unlink(tmp)

    def rollback(self):
        for p, old in reversed(self.undo):
            try:
                if old is None:
                    p.unlink()
                else:
                    fd, tmp = tempfile.mkstemp(prefix="." + p.name + ".", suffix=".tmp", dir=str(p.parent))
                    with os.fdopen(fd, "wb") as fh:
                        fh.write(old)
                    os.replace(tmp, p)
            except OSError:
                pass


def read_json_object(path, what):
    v = read_json(path)
    if not isinstance(v, dict):
        raise ToolError("%s must be a JSON object: %s" % (what, path))
    return v


def engine_cfg():
    return read_json(ROOT / "engine" / "engine.json")


def load_schema(name):
    return read_json(ROOT / "engine" / "schemas" / ("%s.schema.json" % name))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_id(tid):
    """PLAN(5)-PHASE(n)-TASK(3)-SUB(2); the stage is the hundreds digit of TASK."""
    m = ID_RE.fullmatch(tid) if isinstance(tid, str) else None
    return (m.group(1), m.group(2), int(m.group(3)), int(m.group(4))) if m else None


def base_of(tid):
    return tid.rsplit("-", 1)[0]


def safe_rel(p):
    """Reject absolute, Windows, null, empty, '.' or '..' path components (aligned with ctxlink.safe_path).
    Uses a raw split so that intermediate '.' components are rejected even though Path normalises them away."""
    if not isinstance(p, str) or not p or p.startswith("/") or "\\" in p or "\x00" in p:
        return False
    if re.match(r"^[A-Za-z]:", p):
        return False
    return all(part not in ("", ".", "..") for part in p.split("/"))


def guard_halt(pid=None):
    name = engine_cfg().get("halt_file", "HALT")
    candidates = [ROOT / name]
    if pid:
        candidates.append(ROOT / "plans" / pid / name)
    for p in candidates:
        if p.exists():
            raise ToolError("HALT marker present (%s) - refusing to write" % p.relative_to(ROOT))


# ----------------------------------------------------------------- mini JSON-schema validator
def _istype(v, t):
    if t == "string":
        return isinstance(v, str)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return isinstance(v, dict)
    if t == "null":
        return v is None
    return True


def validate(inst, sch, path="$"):
    """Supports: type, enum, pattern, minLength, minimum, minItems, items, required,
    properties, additionalProperties:false."""
    t = sch.get("type")
    if t:
        ts = t if isinstance(t, list) else [t]
        if not any(_istype(inst, x) for x in ts):
            return ["%s: expected %s, got %s" % (path, "/".join(ts), type(inst).__name__)]
    errs = []
    if "enum" in sch and inst not in sch["enum"]:
        errs.append("%s: %r not in %s" % (path, inst, sch["enum"]))
    if isinstance(inst, str):
        if "pattern" in sch and not re.search(sch["pattern"], inst):
            errs.append("%s: %r does not match %s" % (path, inst, sch["pattern"]))
        if len(inst) < sch.get("minLength", 0):
            errs.append("%s: shorter than %d" % (path, sch["minLength"]))
    if isinstance(inst, (int, float)) and not isinstance(inst, bool):
        if "minimum" in sch and inst < sch["minimum"]:
            errs.append("%s: %s < minimum %s" % (path, inst, sch["minimum"]))
    if isinstance(inst, list):
        if len(inst) < sch.get("minItems", 0):
            errs.append("%s: needs at least %d item(s)" % (path, sch["minItems"]))
        if "items" in sch:
            for i, x in enumerate(inst):
                errs += validate(x, sch["items"], "%s[%d]" % (path, i))
    if isinstance(inst, dict):
        for r in sch.get("required", []):
            if r not in inst:
                errs.append("%s: missing required '%s'" % (path, r))
        props = sch.get("properties", {})
        for k, v in inst.items():
            if k in props:
                errs += validate(v, props[k], "%s.%s" % (path, k))
            elif sch.get("additionalProperties") is False:
                errs.append("%s: unexpected property '%s'" % (path, k))
    return errs


# ----------------------------------------------------------------- plan model
class Plan:
    def __init__(self, pid):
        if not isinstance(pid, str) or not PLAN_ID_RE.fullmatch(pid):
            raise ToolError("bad plan id: %r" % pid)
        self.id = pid
        self.dir = ROOT / "plans" / pid
        if not self.dir.is_dir():
            raise ToolError("unknown plan: %s" % pid)
        self.meta = read_json_object(self.dir / "plan.json", "plan.json")
        sdata = read_json_object(self.dir / "stages.json", "stages.json")
        self.stages = sdata.get("stages", [])
        self.phases = sdata.get("phases", [])
        for what, val in (("stages", self.stages), ("phases", self.phases)):
            if not isinstance(val, list) or not all(isinstance(x, dict) for x in val):
                raise ToolError("stages.json: '%s' must be a list of objects" % what)
        self.tasks = {}
        self.task_files = {}
        self.load_errors = []
        tdir = self.dir / "tasks"
        if tdir.is_dir():
            for f in sorted(tdir.glob("*.json")):
                t = read_json(f)
                if not isinstance(t, dict):
                    raise ToolError("task file %s must be a JSON object" % f.name)
                tid = t.get("id", f.stem)
                if not isinstance(tid, str):
                    raise ToolError("task file %s: id must be a string" % f.name)
                if tid in self.tasks:
                    self.load_errors.append("duplicate task id %s in %s and %s" % (tid, self.task_files[tid].name, f.name))
                    continue
                self.tasks[tid] = t
                self.task_files[tid] = f
        ex = self.dir / "coverage_exempt.json"
        self.exempt = read_json_object(ex, "coverage_exempt.json") if ex.exists() else {"items": []}
        dj = self.dir / "decisions.json"
        self.decisions = read_json_object(dj, "decisions.json").get("decisions", []) if dj.exists() else []
        if not isinstance(self.decisions, list):
            raise ToolError("decisions.json: 'decisions' must be a list")

    def decision(self, did):
        for d in self.decisions:
            if isinstance(d, dict) and d.get("id") == did:
                return d
        return None

    def stage_ids(self):
        return [s.get("id") for s in self.stages]

    def task_path(self, tid):
        return self.task_files.get(tid) or (self.dir / "tasks" / ("%s.json" % tid))

    def save_task(self, tid, txn=None):
        (txn.write_json if txn else write_json)(self.task_path(tid), self.tasks[tid])


def stage_state(plan, sid):
    in_stage = [t for t in plan.tasks.values() if t.get("stage") == sid]
    if not in_stage:
        return "planned"
    live = [t for t in in_stage if t.get("status") not in DEAD]
    if not live or all(t["status"] == "done" for t in live):
        return "done"
    if any(t["status"] in STARTED for t in live):
        return "in_progress"
    return "planned"


def gate_blockers(plan, task):
    ids = plan.stage_ids()
    if task.get("stage") not in ids:
        return []
    idx = ids.index(task["stage"])
    return [s["id"] for s in plan.stages[:idx] if s.get("gate") and stage_state(plan, s["id"]) != "done"]


def dep_done(plan, ref, seen=None):
    seen = seen or set()
    if ref in seen:
        return False
    seen.add(ref)
    t = plan.tasks.get(ref)
    if t is None:
        return False
    st = t.get("status")
    if st in ("done", "dropped"):
        return True
    if st == "superseded":
        succ = t.get("superseded_by") or []
        return bool(succ) and all(dep_done(plan, x, seen) for x in succ)
    return False


def ineligible_reasons(plan, t, allow_started=False):
    reasons = []
    ok_status = ("planned", "in_progress") if allow_started else ("planned",)
    if t.get("status") not in ok_status:
        reasons.append("status is %s" % t.get("status"))
    for b in t.get("blocked_by", []):
        if b["type"] == "task":
            if not dep_done(plan, b["ref"]):
                reasons.append("waiting on task %s (must be merged/done)" % b["ref"])
        elif b["type"] == "decision" and plan.decision(b["ref"]) is not None:
            d = plan.decision(b["ref"])
            if d.get("status") != "resolved" and not b.get("resolved"):
                reasons.append("open decision %s: %s" % (d["id"], d.get("title", "")))
        elif not b.get("resolved"):
            reasons.append("open %s: %s" % (b["type"], b["ref"]))
    for g in gate_blockers(plan, t):
        reasons.append("gate stage %s not done" % g)
    return reasons


def find_cycles(tasks):
    graph = {
        tid: [b["ref"] for b in t.get("blocked_by", []) if b.get("type") == "task" and b.get("ref") in tasks]
        for tid, t in tasks.items()
    }
    state, cycles = {}, []

    def dfs(n, stack):
        state[n] = 1
        for m in graph[n]:
            if state.get(m) == 1:
                cycles.append(" -> ".join(stack + [n, m]))
            elif m not in state:
                dfs(m, stack + [n])
        state[n] = 2

    for n in sorted(graph):
        if n not in state:
            dfs(n, [])
    return cycles


# ----------------------------------------------------------------- check
def check_plan(plan):
    errs, warns = list(getattr(plan, "load_errors", [])), []
    cfg = engine_cfg()
    deny = cfg.get("deny_in_task_branches", [])
    meta_errs = ["plan.json " + e for e in validate(plan.meta, load_schema("plan"))]
    stage_errs = ["stages.json " + e for e in validate({"phases": plan.phases, "stages": plan.stages}, load_schema("stages"))]
    errs += meta_errs + stage_errs
    errs += ["coverage_exempt.json " + e for e in validate(plan.exempt, load_schema("coverage_exempt"))]
    if (plan.dir / "decisions.json").exists():
        derrs = ["decisions.json " + e for e in validate({"decisions": plan.decisions}, load_schema("decisions"))]
        errs += derrs
        if not derrs:  # the checks below assume schema-valid decisions
            dids = [d.get("id") for d in plan.decisions]
            if len(set(dids)) != len(dids):
                errs.append("decisions.json: duplicate decision ids")
            for d in plan.decisions:
                if d.get("status") == "resolved" and not (d.get("by") and d.get("resolution")):
                    errs.append("decision %s: resolved requires by and resolution" % d.get("id"))
    if meta_errs or stage_errs:
        # the checks below assume well-formed plan.json and stages.json; fix those first
        return errs, warns
    if plan.meta.get("plan_id") != plan.id:
        errs.append("plan.json plan_id %r != directory %r" % (plan.meta.get("plan_id"), plan.id))
    sids = plan.stage_ids()
    if len(set(sids)) != len(sids):
        errs.append("duplicate stage ids")
    def _key(x):
        try:
            a_, b_ = str(x).split("-")
            return (int(a_), int(b_))
        except ValueError:
            return (0, 0)
    if sids != sorted(sids, key=_key):
        errs.append("stages must be listed in ascending id order")
    pids = [p.get("id") for p in plan.phases]
    if len(set(pids)) != len(pids):
        errs.append("duplicate phase ids")
    for s_ in plan.stages:
        if str(s_.get("id", ""))[:1] not in pids:
            errs.append("stage %s: phase %s is not declared in phases" % (s_.get("id"), str(s_.get("id", ""))[:1]))
    pn = plan.meta.get("plan_number", "")
    for other in sorted((ROOT / "plans").iterdir()):
        if other.name != plan.id and (other / "plan.json").exists():
            try:
                if read_json(other / "plan.json").get("plan_number") == pn:
                    errs.append("plan_number %s is also used by plan %s" % (pn, other.name))
            except ToolError:
                pass
    roots = plan.meta.get("deliverable_roots", [])
    patterns = []
    for pat in plan.meta.get("deliverable_patterns", []):
        try:
            patterns.append(re.compile(pat))
        except re.error as e:
            errs.append("plan.json deliverable_patterns: bad regex %r (%s)" % (pat, e))
    tschema = load_schema("task")
    bad_tasks = set()
    for tid, t in sorted(plan.tasks.items()):
        pre = "task %s: " % tid
        terrs = validate(t, tschema)
        if terrs:
            errs += [pre + e for e in terrs]
            bad_tasks.add(tid)
            continue  # deeper checks assume a schema-valid task
        if plan.task_files[tid].stem != tid:
            errs.append(pre + "filename %s does not match id" % plan.task_files[tid].name)
        parsed = parse_id(tid)
        st = t.get("stage")
        if parsed:
            if parsed[0] != pn:
                errs.append(pre + "plan number %s != plan_number %s" % (parsed[0], pn))
            if st in sids:
                sp, ss = st.split("-")
                if parsed[1] != sp:
                    errs.append(pre + "phase digit %s does not match stage %s" % (parsed[1], st))
                if str(parsed[2] // 100) != ss:
                    errs.append(pre + "task number %03d does not belong to stage %s (hundreds digit)" % (parsed[2], st))
        if st not in sids:
            errs.append(pre + "unknown stage %r" % st)
        for key in ("deliverables", "companions"):
            for p in t.get(key, []):
                if not safe_rel(p):
                    errs.append(pre + "unsafe %s path %r" % (key[:-1], p))
                    continue
                if any(p.startswith(d) for d in deny):
                    errs.append(pre + "%s path %r is in a denied area" % (key[:-1], p))
                if roots and not any(p.startswith(r) for r in roots):
                    errs.append(pre + "%s path %r is outside deliverable_roots" % (key[:-1], p))
                if patterns and not any(rx.search(p) for rx in patterns):
                    errs.append(pre + "%s path %r does not match deliverable_patterns" % (key[:-1], p))
        for b in t.get("blocked_by", []):
            if b.get("type") == "task":
                if b.get("ref") == tid:
                    errs.append(pre + "blocked by itself")
                elif b.get("ref") not in plan.tasks:
                    errs.append(pre + "blocked_by unknown task %s" % b.get("ref"))
            elif b.get("type") == "decision" and plan.decisions and plan.decision(b.get("ref")) is None:
                errs.append(pre + "blocked_by unknown decision %s" % b.get("ref"))
        for item in t.get("context", []):
            if not safe_rel(item.get("path", "")):
                errs.append(pre + "context item needs a safe relative path")
        v = t.get("verify", {})
        if v.get("method") == "command" and not v.get("argv"):
            errs.append(pre + "verify.method=command needs argv")
        status = t.get("status")
        ev = t.get("evidence", {})
        if status == "pr_open" and not ev.get("commit"):
            errs.append(pre + "pr_open requires evidence.commit (the pushed task-branch head)")
        if status == "done" and not (ev.get("by") and (ev.get("merge_sha") or ev.get("notes"))):
            errs.append(pre + "done requires evidence.by and evidence.merge_sha (or notes for operator tasks)")
        if status == "done" and ev.get("merge_sha") and not ev.get("pr"):
            errs.append(pre + "done with merge_sha requires evidence.pr")
        if status == "superseded":
            succ = t.get("superseded_by") or []
            if not succ:
                errs.append(pre + "superseded requires superseded_by")
            for x in succ:
                if x not in plan.tasks:
                    errs.append(pre + "superseded_by unknown task %s" % x)
                elif plan.tasks[x].get("status") == "dropped":
                    errs.append(pre + "superseded_by points at dropped task %s" % x)
        if status in STARTED and gate_blockers(plan, t):
            errs.append(pre + "started while gate stage(s) %s not done" % ",".join(gate_blockers(plan, t)))
    good = {k: v for k, v in plan.tasks.items() if k not in bad_tasks}
    for c in find_cycles(good):
        errs.append("dependency cycle: %s" % c)
    seen = {}
    for tid, t in good.items():
        if t.get("status") in DEAD:
            continue
        for p in t.get("deliverables", []):
            seen.setdefault(p, []).append(tid)
    for p, ids in sorted(seen.items()):
        if len(ids) > 1:
            warns.append("deliverable %s claimed by several tasks: %s" % (p, ", ".join(sorted(ids))))
    for s_ in plan.stages:
        if not any(t.get("stage") == s_.get("id") for t in good.values()):
            warns.append("stage %s has no tasks" % s_.get("id"))
    return errs, warns


# ----------------------------------------------------------------- render
def _cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def render(plan):
    out = [
        "<!-- GENERATED by engine/tools/plan_tool.py render. DO NOT EDIT. -->",
        "# %s" % plan.meta.get("title", plan.id),
        "",
        "Plan `%s` - number `%s`. Task ids: `PLAN-PHASE-TASK-SUB` (stage = hundreds digit of TASK)." % (plan.id, plan.meta.get("plan_number", "")),
        "",
    ]
    counts = {s: 0 for s in STATUSES}
    for t in plan.tasks.values():
        counts[t.get("status", "planned")] = counts.get(t.get("status", "planned"), 0) + 1
    out.append("Totals: " + ", ".join("%s %d" % (s, counts[s]) for s in STATUSES))
    out.append("")
    if plan.phases:
        out += ["| Phase | Name | Stages | Tasks | Done |", "|---|---|---|---|---|"]
        for ph in plan.phases:
            sts = [s for s in plan.stages if str(s["id"]).startswith(ph["id"] + "-")]
            ts = [t for t in plan.tasks.values() if t.get("stage") in {s["id"] for s in sts} and t.get("status") not in DEAD]
            out.append("| %s | %s | %s | %d | %d |" % (
                ph["id"], _cell(ph.get("name", "")), ", ".join(s["id"] for s in sts), len(ts),
                sum(1 for t in ts if t["status"] == "done")))
        out.append("")
    open_d = [d for d in plan.decisions if d.get("status") != "resolved"]
    if plan.decisions:
        out += ["Decisions: %d resolved, %d open" % (len(plan.decisions) - len(open_d), len(open_d)), ""]
        if open_d:
            out += ["| Decision | Open question |", "|---|---|"]
            out += ["| %s | %s |" % (d["id"], _cell(d.get("title", ""))) for d in open_d]
            out.append("")
    for s in plan.stages:
        gate = " (gate)" if s.get("gate") else ""
        out.append("## %s - %s [phase %s]%s - %s" % (s["id"], s.get("name", ""), str(s["id"])[:1], gate, stage_state(plan, s["id"])))
        if s.get("goal"):
            out += ["", s["goal"]]
        out.append("")
        tasks = sorted((t for t in plan.tasks.values() if t.get("stage") == s["id"]), key=lambda t: t["id"])
        if not tasks:
            out += ["_No tasks._", ""]
            continue
        out += ["| Task | Title | Executor | Status | Blocked by | PR |", "|---|---|---|---|---|---|"]
        for t in tasks:
            bl = ", ".join(
                b["ref"] if b["type"] == "task" else "%s:%s%s" % (b["type"], b["ref"], "" if not b.get("resolved") else " (resolved)")
                for b in t.get("blocked_by", [])
            )
            pr = t.get("evidence", {}).get("pr")
            out.append(
                "| %s | %s | %s | %s | %s | %s |"
                % (t["id"], _cell(t.get("title", "")), t.get("executor", ""), t.get("status", ""), _cell(bl), "#%s" % pr if pr else "")
            )
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def writes(t):
    return set(t.get("deliverables", []) + t.get("companions", []))


def conflict_between(a, b):
    """Two tasks conflict when one writes a file the other writes or reads."""
    wa, wb = writes(a), writes(b)
    ra = {c["path"] for c in a.get("context", [])}
    rb = {c["path"] for c in b.get("context", [])}
    return sorted(wa & wb | wa & rb | wb & ra)


def short(tid):
    return "-".join(tid.split("-")[-2:])  # TASK-SUB (plan and phase are constant inside a stage)


def concurrency(plan):
    """Per stage: waves of tasks that may run concurrently, plus conflicts and open blockers."""
    out = [
        "<!-- GENERATED by engine/tools/plan_tool.py render. DO NOT EDIT. -->",
        "# Concurrency matrix - %s" % plan.meta.get("title", plan.id),
        "",
        "Concurrency is derived automatically from dependencies and file use; nothing is declared by hand.",
        "Tasks in the same wave have no dependency on each other and may be worked at the same time.",
        "A later wave starts when the earlier wave's tasks they depend on are done (merged). A *conflict* means",
        "two tasks in a wave write the same file or one writes a file the other reads; run those one after the other.",
        "Stages run in order; a gate stage must be done before any later stage starts.",
        "",
    ]
    for s in plan.stages:
        ts = {t["id"]: t for t in plan.tasks.values() if t.get("stage") == s["id"] and t.get("status") not in DEAD}
        if not ts:
            continue
        level = {}

        def lv(tid, seen=()):
            if tid in level:
                return level[tid]
            deps = [b["ref"] for b in ts[tid].get("blocked_by", []) if b["type"] == "task" and b["ref"] in ts and b["ref"] not in seen]
            level[tid] = 0 if not deps else 1 + max(lv(d, seen + (tid,)) for d in deps)
            return level[tid]

        waves = {}
        for tid in sorted(ts):
            waves.setdefault(lv(tid), []).append(tid)
        out += ["## %s - %s" % (s["id"], s.get("name", "")), "", "| Wave | Concurrent tasks | Notes |", "|---|---|---|"]
        for w in sorted(waves):
            ids = waves[w]
            notes = []
            for i, a in enumerate(ids):
                for b in ids[i + 1:]:
                    if conflict_between(ts[a], ts[b]):
                        notes.append("conflict %s / %s" % (a, b))
            for tid in ids:
                for b in ts[tid].get("blocked_by", []):
                    if b["type"] in ("decision", "item"):
                        d = plan.decision(b["ref"]) if b["type"] == "decision" else None
                        if not (b.get("resolved") or (d and d.get("status") == "resolved")):
                            notes.append("%s waits on %s" % (tid, b["ref"]))
            out.append("| %d | %s | %s |" % (w, ", ".join(ids), _cell("; ".join(notes))))
        out.append("")
        order_ids = sorted(ts)
        if len(order_ids) > 1:
            out += ["Dependency matrix (row depends on column: `D`; same-file conflict: `X`; ids shown as TASK-SUB):", "",
                    "| | " + " | ".join(short(c) for c in order_ids) + " |", "|---|" + "---|" * len(order_ids)]
            for r in order_ids:
                cells = []
                for c in order_ids:
                    deps = {b["ref"] for b in ts[r].get("blocked_by", []) if b["type"] == "task"}
                    cells.append("D" if c in deps else ("X" if r != c and conflict_between(ts[r], ts[c]) else ""))
                out.append("| %s | %s |" % (short(r), " | ".join(cells)))
            out.append("")
    return "\n".join(out).rstrip() + "\n"


def write_generated(plan, txn=None):
    w = txn.write_text if txn else write_text_atomic
    w(plan.dir / "PLAN.md", render(plan))
    w(plan.dir / "CONCURRENCY.md", concurrency(plan))


def generated_current(plan):
    for name, text in (("PLAN.md", render(plan)), ("CONCURRENCY.md", concurrency(plan))):
        f = plan.dir / name
        if not f.exists() or f.read_text(encoding="utf-8") != text:
            return False, name
    return True, ""


# ----------------------------------------------------------------- transitions
def apply_transition(plan, tid, to, by, pr=None, commit=None, merge_sha=None, notes=None):
    t = plan.tasks.get(tid)
    if t is None:
        raise ToolError("unknown task: %s" % tid)
    frm = t["status"]
    if (frm, to) not in TRANSITIONS:
        raise ToolError("transition %s -> %s is not allowed (structural changes are operator edits)" % (frm, to))
    if not by:
        raise ToolError("--by is required")
    if (frm, to) == ("in_progress", "done") and t.get("executor") != "operator":
        raise ToolError("in_progress -> done is only for operator-executor tasks; worker tasks go through pr_open")
    if frm == "planned" and to == "in_progress":
        reasons = ineligible_reasons(plan, t)
        if reasons:
            raise ToolError("%s cannot start: %s" % (tid, "; ".join(reasons)))
    ev = t.setdefault("evidence", {})
    if to == "pr_open":
        if not commit:
            raise ToolError("pr_open requires --commit (the pushed task-branch head)")
        ev["commit"] = commit
        if pr:
            ev["pr"] = int(pr)
    elif to == "done":
        if frm == "pr_open" and not merge_sha:
            raise ToolError("done requires --merge-sha")
        if frm == "pr_open" and not (pr or ev.get("pr")):
            raise ToolError("done requires --pr (the merged pull request number)")
        if pr:
            ev["pr"] = int(pr)
        if frm == "in_progress" and not notes:
            raise ToolError("operator done requires --notes (evidence summary)")
        if merge_sha:
            ev["merge_sha"] = merge_sha
    elif to == "planned" and frm != "planned":
        if not notes:
            raise ToolError("returning a task to planned requires --notes (reason)")
        for k in ("pr", "commit", "merge_sha"):
            ev.pop(k, None)
    ev["by"], ev["at"] = by, now()
    if notes:
        ev["notes"] = notes
    t["status"] = to
    t.setdefault("history", []).append({"from": frm, "to": to, "by": by, "at": now(), "notes": notes or ""})
    return frm


def commit_transition(plan, tid, *args, **kw):
    before = set(check_plan(plan)[0])
    snapshot = json.loads(json.dumps(plan.tasks[tid]))
    apply_transition(plan, tid, *args, **kw)
    after = set(check_plan(plan)[0])
    if after - before:
        plan.tasks[tid] = snapshot
        raise ToolError("change would introduce plan errors:\n  " + "\n  ".join(sorted(after - before)))
    plan.save_task(tid)


# ----------------------------------------------------------------- commands
def cmd_plans(a):
    base = ROOT / "plans"
    found = sorted(p.name for p in base.iterdir() if (p / "plan.json").exists()) if base.is_dir() else []
    if not found:
        print("(no plans)")
    bad = 0
    for pid in found:
        try:
            p = Plan(pid)
        except ToolError as e:  # one unreadable plan must not hide the others
            print("%s  (unreadable: %s)" % (pid, e))
            bad = 1
            continue
        done = sum(1 for t in p.tasks.values() if t.get("status") == "done")
        print("%s  tasks=%d done=%d  %s" % (pid, len(p.tasks), done, p.meta.get("title", "")))
    return bad


def counter_path():
    return ROOT / "plans" / "counter.json"


def next_plan_number():
    cp = counter_path()
    return "%05d" % read_json(cp)["next_plan_number"] if cp.exists() else "10001"


def bump_counter(number):
    cp = counter_path()
    cur = read_json(cp)["next_plan_number"] if cp.exists() else 10001
    nxt = max(cur, int(number) + 1)
    tmp = cp.with_suffix(".tmp")
    write_json(tmp, {"next_plan_number": nxt})
    os.replace(tmp, cp)  # atomic replace


def cmd_new(a):
    guard_halt()
    if not PLAN_ID_RE.fullmatch(a.plan):
        raise ToolError("plan_id must be lowercase letters, digits, dashes")
    with plan_lock("__new__"):
        number = a.number or next_plan_number()
        if not re.fullmatch(r"[0-9]{5}", number):
            raise ToolError("--number must be exactly 5 digits")
        for other in sorted((ROOT / "plans").iterdir()) if (ROOT / "plans").is_dir() else []:
            if (other / "plan.json").exists() and read_json(other / "plan.json").get("plan_number") == number:
                raise ToolError("plan number %s already used by plan %s" % (number, other.name))
        dest = ROOT / "plans" / a.plan
        if dest.exists():
            raise ToolError("plan already exists: %s" % a.plan)
        tpl = ROOT / "engine" / "templates" / "plan"
        title = a.title or a.plan
        (ROOT / "plans").mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".new-%s-" % a.plan, dir=str(ROOT / "plans")))
        moved = False
        try:
            for src in sorted(tpl.rglob("*")):
                rel = src.relative_to(tpl)
                tgt = stage / rel
                if src.is_dir():
                    tgt.mkdir(parents=True, exist_ok=True)
                    continue
                tgt.parent.mkdir(parents=True, exist_ok=True)
                text = src.read_text(encoding="utf-8")
                text = text.replace("{{PLAN_ID}}", a.plan).replace("{{PLAN_NUMBER}}", number).replace("{{TITLE}}", title)
                tgt.write_text(text, encoding="utf-8")
            for sub_ in ("orders", "submissions"):
                (stage / sub_).mkdir(exist_ok=True)
                (stage / sub_ / ".gitkeep").touch()
            os.rename(str(stage), str(dest))
            moved = True
            write_generated(Plan(a.plan))
            bump_counter(number)  # last, so a failure above never skips a plan number
        except BaseException:
            import shutil
            shutil.rmtree(str(dest if moved else stage), ignore_errors=True)
            raise
    print("created plans/%s (number %s)" % (a.plan, number))
    return 0


def cmd_check(a):
    plan = Plan(a.plan)
    errs, warns = check_plan(plan)
    for w in warns:
        print("WARN  " + w)
    for e in errs:
        print("ERROR " + e)
    print("%s: %d error(s), %d warning(s), %d task(s)" % (plan.id, len(errs), len(warns), len(plan.tasks)))
    return 1 if errs else 0


def cmd_render(a):
    plan = Plan(a.plan)
    _refuse_invalid(plan)
    if a.check:
        ok, which = generated_current(plan)
        if not ok:
            print("%s is out of date - run: plan_tool.py render %s" % (which, plan.id))
            return 1
        print("PLAN.md and CONCURRENCY.md are current")
        return 0
    guard_halt(plan.id)
    with plan_lock(plan.id):
        write_generated(plan)
    print("wrote plans/%s/PLAN.md and CONCURRENCY.md" % plan.id)
    return 0


def cmd_next(a):
    plan = Plan(a.plan)
    _refuse_invalid(plan)
    rows, blocked = [], []
    for tid, t in sorted(plan.tasks.items()):
        if t.get("status") != "planned":
            continue
        r = ineligible_reasons(plan, t)
        (blocked if r else rows).append((t, r))
    if a.json:
        print(json.dumps({"eligible": [t["id"] for t, _ in rows],
                          "blocked": {t["id"]: r for t, r in blocked}}, indent=2))
        return 0
    print("Eligible now:" if rows else "Nothing eligible.")
    for t, _ in rows:
        print("  %s  [%s]  %s" % (t["id"], t.get("executor"), t.get("title")))
    if a.all and blocked:
        print("Blocked:")
        for t, r in blocked:
            print("  %s  %s" % (t["id"], "; ".join(r)))
    return 0


def next_submission_id(plan):
    pn = plan.meta["plan_number"]
    rx = re.compile(r"^%s-S(\d+)$" % re.escape(pn))
    nums = [0]
    for d in ("orders", "submissions"):
        p = plan.dir / d
        if p.is_dir():
            for x in p.iterdir():
                m = rx.match(x.stem if x.is_file() else x.name)
                if m:
                    nums.append(int(m.group(1)))
    return "%s-S%03d" % (pn, max(nums) + 1)


def git_blob(target, ref, path):
    """Bytes of path as committed at ref in the checkout at target, or None. Never reads the working tree."""
    r = subprocess.run(["git", "-C", str(target), "cat-file", "blob", "%s:%s" % (ref, path)], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def context_urls(plan, items, env):
    """Context is delivered ONLY as URLs into the private context repository, pinned to a full commit id."""
    out = []
    for it in items:
        path, sha = it["path"], None
        if not safe_rel(path):
            raise ToolError("unsafe context path %r" % path)
        if it["source"] == "target":
            # target content as mirrored in the private repository's main branch (same commit ids as upstream after `cbridge sync`)
            url = "%s/%s/%s" % (env["target_base"].rstrip("/"), env["ref"], quote(path))
            if env["target"]:
                blob = git_blob(env["target"], env["ref"], path)
                if blob is None:
                    raise ToolError("target file not found at the pinned commit %s: %s" % (env["ref"][:12], path))
                sha = hashlib.sha256(blob).hexdigest()
        else:
            if not env["plan_ref"]:
                raise ToolError("context item %s is a plan file: pass --plan-ref <build-engine commit sha>" % path)
            url = "%s/%s/plans/%s/package/%s" % (env["plan_base"].rstrip("/"), env["plan_ref"], plan.id, quote(path))
        repo_path = path if it["source"] == "target" else "plans/%s/package/%s" % (plan.id, path)
        e = {"label": it.get("label") or path, "path": path, "url": url, "role": it.get("role", "read"),
             "ref": env["ref"] if it["source"] == "target" else env["plan_ref"], "repo_path": repo_path}
        if sha:
            e["sha256"] = sha
        out.append(e)
    return out


def with_gateway(order):
    """Add gateway URLs for agents that can only make HTTPS GET requests. Done at PRINT time only:
    signed links are secrets-in-practice and are never written into orders/<id>.json."""
    cx = engine_cfg().get("context", {})
    gw, tpl = cx.get("gateway") or {}, cx.get("gateway_template", "")
    if not (gw.get("base") or tpl):
        return order
    out = json.loads(json.dumps(order))
    secret = None
    if gw.get("base"):
        env_name = gw.get("secret_env", "CTXGATE_SECRET")
        secret = os.environ.get(env_name)
        if not secret:
            raise ToolError("context.gateway is configured: set %s (the signing secret, never stored in the repo)" % env_name)
        import ctxlink
        try:
            ttl = int(gw.get("ttl_seconds", 86400))
        except (TypeError, ValueError):
            ttl = 0
        if not 1 <= ttl <= ctxlink.MAX_TTL:
            raise ToolError("context.gateway.ttl_seconds must be an integer between 1 and %d (72 hours)" % ctxlink.MAX_TTL)
    for t in out["tasks"]:
        for c in t["context"]:
            if secret:
                try:
                    c["gateway_url"] = ctxlink.mint(gw["base"], secret.encode(), gw.get("kid", "k1"), out["submission_id"],
                                                    c["ref"], [c["repo_path"]], ttl)[0]
                except ValueError as e:
                    raise ToolError("cannot mint a gateway link for %s: %s" % (c["path"], e))
            else:
                c["gateway_url"] = tpl.replace("{url}", c["url"])
    return out


def open_orders(plan):
    out = []
    odir = plan.dir / "orders"
    for f in sorted(odir.glob("*.json")) if odir.is_dir() else []:
        o = read_json(f)
        if not isinstance(o, dict) or not isinstance(o.get("tasks", []), list):
            raise ToolError("order file %s is malformed (expected a JSON object with a task list)" % f.name)
        if any(isinstance(t, dict) and plan.tasks.get(t.get("id"), {}).get("status") == "in_progress" for t in o.get("tasks", [])):
            out.append(o)
    return out


def build_order(plan, ids, rework_of=None, target=None, ref=None, plan_ref=None):
    cfg = engine_cfg()
    lim = cfg.get("limits", {})
    if not ids:
        raise ToolError("give at least one task id")
    if len(ids) > lim.get("max_tasks_per_order", 5):
        raise ToolError("too many tasks (max %d)" % lim.get("max_tasks_per_order", 5))
    if len(set(ids)) != len(ids):
        raise ToolError("duplicate task ids")
    for tid in ids:
        t = plan.tasks.get(tid)
        if t is None:
            raise ToolError("unknown task: %s" % tid)
        if t.get("executor") != "worker":
            raise ToolError("%s is an operator-executor task and cannot be ordered" % tid)
        reasons = ineligible_reasons(plan, t, allow_started=bool(rework_of))
        if reasons:
            raise ToolError("%s is not orderable: %s" % (tid, "; ".join(reasons)))
    if rework_of:
        if not SID_RE.fullmatch(rework_of) or not (plan.dir / "orders" / ("%s.json" % rework_of)).exists():
            raise ToolError("no order named %s" % rework_of)
        mode = "rework"
    else:
        mode = "new"
        cap = plan.meta.get("max_open_orders") or lim.get("max_open_orders") or 0
        opened = open_orders(plan)
        if cap and len(opened) >= cap:
            raise ToolError("%d work order(s) already open (max_open_orders=%d)" % (len(opened), cap))
        for tid in ids:
            for other in plan.tasks.values():
                if other["id"] != tid and other.get("status") == "in_progress":
                    shared = conflict_between(plan.tasks[tid], other)
                    if shared:
                        raise ToolError("%s conflicts with in-progress task %s (shared: %s)" % (tid, other["id"], ", ".join(shared)))
    sid = next_submission_id(plan)
    cx = cfg.get("context", {})
    pin_help = "pass a full 40-hex commit id (40 lowercase hex characters); moving refs such as a branch name are not accepted (or pass --target to pin that checkout's HEAD)"
    if ref and not SHA_RE.fullmatch(ref):
        raise ToolError("--ref %r is not a pinned commit: %s" % (ref, pin_help))
    if plan_ref and not SHA_RE.fullmatch(plan_ref):
        raise ToolError("--plan-ref %r is not a pinned commit: %s" % (plan_ref, pin_help.split(" (or")[0]))
    if not ref and target:
        r = subprocess.run(["git", "-C", str(target), "rev-parse", "HEAD"], capture_output=True, text=True)
        if r.returncode != 0:
            raise ToolError("cannot read HEAD of --target (pass --ref explicitly)")
        ref = r.stdout.strip()
        if not SHA_RE.fullmatch(ref):
            raise ToolError("HEAD of --target is not a full commit id (is it a git checkout?)")
    if not ref:
        raise ToolError("context URLs must be pinned: pass --target <checkout of the private context repository> or --ref <full commit sha>")
    if not plan_ref:
        r = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
        plan_ref = r.stdout.strip() if r.returncode == 0 and SHA_RE.fullmatch(r.stdout.strip()) else ""
    env = {
        "target_base": cx.get("target_base") or "https://raw.githubusercontent.com/%s" % cfg["private_slug"],
        "plan_base": cx.get("plan_base") or "https://raw.githubusercontent.com/%s" % cfg["private_slug"],
        "gateway": cx.get("gateway_template", ""), "ref": ref, "plan_ref": plan_ref, "target": target,
    }
    prefix = cfg.get("branches", {}).get("task_prefix", "task-")
    tasks = []
    for tid in ids:
        t = plan.tasks[tid]
        items = list(t.get("context", []))
        have = {i["path"] for i in items}
        if target:  # a file the task replaces must be readable in its current form, as committed at the pinned ref
            for path in t["deliverables"] + t.get("companions", []):
                if path not in have and safe_rel(path) and git_blob(target, ref, path) is not None:
                    items.append({"source": "target", "path": path, "label": "CURRENT: %s" % path, "role": "edit"})
        entry = {
            "id": tid, "title": t["title"], "branch": "%s%s" % (prefix, tid), "task_dir": tid,
            "acceptance": t["acceptance"], "deliverables": t["deliverables"], "companions": t.get("companions", []),
            "spec_refs": t.get("spec_refs", []), "verify": t["verify"],
            "context": context_urls(plan, items, env),
        }
        if t.get("summary"):
            entry["summary"] = t["summary"]
        tasks.append(entry)
    rules = hashlib.sha256()
    for f in (ROOT / "engine" / "AGENTS.md", plan.dir / "AGENTS.md"):
        if f.exists():
            rules.update(f.read_bytes())
    order = {
        "kind": "TASK_ORDER", "order_version": 3, "plan_id": plan.id, "submission_id": sid, "mode": mode,
        "context_ref": ref, "context_ref_pinned": True,
        "plan_ref": plan_ref, "rules": plan.meta.get("order_rules", []),
        "upload_to": "plans/%s/submissions/%s/" % (plan.id, sid),
        "report_headings": cfg["report_headings"], "rules_sha256": rules.hexdigest(), "tasks": tasks,
    }
    if rework_of:
        order["rework_of"] = rework_of
    errs = validate(order, load_schema("order"))
    if errs:
        raise ToolError("internal: generated order is invalid: %s" % errs)
    return order


def order_text(o):
    L = ["WORK ORDER %s  (plan %s, %s)" % (o["submission_id"], o["plan_id"], o["mode"]), ""]
    L.append("All context is given as URLs into a private repository, pinned to commits (files: %s, plan files: %s)." % (o["context_ref"][:12], (o.get("plan_ref") or "n/a")[:12]))
    L.append("Authenticate with git or curl, or use the gateway links where given (plain HTTPS GET, no credentials, they expire), and read what you need.")
    if o.get("rules"):
        L += ["", "Rules:"] + ["- %s" % r for r in o["rules"]]
    for t in o["tasks"]:
        L += ["", "TASK %s - %s" % (t["id"], t["title"]), "Branch name: %s" % t["branch"]]
        if t.get("summary"):
            L.append(t["summary"])
        L += ["Acceptance criteria:"] + ["  %d. %s" % (i + 1, c) for i, c in enumerate(t["acceptance"])]
        L += ["Deliverables (exact final repository paths):"] + ["  - %s" % p for p in t["deliverables"]]
        if t["companions"]:
            L += ["Companions:"] + ["  - %s" % p for p in t["companions"]]
        L.append("Context URLs (edit = a file you must replace, read = background):")
        L += ["  - [%s] %s: %s%s" % (c["role"], c["label"], c["url"], ("  (gateway: %s)" % c["gateway_url"]) if c.get("gateway_url") else "") for c in t["context"]] or ["  (none)"]
        v = t["verify"]
        L.append("Verification: %s" % (" ".join(v["argv"]) if v["method"] == "command" else "manual - see acceptance criteria"))
    L += ["", "Deliver as: SUBMISSION.json, <task id>/REPORT.md (headings: %s) and <task id>/files/<deliverable path>." % ", ".join(o["report_headings"]),
          "Submission folder: %s" % o["upload_to"]]
    return "\n".join(L)


def _order_output(a, order):
    shown = with_gateway(order)  # signed links appear only in what is printed, never in the written order file
    print(json.dumps(shown, indent=2, ensure_ascii=False) if a.json else "%s\n%s\n%s" % (ORDER_BEGIN, order_text(shown), ORDER_END))


def _refuse_invalid(plan):
    errs, _ = check_plan(plan)
    if errs:
        raise ToolError("plan %s has %d error(s); fix them before ordering (plan_tool.py check %s). First: %s" % (plan.id, len(errs), plan.id, errs[0]))


def cmd_order(a):
    plan = Plan(a.plan)
    target = a.target or os.environ.get("PLAN_TARGET")
    if not (a.write or a.start):
        _refuse_invalid(plan)
        _order_output(a, build_order(plan, a.ids, a.rework_of, target, a.ref, a.plan_ref))
        return 0
    guard_halt(plan.id)
    with plan_lock(plan.id):
        plan = Plan(a.plan)  # reload: another run may have changed the plan before we got the lock
        _refuse_invalid(plan)
        order = build_order(plan, a.ids, a.rework_of, target, a.ref, a.plan_ref)
        txn = Txn()
        try:
            if a.write:
                (plan.dir / "orders").mkdir(exist_ok=True)
                txn.create_new(plan.dir / "orders" / ("%s.json" % order["submission_id"]), json.dumps(order, indent=2, ensure_ascii=False) + "\n")
            if a.start:
                starting = [t["id"] for t in order["tasks"] if plan.tasks[t["id"]]["status"] == "planned"]
                before = set(check_plan(plan)[0])
                for tid in starting:
                    apply_transition(plan, tid, "in_progress", "plan_tool")
                introduced = set(check_plan(plan)[0]) - before
                if introduced:
                    raise ToolError("starting these tasks would introduce plan errors:\n  " + "\n  ".join(sorted(introduced)))
                for tid in starting:
                    plan.save_task(tid, txn)
                write_generated(plan, txn)
        except BaseException:
            txn.rollback()
            raise
    _order_output(a, order)
    return 0


def cmd_links(a):
    """Re-print an existing work order with freshly minted links (links expire; the order does not change)."""
    plan = Plan(a.plan)
    if not SID_RE.fullmatch(a.order):
        raise ToolError("bad order id %r (expected NNNNN-SNNN)" % a.order)
    cx = engine_cfg().get("context", {})
    if not ((cx.get("gateway") or {}).get("base") or cx.get("gateway_template")):
        raise ToolError("no gateway configured in engine.json context.gateway")
    order = read_json(plan.dir / "orders" / ("%s.json" % a.order))
    oerrs = validate(order, load_schema("order")) if isinstance(order, dict) else ["not a JSON object"]
    if oerrs:
        raise ToolError("order %s is malformed: %s" % (a.order, oerrs[0]))
    _order_output(a, order)
    return 0


def cmd_set(a):
    guard_halt(a.plan)
    with plan_lock(a.plan):
        plan = Plan(a.plan)
        commit_transition(plan, a.task, a.status, a.by, pr=a.pr, commit=a.commit, merge_sha=a.merge_sha, notes=a.notes)
    print("%s -> %s" % (a.task, a.status))
    return 0


def cmd_decide(a):
    guard_halt(a.plan)
    with plan_lock(a.plan):
        plan = Plan(a.plan)
        d = plan.decision(a.decision)
        if d is None:
            raise ToolError("unknown decision: %s" % a.decision)
        if not a.by:
            raise ToolError("--by is required")
        if a.reopen:
            d["status"] = "open"
            for k in ("resolution", "by", "at"):
                d.pop(k, None)
        else:
            if not a.notes:
                raise ToolError("--notes (the resolution) is required")
            d["status"], d["resolution"], d["by"], d["at"] = "resolved", a.notes, a.by, now()
        txn = Txn()
        try:
            txn.write_json(plan.dir / "decisions.json", {"decisions": plan.decisions})
            write_generated(Plan(a.plan), txn)
        except BaseException:
            txn.rollback()
            raise
    print("%s -> %s" % (a.decision, d["status"]))
    return 0


def run_argv(argv, cwd, timeout):
    print("$ " + " ".join(argv))
    try:
        r = subprocess.run(argv, cwd=cwd, timeout=timeout, capture_output=True, text=True)
    except FileNotFoundError:
        print("command not found: %s" % argv[0])
        return 127
    except subprocess.TimeoutExpired:
        print("timed out after %ds" % timeout)
        return 124
    tail = (r.stdout + r.stderr).splitlines()[-20:]
    for line in tail:
        print("  " + line)
    return r.returncode


def cmd_verify(a):
    plan = Plan(a.plan)
    timeout = engine_cfg().get("limits", {}).get("verify_timeout_seconds", 900)
    target = a.target or os.environ.get("PLAN_TARGET")
    if not target or not Path(target).is_dir():
        raise ToolError("verify needs --target DIR (a checkout of the target repo)")
    if a.suite:
        cmds = plan.meta.get("verify", {}).get("commands", [])
        if not cmds:
            print("plan defines no suite commands")
            return 0
        rc = 0
        for argv in cmds:
            rc = run_argv(argv, target, timeout)
            if rc:
                print("FAIL (%d): %s" % (rc, " ".join(argv)))
                return 1
        print("suite OK")
        return 0
    if not a.task:
        raise ToolError("give a task id or --suite")
    t = plan.tasks.get(a.task)
    if t is None:
        raise ToolError("unknown task: %s" % a.task)
    v = t["verify"]
    if v["method"] == "manual":
        print("MANUAL verification: see acceptance criteria for %s" % a.task)
        return 0
    rc = run_argv(v["argv"], target, timeout)
    print("PASS" if rc == 0 else "FAIL (%d)" % rc)
    return 0 if rc == 0 else 1


def spec_inventory(plan, target):
    inv = plan.dir / "spec_items.json"
    if inv.exists():
        return set(read_json(inv).get("items", []))
    spec = plan.meta.get("spec", {})
    rx = spec.get("item_regex")
    if not (rx and target):
        raise ToolError("no spec_items.json and no (--target + spec.item_regex) to scan for spec items")
    root = Path(target) / spec.get("root", "")
    pat = re.compile(rx)
    items = set()
    for f in sorted(root.glob(spec.get("glob", "**/*.md"))):
        if f.is_file():
            for m in pat.finditer(f.read_text(encoding="utf-8", errors="replace")):
                items.add(m.group(1) if pat.groups else m.group(0))
    return items


def cmd_coverage(a):
    plan = Plan(a.plan)
    items = spec_inventory(plan, a.target or os.environ.get("PLAN_TARGET"))
    cited = set()
    for t in plan.tasks.values():
        if t.get("status") != "dropped":
            cited |= set(t.get("spec_refs", []))
    exempt = {e["id"]: e["reason"] for e in plan.exempt.get("items", [])}
    uncovered = sorted(items - cited - set(exempt))
    unknown = sorted(cited - items)
    stale = sorted(set(exempt) - items)
    print("spec items: %d, cited: %d, exempt: %d" % (len(items), len(items & cited), len(items & set(exempt))))
    for x in uncovered:
        print("UNCOVERED %s" % x)
    for x in unknown:
        print("UNKNOWN-REF %s (cited by a task but not in the spec)" % x)
    for x in stale:
        print("STALE-EXEMPT %s" % x)
    bad = bool(uncovered or unknown)
    print("coverage: %s" % ("FAIL" if bad else "OK"))
    return 1 if (bad and a.fail) else 0


def cmd_check_submission(a):
    plan = Plan(a.plan)
    if not SID_RE.fullmatch(a.submission):
        raise ToolError("bad submission id %r (expected NNNNN-SNNN)" % a.submission)
    cfg = engine_cfg()
    sdir = plan.dir / "submissions" / a.submission
    errs = []
    sj = read_json(sdir / "SUBMISSION.json")
    errs += validate(sj, load_schema("submission"))
    if not isinstance(sj, dict) or not isinstance(sj.get("tasks"), list) or not all(isinstance(x, dict) for x in sj["tasks"]):
        errs.append("SUBMISSION.json must be an object whose 'tasks' is a list of objects")
        for e in errs:
            print("ERROR " + e)
        print("submission %s: %d error(s)" % (a.submission, len(errs)))
        return 1
    if sj.get("submission_id") != a.submission:
        errs.append("SUBMISSION.json submission_id != folder name")
    if sj.get("plan_id") != plan.id:
        errs.append("SUBMISSION.json plan_id != %s" % plan.id)
    order = read_json(plan.dir / "orders" / ("%s.json" % a.submission))
    oerrs = validate(order, load_schema("order")) if isinstance(order, dict) else ["order file is not a JSON object"]
    if oerrs:
        for e in oerrs:
            print("ERROR order %s: %s" % (a.submission, e))
        print("submission %s: %d error(s)" % (a.submission, len(oerrs)))
        return 1
    otasks = {t["id"]: t for t in order["tasks"]}
    sids = [t.get("id") for t in sj.get("tasks", [])]
    for tid in sids:
        if tid not in otasks:
            errs.append("task %s is not in the order" % tid)
    for tid in otasks:
        if tid not in sids:
            errs.append("order task %s missing from SUBMISSION.json" % tid)
    max_file = cfg.get("limits", {}).get("max_file_bytes", 1000000)
    headings = cfg["report_headings"]
    for entry in sj.get("tasks", []):
        tid = entry.get("id")
        ot = otasks.get(tid)
        if not ot:
            continue
        pre = "task %s: " % tid
        tdir = sdir / ot["task_dir"]
        if entry.get("result") == "BLOCKED":
            if not entry.get("blocked_reason"):
                errs.append(pre + "BLOCKED requires blocked_reason")
            continue
        report = tdir / "REPORT.md"
        if not report.is_file():
            errs.append(pre + "REPORT.md missing")
        else:
            got = [l[3:].strip() for l in report.read_text(encoding="utf-8").splitlines() if l.startswith("## ")]
            if got != headings:
                errs.append(pre + "REPORT.md headings %s != required %s" % (got, headings))
        fdir = tdir / "files"
        actual = set()
        if fdir.is_dir():
            for f in sorted(fdir.rglob("*")):
                if f.is_symlink():
                    errs.append(pre + "symlink not allowed: %s" % f.relative_to(fdir))
                elif f.is_file():
                    rel = f.relative_to(fdir).as_posix()
                    actual.add(rel)
                    if f.stat().st_size > max_file:
                        errs.append(pre + "file too large: %s" % rel)
                    try:
                        txt = f.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        errs.append(pre + "not valid UTF-8: %s" % rel)
                        continue
                    if SECRET_RE.search(txt):
                        errs.append(pre + "secret pattern in %s" % rel)
        expected = set(ot["deliverables"]) | set(ot["companions"])
        for x in sorted(expected - actual):
            errs.append(pre + "missing file: %s" % x)
        for x in sorted(actual - expected):
            errs.append(pre + "unexpected file: %s" % x)
        if entry.get("files") is not None and (not isinstance(entry["files"], list) or set(map(str, entry["files"])) != actual):
            errs.append(pre + "SUBMISSION.json files list does not match files/")
    up = sdir / "UPLOAD.json"
    if not up.exists():
        if not a.no_upload_record:
            errs.append("UPLOAD.json missing - upload with operator/cbridge")
    else:
        rec = read_json(up)
        man = sdir / "MANIFEST.sha256"
        if not man.exists():
            errs.append("MANIFEST.sha256 missing")
        else:
            if sha256_file(man) != rec.get("manifest_sha256"):
                errs.append("MANIFEST.sha256 does not match UPLOAD.json")
            listed = {}
            for line in man.read_text(encoding="utf-8").splitlines():
                m = re.match(r"^([0-9a-f]{64})  \./(.+)$", line)
                if m:
                    listed[m.group(2)] = m.group(1)
            for f in sorted(sdir.rglob("*")):
                if f.is_file() and f.name not in IGNORED_IN_SUBMISSION:
                    rel = f.relative_to(sdir).as_posix()
                    if rel not in listed:
                        errs.append("file not in manifest: %s" % rel)
                    elif sha256_file(f) != listed[rel]:
                        errs.append("file changed since upload: %s" % rel)
            for rel in sorted(set(listed) - {p.relative_to(sdir).as_posix() for p in sdir.rglob("*") if p.is_file()}):
                errs.append("manifest file missing: %s" % rel)
        pf = ROOT / "engine" / "prompts" / "AGENT-WORKER-PROMPT.md"
        if pf.exists() and rec.get("prompt_sha") not in (sha256_file(pf), "unknown") and not a.allow_prompt_drift:
            errs.append("worker prompt changed since upload (use --allow-prompt-drift to accept)")
    for e in errs:
        print("ERROR " + e)
    print("submission %s: %d error(s)" % (a.submission, len(errs)))
    return 1 if errs else 0


# ----------------------------------------------------------------- CLI
def build_parser():
    p = argparse.ArgumentParser(prog="plan_tool.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", help="repo root (default: parent of engine/)")
    p.add_argument("--version", action="version", version=VERSION)
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("plans").set_defaults(fn=cmd_plans)
    s = sp.add_parser("new"); s.add_argument("plan"); s.add_argument("--number"); s.add_argument("--title"); s.set_defaults(fn=cmd_new)
    s = sp.add_parser("check"); s.add_argument("plan"); s.set_defaults(fn=cmd_check)
    s = sp.add_parser("render"); s.add_argument("plan"); s.add_argument("--check", action="store_true"); s.set_defaults(fn=cmd_render)
    s = sp.add_parser("next"); s.add_argument("plan"); s.add_argument("--all", action="store_true"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_next)
    s = sp.add_parser("order"); s.add_argument("plan"); s.add_argument("ids", nargs="+")
    s.add_argument("--rework-of", dest="rework_of"); s.add_argument("--target"); s.add_argument("--ref"); s.add_argument("--plan-ref", dest="plan_ref")
    s.add_argument("--write", action="store_true"); s.add_argument("--start", action="store_true"); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_order)
    s = sp.add_parser("set"); s.add_argument("plan"); s.add_argument("task"); s.add_argument("status", choices=STATUSES)
    s.add_argument("--by"); s.add_argument("--pr", type=int); s.add_argument("--commit"); s.add_argument("--merge-sha", dest="merge_sha"); s.add_argument("--notes")
    s.set_defaults(fn=cmd_set)
    s = sp.add_parser("links"); s.add_argument("plan"); s.add_argument("order"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_links)
    s = sp.add_parser("decide"); s.add_argument("plan"); s.add_argument("decision"); s.add_argument("--by"); s.add_argument("--notes"); s.add_argument("--reopen", action="store_true"); s.set_defaults(fn=cmd_decide)
    s = sp.add_parser("verify"); s.add_argument("plan"); s.add_argument("task", nargs="?"); s.add_argument("--suite", action="store_true"); s.add_argument("--target"); s.set_defaults(fn=cmd_verify)
    s = sp.add_parser("coverage"); s.add_argument("plan"); s.add_argument("--fail", action="store_true"); s.add_argument("--target"); s.set_defaults(fn=cmd_coverage)
    s = sp.add_parser("check-submission"); s.add_argument("plan"); s.add_argument("submission")
    s.add_argument("--allow-prompt-drift", action="store_true"); s.add_argument("--no-upload-record", action="store_true")
    s.set_defaults(fn=cmd_check_submission)
    return p


def main(argv=None):
    global ROOT
    args = build_parser().parse_args(argv)
    if args.root:
        ROOT = Path(args.root).resolve()
    try:
        return args.fn(args)
    except ToolError as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("ERROR: interrupted", file=sys.stderr)
        return 130
    except Exception as e:  # noqa: BLE001 - anything unexpected must not surface as a raw traceback
        if os.environ.get("PLAN_DEBUG"):
            raise
        print("ERROR: unexpected %s: %s (run 'plan_tool.py check <plan>'; set PLAN_DEBUG=1 for a traceback)" % (type(e).__name__, e), file=sys.stderr)
        return 70


if __name__ == "__main__":
    sys.exit(main())
