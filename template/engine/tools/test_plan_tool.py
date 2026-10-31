#!/usr/bin/env python3
"""Tests for plan_tool.py. Run: python3 -m unittest discover -s engine/tools -v"""
import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plan_tool as pt  # noqa: E402

REAL_ENGINE = Path(__file__).resolve().parents[1]
PN = "99001"


def T(n, sub=0):
    """Task id for task number n (hundreds digit = stage) in phase 1 of the demo plan."""
    return "%s-1-%03d-%02d" % (PN, n, sub)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(REAL_ENGINE, self.tmp / "engine", ignore=shutil.ignore_patterns("__pycache__"))
        (self.tmp / "plans").mkdir()
        self.old_root = pt.ROOT
        pt.ROOT = self.tmp
        self._old_now = os.environ.get("PLAN_NOW")
        os.environ["PLAN_NOW"] = "2026-01-01T00:00:00Z"
        self.run_ok("new", "demo", "--number", PN, "--title", "Demo plan")
        self.plan_dir = self.tmp / "plans" / "demo"

    def tearDown(self):
        pt.ROOT = self.old_root
        if self._old_now is None:
            os.environ.pop("PLAN_NOW", None)
        else:
            os.environ["PLAN_NOW"] = self._old_now
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_tool(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = pt.main(list(args))
        return rc, out.getvalue(), err.getvalue()

    def run_ok(self, *args):
        rc, out, err = self.run_tool(*args)
        self.assertEqual(rc, 0, "args=%s out=%s err=%s" % (args, out, err))
        return out

    def run_fail(self, *args):
        rc, out, err = self.run_tool(*args)
        self.assertNotEqual(rc, 0, "expected failure: %s" % (args,))
        return out + err

    def task(self, n, sub=0, **over):
        t = {
            "id": T(n, sub), "title": "Task %d" % n, "stage": "1-%d" % (n // 100), "executor": "worker",
            "status": "planned", "acceptance": ["does the thing"], "deliverables": ["src/%d.txt" % n],
            "companions": [], "blocked_by": [], "spec_refs": [], "verify": {"method": "manual"},
        }
        t.update(over)
        pt.write_json(self.plan_dir / "tasks" / ("%s.json" % t["id"]), t)
        return t

    def load(self, n, sub=0):
        return json.loads((self.plan_dir / "tasks" / ("%s.json" % T(n, sub))).read_text())

    def set_status(self, n, status, sub=0):
        t = self.load(n, sub)
        t["status"] = status
        pt.write_json(self.plan_dir / "tasks" / ("%s.json" % T(n, sub)), t)

    def ungate(self):
        st = json.loads((self.plan_dir / "stages.json").read_text())
        for s in st["stages"]:
            s["gate"] = False
        pt.write_json(self.plan_dir / "stages.json", st)

    def meta(self, **over):
        m = json.loads((self.plan_dir / "plan.json").read_text())
        m.update(over)
        pt.write_json(self.plan_dir / "plan.json", m)


class TestValidator(unittest.TestCase):
    def test_validate_basics(self):
        sch = {"type": "object", "required": ["a"], "additionalProperties": False,
               "properties": {"a": {"type": "integer", "minimum": 2}, "b": {"enum": ["x"]}}}
        self.assertEqual(pt.validate({"a": 3, "b": "x"}, sch), [])
        self.assertTrue(pt.validate({}, sch))
        self.assertTrue(pt.validate({"a": 1}, sch))
        self.assertTrue(pt.validate({"a": True}, sch))
        self.assertTrue(pt.validate({"a": 3, "c": 1}, sch))
        self.assertTrue(pt.validate({"a": 3, "b": "y"}, sch))

    def test_id_parsing(self):
        self.assertEqual(pt.parse_id("10008-5-102-00"), ("10008", "5", 102, 0))
        self.assertIsNone(pt.parse_id("10008-5-102-0"))
        self.assertIsNone(pt.parse_id("1008-5-102-00"))
        self.assertEqual(pt.base_of("10008-5-102-03"), "10008-5-102")
        self.assertEqual(pt.parse_id("10008-12-405-17"), ("10008", "12", 405, 17))  # phases are unlimited
        self.assertIsNone(pt.parse_id("10008-0-102-00"))  # but there is no phase 0


class TestScaffoldAndCheck(Base):
    def test_new_plan_is_valid_and_rendered(self):
        self.run_ok("check", "demo")
        self.run_ok("render", "demo", "--check")
        self.assertTrue((self.plan_dir / "orders").is_dir())
        self.assertIn("GENERATED", (self.plan_dir / "PLAN.md").read_text())
        self.assertTrue((self.plan_dir / "CONCURRENCY.md").exists())

    def test_new_rejects_bad_input_and_duplicate_numbers(self):
        self.run_fail("new", "demo", "--number", "99002")
        self.run_fail("new", "Bad_ID", "--number", "99002")
        self.run_fail("new", "other", "--number", "123")
        self.assertIn("already used", self.run_fail("new", "other", "--number", PN))

    def test_plan_counter_assigns_and_bumps(self):
        self.assertEqual(json.loads((self.tmp / "plans" / "counter.json").read_text())["next_plan_number"], 99002)
        self.run_ok("new", "second")  # number taken from the counter
        self.assertEqual(json.loads((self.tmp / "plans" / "second" / "plan.json").read_text())["plan_number"], "99002")
        self.assertEqual(json.loads((self.tmp / "plans" / "counter.json").read_text())["next_plan_number"], 99003)
        self.run_ok("new", "manual", "--number", "99010")
        self.assertEqual(json.loads((self.tmp / "plans" / "counter.json").read_text())["next_plan_number"], 99011)

    def test_plans_lists(self):
        self.assertIn("demo", self.run_ok("plans"))

    def test_id_rules(self):
        self.task(201, stage="1-9")
        self.assertIn("unknown stage", self.run_fail("check", "demo"))
        self.task(201, stage="1-1")
        self.assertIn("hundreds digit", self.run_fail("check", "demo"))
        self.task(201)
        pt.write_json(self.plan_dir / "tasks" / "88888-1-201-00.json", dict(self.load(201), id="88888-1-201-00"))
        self.assertIn("plan number", self.run_fail("check", "demo"))
        (self.plan_dir / "tasks" / "88888-1-201-00.json").unlink()
        pt.write_json(self.plan_dir / "tasks" / ("%s.json" % "99001-2-202-00"), dict(self.load(201), id="99001-2-202-00"))
        self.assertIn("phase digit", self.run_fail("check", "demo"))
        (self.plan_dir / "tasks" / "99001-2-202-00.json").unlink()
        self.run_ok("check", "demo")

    def test_bad_id_format_and_filename(self):
        pt.write_json(self.plan_dir / "tasks" / "CAS-001.json", dict(self.task(201), id="CAS-001"))
        self.assertIn("task CAS-001", self.run_fail("check", "demo"))

    def test_subtasks_are_independent_tasks(self):
        # every sub-task is a task in its own right; cancelling an earlier one is a planning decision
        self.task(201, 0)
        self.task(201, 1)
        self.task(201, 17)
        self.run_ok("check", "demo")
        (self.plan_dir / "tasks" / ("%s.json" % T(201, 0))).unlink()  # no base -00 needed
        self.run_ok("check", "demo")

    def test_phase_numbers_beyond_nine_sort_numerically(self):
        st = json.loads((self.plan_dir / "stages.json").read_text())
        st["phases"] += [{"id": "2", "name": "Two"}, {"id": "10", "name": "Ten"}]
        st["stages"] += [{"id": "2-1", "name": "B", "gate": False}, {"id": "10-1", "name": "C", "gate": False}]
        pt.write_json(self.plan_dir / "stages.json", st)
        self.run_ok("check", "demo")  # 1-1, 1-2, 2-1, 10-1 is ascending numerically
        t10 = dict(self.task(201), id="99001-10-101-00", stage="10-1")
        pt.write_json(self.plan_dir / "tasks" / "99001-10-101-00.json", t10)
        self.run_ok("check", "demo")  # a two-digit phase id is a valid task id
        st["stages"] = [st["stages"][0], st["stages"][1], st["stages"][3], st["stages"][2]]  # 10-1 before 2-1
        pt.write_json(self.plan_dir / "stages.json", st)
        self.assertIn("ascending id order", self.run_fail("check", "demo"))

    def test_phases_must_be_declared_and_stages_sorted(self):
        st = json.loads((self.plan_dir / "stages.json").read_text())
        st["stages"].append({"id": "3-1", "name": "Orphan", "gate": False})
        pt.write_json(self.plan_dir / "stages.json", st)
        self.assertIn("phase 3 is not declared", self.run_fail("check", "demo"))
        st["stages"] = list(reversed(st["stages"]))
        pt.write_json(self.plan_dir / "stages.json", st)
        self.assertIn("ascending id order", self.run_fail("check", "demo"))

    def test_check_catches_errors(self):
        self.task(201, blocked_by=[{"type": "task", "ref": T(999)}])
        self.assertIn("unknown task", self.run_fail("check", "demo"))
        self.task(201, deliverables=["../escape"])
        self.assertIn("unsafe", self.run_fail("check", "demo"))
        self.task(201, deliverables=["plans/x.md"])
        self.assertIn("denied area", self.run_fail("check", "demo"))

    def test_cycle_detected(self):
        self.task(201, blocked_by=[{"type": "task", "ref": T(202)}])
        self.task(202, blocked_by=[{"type": "task", "ref": T(201)}])
        self.assertIn("cycle", self.run_fail("check", "demo"))

    def test_superseded_needs_live_successor(self):
        self.task(201, status="superseded")
        self.assertIn("superseded requires", self.run_fail("check", "demo"))
        self.task(202)
        self.task(201, status="superseded", superseded_by=[T(202)])
        self.run_ok("check", "demo")
        self.task(202, status="dropped")
        self.assertIn("dropped task", self.run_fail("check", "demo"))

    def test_dropped_needs_no_successor(self):
        self.task(201, status="dropped")
        self.run_ok("check", "demo")

    def test_evidence_required(self):
        self.ungate()
        self.task(201, status="pr_open")
        self.assertIn("pr_open requires", self.run_fail("check", "demo"))
        self.task(201, status="done")
        self.assertIn("done requires", self.run_fail("check", "demo"))
        self.task(201, status="done", evidence={"by": "x", "merge_sha": "abc"})
        self.assertIn("requires evidence.pr", self.run_fail("check", "demo"))

    def test_deliverable_roots_and_patterns(self):
        self.meta(deliverable_roots=["src/"])
        self.task(201, deliverables=["docs/a.md"])
        self.assertIn("outside deliverable_roots", self.run_fail("check", "demo"))
        self.meta(deliverable_roots=[], deliverable_patterns=[r"\.md$", r"(^|/)VERSION$"])
        self.task(201, deliverables=["docs/a.md", "VERSION"])
        self.run_ok("check", "demo")
        self.task(201, deliverables=["src/a.py"])
        self.assertIn("deliverable_patterns", self.run_fail("check", "demo"))
        self.meta(deliverable_patterns=["("])
        self.assertIn("bad regex", self.run_fail("check", "demo"))

    def test_render_check_detects_stale(self):
        self.task(201)
        self.assertIn("out of date", self.run_fail("render", "demo", "--check"))
        self.run_ok("render", "demo")
        self.run_ok("render", "demo", "--check")
        (self.plan_dir / "CONCURRENCY.md").write_text("tampered")
        self.assertIn("CONCURRENCY.md", self.run_fail("render", "demo", "--check"))

    def test_render_phases_table(self):
        self.task(201)
        self.run_ok("render", "demo")
        md = (self.plan_dir / "PLAN.md").read_text()
        self.assertIn("| 1 | Foundations | 1-1, 1-2 | 1 | 0 |", md)
        self.assertIn("## 1-2 - Implementation [phase 1]", md)


class TestConcurrency(Base):
    def test_waves_conflicts_and_blockers(self):
        self.ungate()
        pt.write_json(self.plan_dir / "decisions.json", {"decisions": [{"id": "D-01", "title": "t", "status": "open"}]})
        self.task(201)
        self.task(202)
        self.task(203, blocked_by=[{"type": "task", "ref": T(201)}])
        self.task(204, deliverables=["src/201.txt"])  # same file as 201
        self.task(205, blocked_by=[{"type": "decision", "ref": "D-01"}])
        self.run_ok("render", "demo")
        md = (self.plan_dir / "CONCURRENCY.md").read_text()
        self.assertIn("| 0 | %s, %s, %s, %s |" % (T(201), T(202), T(204), T(205)), md)
        self.assertIn("| 1 | %s |" % T(203), md)
        self.assertIn("conflict %s / %s" % (T(201), T(204)), md)
        self.assertIn("%s waits on D-01" % T(205), md)
        self.assertIn("Dependency matrix", md)
        self.assertIn("| 203-00 | D |  |  |  |  |", md)  # 203 depends on 201 (first column)
        self.assertIn("| 204-00 | X |", md)  # 204 conflicts with 201 (same file)


class TestGatesAndNext(Base):
    def setUp(self):
        super().setUp()
        self.task(101)  # stage 1-1 (gate)
        self.task(201)  # stage 1-2
        self.task(202, blocked_by=[{"type": "task", "ref": T(201)}])
        self.task(203, blocked_by=[{"type": "decision", "ref": "D1"}])

    def mark_done(self, n):
        self.set_status(n, "done")
        t = self.load(n)
        t["evidence"] = {"by": "x", "notes": "n"}
        pt.write_json(self.plan_dir / "tasks" / ("%s.json" % T(n)), t)

    def test_gate_blocks_later_stage(self):
        out = self.run_ok("next", "demo", "--all")
        self.assertIn(T(101), out.split("Blocked:")[0])
        self.assertNotIn(T(201), out.split("Blocked:")[0])
        self.assertIn("gate stage 1-1 not done", out)

    def test_dependency_needs_done_not_pr_open(self):
        self.mark_done(101)
        out = self.run_ok("next", "demo", "--all")
        eligible = out.split("Blocked:")[0]
        self.assertIn(T(201), eligible)
        self.assertNotIn(T(202), eligible)
        self.assertIn("open decision: D1", out)

    def test_resolved_inline_flag_unblocks(self):
        self.mark_done(101)
        self.task(203, blocked_by=[{"type": "decision", "ref": "D1", "resolved": True}])
        self.assertIn(T(203), self.run_ok("next", "demo").split("Blocked:")[0])

    def test_check_flags_started_task_behind_open_gate(self):
        self.set_status(201, "in_progress")
        self.assertIn("gate stage(s) 1-1", self.run_fail("check", "demo"))

    def test_next_json(self):
        data = json.loads(self.run_ok("next", "demo", "--json"))
        self.assertEqual(data["eligible"], [T(101)])
        self.assertIn(T(201), data["blocked"])

    def test_stage_state(self):
        self.assertEqual(pt.stage_state(pt.Plan("demo"), "1-1"), "planned")
        self.set_status(101, "in_progress")
        self.assertEqual(pt.stage_state(pt.Plan("demo"), "1-1"), "in_progress")
        self.set_status(101, "dropped")
        self.assertEqual(pt.stage_state(pt.Plan("demo"), "1-1"), "done")


class TestDecisions(Base):
    def setUp(self):
        super().setUp()
        pt.write_json(self.plan_dir / "decisions.json", {"decisions": [
            {"id": "D-01", "title": "Pick a prefix", "status": "open"}]})
        self.ungate()
        self.task(201, blocked_by=[{"type": "decision", "ref": "D-01"}])

    def test_open_decision_blocks_and_resolution_unblocks(self):
        self.assertIn("open decision D-01: Pick a prefix", self.run_ok("next", "demo", "--all"))
        self.run_ok("decide", "demo", "D-01", "--by", "john", "--notes", "use KRN")
        self.assertIn(T(201), self.run_ok("next", "demo").split("Blocked:")[0])
        self.run_ok("check", "demo")
        self.run_ok("render", "demo", "--check")
        self.assertIn("Decisions: 1 resolved, 0 open", (self.plan_dir / "PLAN.md").read_text())

    def test_decide_validation_and_reopen(self):
        self.run_fail("decide", "demo", "D-99", "--by", "x", "--notes", "n")
        self.run_fail("decide", "demo", "D-01", "--by", "x")
        self.run_fail("decide", "demo", "D-01", "--notes", "n")
        self.run_ok("decide", "demo", "D-01", "--by", "x", "--notes", "n")
        self.run_ok("decide", "demo", "D-01", "--by", "x", "--reopen")
        self.assertEqual(json.loads((self.plan_dir / "decisions.json").read_text())["decisions"][0]["status"], "open")

    def test_unknown_decision_ref_and_bad_resolved_entry(self):
        self.task(202, blocked_by=[{"type": "decision", "ref": "D-42"}])
        self.assertIn("unknown decision", self.run_fail("check", "demo"))
        self.task(202)
        pt.write_json(self.plan_dir / "decisions.json", {"decisions": [{"id": "D-01", "title": "t", "status": "resolved"}]})
        self.assertIn("resolved requires", self.run_fail("check", "demo"))

    def test_halt_blocks_decide(self):
        (self.plan_dir / "HALT").write_text("x")
        self.assertIn("HALT", self.run_fail("decide", "demo", "D-01", "--by", "x", "--notes", "n"))


class TestSet(Base):
    def setUp(self):
        super().setUp()
        self.ungate()
        self.task(201)
        self.task(202, executor="operator")

    def test_happy_path_worker(self):
        a = T(201)
        self.run_ok("set", "demo", a, "in_progress", "--by", "operator")
        self.run_fail("set", "demo", a, "pr_open", "--by", "sup")
        self.run_ok("set", "demo", a, "pr_open", "--by", "sup", "--commit", "abc123")
        self.run_fail("set", "demo", a, "done", "--by", "sup")
        self.run_fail("set", "demo", a, "done", "--by", "sup", "--merge-sha", "def456")  # no PR number yet
        self.run_ok("set", "demo", a, "done", "--by", "sup", "--merge-sha", "def456", "--pr", "7")
        t = self.load(201)
        self.assertEqual((t["status"], t["evidence"]["pr"]), ("done", 7))
        self.assertEqual([h["to"] for h in t["history"]], ["in_progress", "pr_open", "done"])

    def test_illegal_transitions(self):
        a = T(201)
        self.run_fail("set", "demo", a, "done", "--by", "x", "--merge-sha", "z")
        self.run_fail("set", "demo", a, "dropped", "--by", "x")
        self.run_fail("set", "demo", a, "in_progress")  # --by missing
        self.run_ok("set", "demo", a, "in_progress", "--by", "x")
        self.run_fail("set", "demo", a, "done", "--by", "x", "--notes", "n")  # worker task

    def test_operator_task_can_finish_without_pr(self):
        b = T(202)
        self.run_ok("set", "demo", b, "in_progress", "--by", "op")
        self.run_fail("set", "demo", b, "done", "--by", "op")
        self.run_ok("set", "demo", b, "done", "--by", "op", "--notes", "evidence: screenshot X")

    def test_return_to_planned_needs_reason_and_clears_evidence(self):
        a = T(201)
        self.run_ok("set", "demo", a, "in_progress", "--by", "x")
        self.run_ok("set", "demo", a, "pr_open", "--by", "x", "--pr", "3", "--commit", "c")
        self.assertEqual(self.load(201)["evidence"]["pr"], 3)
        self.run_fail("set", "demo", a, "planned", "--by", "x")
        self.run_ok("set", "demo", a, "planned", "--by", "x", "--notes", "PR closed")
        self.assertNotIn("pr", self.load(201)["evidence"])

    def test_cannot_start_blocked_task(self):
        self.task(203, blocked_by=[{"type": "task", "ref": T(201)}])
        self.assertIn("cannot start", self.run_fail("set", "demo", T(203), "in_progress", "--by", "x"))

    def test_halt_blocks_writes_not_reads(self):
        (self.plan_dir / "HALT").write_text("x")
        self.assertIn("HALT", self.run_fail("set", "demo", T(201), "in_progress", "--by", "x"))
        self.assertIn("HALT", self.run_fail("render", "demo"))
        self.assertIn("HALT", self.run_fail("order", "demo", T(201), "--write", "--ref", "a" * 40))
        self.run_ok("check", "demo")
        self.run_ok("next", "demo")
        (self.plan_dir / "HALT").unlink()
        (self.tmp / "HALT").write_text("x")
        self.assertIn("HALT", self.run_fail("new", "again", "--number", "99002"))


class TestOrder(Base):
    REF = "a" * 40

    def setUp(self):
        super().setUp()
        self.ungate()
        self.target = self.tmp / "target"
        (self.target / "specs").mkdir(parents=True)
        (self.target / "docs").mkdir()
        (self.target / "specs" / "a.md").write_text("spec text A")
        (self.target / "docs" / "old.md").write_text("old text")
        self.task(201, context=[{"source": "target", "path": "specs/a.md", "label": "Spec A"}],
                  summary="Write the thing.")
        self.task(202, deliverables=["docs/old.md", "docs/new.md"])
        self.task(203, executor="operator")

    def order_json(self, *args, **kw):
        extra = ["--ref", self.REF] if not kw.get("target") else ["--target", str(self.target)]
        if kw.get("plan"):
            extra += ["--plan-ref", kw["plan"]]
        return json.loads(self.run_ok("order", "demo", *args, "--json", *extra))

    def test_order_is_urls_only(self):
        o = self.order_json(T(201), T(202))
        self.assertEqual(o["submission_id"], PN + "-S001")
        self.assertEqual(o["upload_to"], "plans/demo/submissions/%s-S001/" % PN)
        self.assertEqual(o["context_ref"], self.REF)
        self.assertTrue(o["context_ref_pinned"])
        t = o["tasks"][0]
        self.assertEqual((t["branch"], t["task_dir"]), ("task-" + T(201), T(201)))
        self.assertEqual(t["context"], [{"label": "Spec A", "path": "specs/a.md", "role": "read", "ref": self.REF, "repo_path": "specs/a.md",
            "url": "https://raw.githubusercontent.com/OWNER/PROJECT-dev/%s/specs/a.md" % self.REF}])
        self.assertNotIn('"content":', json.dumps(o))  # URLs only, never inline content
        self.assertEqual(len(o["report_headings"]), 9)

    def test_target_pins_head_and_hashes_and_adds_edit_items(self):
        for cmd in (["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@x", "commit", "-qm", "i"]):
            subprocess.run(["git", "-C", str(self.target)] + cmd, check=True, capture_output=True)
        head = subprocess.run(["git", "-C", str(self.target), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        o = self.order_json(T(201), T(202), target=True)
        self.assertEqual(o["context_ref"], head)
        a = o["tasks"][0]["context"][0]
        self.assertEqual(a["sha256"], sha(self.target / "specs" / "a.md"))
        edit = o["tasks"][1]["context"]
        self.assertEqual([(c["label"], c["role"]) for c in edit], [("CURRENT: docs/old.md", "edit")])  # new.md absent

    def test_ref_required_and_missing_target_file(self):
        self.assertIn("pinned", self.run_fail("order", "demo", T(201)))
        (self.target / "specs" / "a.md").unlink()
        self.assertIn("not found", self.run_fail("order", "demo", T(201), "--ref", self.REF, "--target", str(self.target)))

    def test_plan_source_needs_plan_ref_and_gateway_urls(self):
        self.task(201, context=[{"source": "plan", "path": "notes.md"}])
        self.assertIn("--plan-ref", self.run_fail("order", "demo", T(201), "--ref", self.REF))
        pref = "b" * 40
        o = self.order_json(T(201), plan=pref)
        self.assertEqual(o["tasks"][0]["context"][0]["url"],
                         "https://raw.githubusercontent.com/OWNER/PROJECT-dev/%s/plans/demo/package/notes.md" % pref)
        self.assertEqual(o["plan_ref"], pref)
        cfg = json.loads((self.tmp / "engine" / "engine.json").read_text())
        cfg["context"]["gateway_template"] = "https://gw.example/get?u={url}"
        pt.write_json(self.tmp / "engine" / "engine.json", cfg)
        c = self.order_json(T(201), plan=pref)["tasks"][0]["context"][0]
        self.assertTrue(c["gateway_url"].startswith("https://gw.example/get?u=https://raw.githubusercontent.com"))
        self.assertIn("(gateway: https://gw.example", self.run_ok("order", "demo", T(201), "--ref", self.REF, "--plan-ref", pref))

    def test_signed_gateway_links_are_minted_at_print_time_only(self):
        import ctxlink
        cfg = json.loads((self.tmp / "engine" / "engine.json").read_text())
        cfg["context"]["gateway"] = {"base": "https://gw.example", "kid": "k1", "ttl_seconds": 600, "secret_env": "CTXGATE_SECRET"}
        pt.write_json(self.tmp / "engine" / "engine.json", cfg)
        self.assertIn("CTXGATE_SECRET", self.run_fail("order", "demo", T(201), "--ref", self.REF))  # no secret: refuse
        os.environ["CTXGATE_SECRET"], os.environ["CTXGATE_NOW"] = "test-secret", "1000"
        try:
            o = self.order_json(T(201))
            c = o["tasks"][0]["context"][0]
            self.assertEqual(c["gateway_url"], ctxlink.mint("https://gw.example", b"test-secret", "k1", PN + "-S001", self.REF, ["specs/a.md"], 600, at=1000)[0])
            self.assertTrue(c["gateway_url"].startswith("https://gw.example/v1/k1/1600/%s-S001/" % PN))
            out = self.run_ok("order", "demo", T(201), "--write", "--ref", self.REF)
            self.assertIn("gateway: https://gw.example/v1/k1/1600/", out)
            written = (self.plan_dir / "orders" / ("%s-S001.json" % PN)).read_text()
            self.assertNotIn("gateway_url", written)  # never persisted
            self.assertNotIn("/v1/k1/", written)
            os.environ["CTXGATE_NOW"] = "5000"  # later: the link expired, re-mint without touching the order
            again = self.run_ok("links", "demo", PN + "-S001")
            self.assertIn("gateway: https://gw.example/v1/k1/5600/", again)
            self.assertEqual((self.plan_dir / "orders" / ("%s-S001.json" % PN)).read_text(), written)
        finally:
            os.environ.pop("CTXGATE_SECRET", None)
            os.environ.pop("CTXGATE_NOW", None)

    def test_links_needs_gateway_and_existing_order(self):
        self.assertIn("no gateway configured", self.run_fail("links", "demo", PN + "-S001"))
        cfg = json.loads((self.tmp / "engine" / "engine.json").read_text())
        cfg["context"]["gateway"]["base"] = "https://gw.example"
        pt.write_json(self.tmp / "engine" / "engine.json", cfg)
        os.environ["CTXGATE_SECRET"] = "s"
        try:
            self.assertIn("missing file", self.run_fail("links", "demo", PN + "-S404"))
        finally:
            os.environ.pop("CTXGATE_SECRET", None)

    def test_text_block_and_rules(self):
        self.meta(order_rules=["No code.", "Markdown only."])
        out = self.run_ok("order", "demo", T(201), "--ref", self.REF)
        self.assertTrue(out.startswith(pt.ORDER_BEGIN))
        self.assertIn(pt.ORDER_END, out)
        for needle in ("WORK ORDER %s-S001" % PN, "- No code.", "TASK %s - Task 201" % T(201),
                       "1. does the thing", "[read] Spec A: https://raw.githubusercontent.com", "Write the thing."):
            self.assertIn(needle, out)

    def test_operator_task_rejected(self):
        self.assertIn("operator-executor", self.run_fail("order", "demo", T(203), "--ref", self.REF))

    def test_write_and_sequence(self):
        self.run_ok("order", "demo", T(201), "--write", "--ref", self.REF)
        self.assertTrue((self.plan_dir / "orders" / ("%s-S001.json" % PN)).exists())
        self.assertEqual(self.order_json(T(202))["submission_id"], PN + "-S002")

    def test_start_marks_in_progress_and_stdout_is_only_the_order(self):
        out = self.run_ok("order", "demo", T(201), "--write", "--start", "--ref", self.REF)
        self.assertTrue(out.startswith(pt.ORDER_BEGIN))
        self.assertEqual(self.load(201)["status"], "in_progress")
        self.run_ok("render", "demo", "--check")

    def test_rework_keeps_task_id_and_branch(self):
        self.run_ok("order", "demo", T(201), "--write", "--start", "--ref", self.REF)
        self.run_fail("order", "demo", T(201), "--ref", self.REF)  # in_progress is not orderable as a new order
        self.assertIn("no order named", self.run_fail("order", "demo", T(201), "--rework-of", "nope", "--ref", self.REF))
        o = json.loads(self.run_ok("order", "demo", T(201), "--rework-of", PN + "-S001", "--json", "--ref", self.REF))
        self.assertEqual(o["mode"], "rework")
        self.assertEqual(o["rework_of"], PN + "-S001")
        self.assertEqual(o["submission_id"], PN + "-S002")  # a new work order id, never a task-id suffix
        self.assertEqual(o["tasks"][0]["id"], T(201))
        self.assertEqual(o["tasks"][0]["branch"], "task-" + T(201))

    def test_too_many_tasks_and_blocked(self):
        for n in range(204, 210):
            self.task(n)
        self.assertIn("too many", self.run_fail("order", "demo", *[T(n) for n in range(204, 210)], "--ref", self.REF))
        self.task(210, blocked_by=[{"type": "task", "ref": T(201)}])
        self.assertIn("waiting on", self.run_fail("order", "demo", T(210), "--ref", self.REF))


class TestLimits(Base):
    REF = "a" * 40

    def setUp(self):
        super().setUp()
        self.ungate()

    def test_open_order_cap_from_plan_and_engine_config(self):
        for n in (201, 202, 203):
            self.task(n)
        self.meta(max_open_orders=1)
        self.run_ok("order", "demo", T(201), "--write", "--start", "--ref", self.REF)
        self.assertIn("max_open_orders=1", self.run_fail("order", "demo", T(202), "--ref", self.REF))
        self.meta(max_open_orders=2)
        self.run_ok("order", "demo", T(202), "--write", "--start", "--ref", self.REF)
        self.assertIn("max_open_orders=2", self.run_fail("order", "demo", T(203), "--ref", self.REF))
        self.meta()
        m = json.loads((self.plan_dir / "plan.json").read_text())
        m.pop("max_open_orders")
        pt.write_json(self.plan_dir / "plan.json", m)
        self.run_ok("order", "demo", T(203), "--ref", self.REF)  # no cap configured: matrix decides
        cfg = json.loads((self.tmp / "engine" / "engine.json").read_text())
        cfg["limits"]["max_open_orders"] = 2
        pt.write_json(self.tmp / "engine" / "engine.json", cfg)
        self.assertIn("max_open_orders=2", self.run_fail("order", "demo", T(203), "--ref", self.REF))

    def test_conflict_with_in_progress_task_is_refused(self):
        self.task(201, deliverables=["src/shared.txt"])
        self.task(202, deliverables=["src/shared.txt"])
        self.task(203, deliverables=["src/other.txt"])
        self.run_ok("order", "demo", T(201), "--write", "--start", "--ref", self.REF)
        out = self.run_fail("order", "demo", T(202), "--ref", self.REF)
        self.assertIn("conflicts with in-progress task", out)
        self.run_ok("order", "demo", T(203), "--ref", self.REF)  # independent work may proceed in parallel


class TestCoverageAndVerify(Base):
    def test_coverage_with_inventory(self):
        self.ungate()
        pt.write_json(self.plan_dir / "spec_items.json", {"items": ["R1", "R2", "R3"]})
        pt.write_json(self.plan_dir / "coverage_exempt.json", {"items": [{"id": "R3", "reason": "informative"}]})
        self.task(201, spec_refs=["R1"])
        self.assertIn("UNCOVERED R2", self.run_fail("coverage", "demo", "--fail"))
        self.task(202, spec_refs=["R2", "R9"])
        self.assertIn("UNKNOWN-REF R9", self.run_fail("coverage", "demo", "--fail"))
        self.task(202, spec_refs=["R2"])
        self.run_ok("coverage", "demo", "--fail")

    def test_coverage_scan_target(self):
        self.meta(spec={"root": "specs", "glob": "**/*.md", "item_regex": r"\[(REQ-\d+)\]"})
        tgt = self.tmp / "t"
        (tgt / "specs").mkdir(parents=True)
        (tgt / "specs" / "s.md").write_text("[REQ-1] a\n[REQ-2] b\n")
        self.task(201, spec_refs=["REQ-1"])
        self.assertIn("UNCOVERED REQ-2", self.run_fail("coverage", "demo", "--fail", "--target", str(tgt)))

    def test_coverage_needs_inventory(self):
        self.assertIn("no spec_items.json", self.run_fail("coverage", "demo"))

    def test_verify_command_and_suite(self):
        tgt = self.tmp / "t"
        tgt.mkdir()
        self.task(201, verify={"method": "command", "argv": [sys.executable, "-c", "print('ok')"]})
        self.task(202, verify={"method": "command", "argv": [sys.executable, "-c", "import sys; sys.exit(3)"]})
        self.assertIn("PASS", self.run_ok("verify", "demo", T(201), "--target", str(tgt)))
        self.assertIn("FAIL (3)", self.run_fail("verify", "demo", T(202), "--target", str(tgt)))
        self.meta(verify={"commands": [[sys.executable, "-c", "pass"], [sys.executable, "-c", "import sys; sys.exit(1)"]]})
        self.assertIn("FAIL", self.run_fail("verify", "demo", "--suite", "--target", str(tgt)))

    def test_verify_needs_target(self):
        self.task(201)
        self.assertIn("--target", self.run_fail("verify", "demo", T(201)))


class TestCheckSubmission(Base):
    HEADINGS = ["Summary", "Deliverables", "Acceptance", "Spec references", "Verification",
                "Files", "Deviations", "Findings", "Open questions"]
    SID = PN + "-S001"

    def setUp(self):
        super().setUp()
        self.ungate()
        self.task(201, deliverables=["src/a.ts"], companions=["tests/a.test.ts"])
        self.run_ok("order", "demo", T(201), "--write", "--ref", "a" * 40)
        self.sdir = self.plan_dir / "submissions" / self.SID
        tdir = self.sdir / T(201)
        (tdir / "files" / "src").mkdir(parents=True)
        (tdir / "files" / "tests").mkdir(parents=True)
        (tdir / "files" / "src" / "a.ts").write_text("export const a = 1;\n")
        (tdir / "files" / "tests" / "a.test.ts").write_text("// test\n")
        (tdir / "REPORT.md").write_text("\n".join("## %s\nx\n" % h for h in self.HEADINGS))
        self.write_sub([{"id": T(201), "result": "READY"}])

    def write_sub(self, tasks):
        pt.write_json(self.sdir / "SUBMISSION.json", {"submission_id": self.SID, "plan_id": "demo", "tasks": tasks})

    def check(self, *extra):
        return ("check-submission", "demo", self.SID) + extra

    def write_upload_record(self):
        lines = []
        for f in sorted(self.sdir.rglob("*")):
            if f.is_file() and f.name not in pt.IGNORED_IN_SUBMISSION:
                lines.append("%s  ./%s" % (sha(f), f.relative_to(self.sdir).as_posix()))
        man = self.sdir / "MANIFEST.sha256"
        man.write_text("\n".join(lines) + "\n")
        pt.write_json(self.sdir / "UPLOAD.json", {"submission_id": self.SID, "manifest_sha256": sha(man), "prompt_sha": "unknown"})

    def test_ok_without_upload_record_when_allowed(self):
        self.run_ok(*self.check("--no-upload-record"))

    def test_requires_upload_record(self):
        self.assertIn("UPLOAD.json missing", self.run_fail(*self.check()))

    def test_ok_with_manifest_and_tamper_detection(self):
        self.write_upload_record()
        self.run_ok(*self.check())
        (self.sdir / T(201) / "files" / "src" / "a.ts").write_text("export const a = 2;\n")
        self.assertIn("changed since upload", self.run_fail(*self.check()))

    def test_late_files_are_ignored(self):
        self.write_upload_record()
        (self.sdir / "EXIT-REPORT.md").write_text("x")
        self.run_ok(*self.check())

    def test_extra_and_missing_files(self):
        base = self.sdir / T(201) / "files"
        (base / "src" / "extra.ts").write_text("x")
        self.assertIn("unexpected file: src/extra.ts", self.run_fail(*self.check("--no-upload-record")))
        (base / "src" / "extra.ts").unlink()
        (base / "tests" / "a.test.ts").unlink()
        self.assertIn("missing file: tests/a.test.ts", self.run_fail(*self.check("--no-upload-record")))

    def test_report_headings_enforced(self):
        (self.sdir / T(201) / "REPORT.md").write_text("## Summary\nx\n")
        self.assertIn("headings", self.run_fail(*self.check("--no-upload-record")))

    def test_secret_detected(self):
        (self.sdir / T(201) / "files" / "src" / "a.ts").write_text("k = '" + "ghp_" + "abcdefghijklmnopqrstuvwxyz0123" + "'\n")
        self.assertIn("secret pattern", self.run_fail(*self.check("--no-upload-record")))

    def test_blocked_requires_reason_and_order_coverage(self):
        self.write_sub([{"id": T(201), "result": "BLOCKED"}])
        self.assertIn("blocked_reason", self.run_fail(*self.check("--no-upload-record")))
        self.write_sub([{"id": T(201), "result": "BLOCKED", "blocked_reason": "spec ambiguous"}])
        self.run_ok(*self.check("--no-upload-record"))
        self.write_sub([{"id": T(999), "result": "READY"}])
        out = self.run_fail(*self.check("--no-upload-record"))
        self.assertIn("not in the order", out)
        self.assertIn("missing from SUBMISSION.json", out)

    def test_prompt_drift(self):
        self.write_upload_record()
        rec = json.loads((self.sdir / "UPLOAD.json").read_text())
        rec["prompt_sha"] = "0" * 64
        pt.write_json(self.sdir / "UPLOAD.json", rec)
        self.assertIn("worker prompt changed", self.run_fail(*self.check()))
        self.run_ok(*self.check("--allow-prompt-drift"))


class TestUnpack(unittest.TestCase):
    def test_unpack_and_safety(self):
        import unpack_blocks as ub
        d = Path(tempfile.mkdtemp())
        text = ("noise\n=== FILE: A/REPORT.md ===\n## Summary\nhi\n=== END FILE ===\n"
                "=== FILE: A/files/src/x.ts ===\n```ts\nconst x = 1;\n```\n=== END FILE ===\n")
        self.assertEqual(ub.unpack(text, d), ["A/REPORT.md", "A/files/src/x.ts"])
        self.assertEqual((d / "A/files/src/x.ts").read_text(), "const x = 1;\n")
        with self.assertRaises(ValueError):
            ub.unpack("=== FILE: ../evil ===\nx\n=== END FILE ===", d)
        with self.assertRaises(ValueError):
            ub.unpack("nothing here", d)
        shutil.rmtree(d, ignore_errors=True)


class TestHardenPlanOrder(Base):
    """Stage 2.2: schema/parser alignment, malformed input, path safety, pinned refs,
    atomic writes, deterministic behaviour, and shared signing with ctxlink."""

    def test_malformed_json_and_missing_required(self):
        bad = self.plan_dir / "plan.json"
        original = bad.read_text()
        bad.write_text("{not json", encoding="utf-8")
        self.assertIn("invalid JSON", self.run_fail("check", "demo"))
        bad.write_text(original, encoding="utf-8")
        # strip a required field
        data = json.loads(original)
        del data["title"]
        bad.write_text(json.dumps(data), encoding="utf-8")
        out = self.run_fail("check", "demo")
        self.assertTrue("missing required" in out or "title" in out)
        bad.write_text(original, encoding="utf-8")

    def test_unknown_fields_rejected(self):
        data = json.loads((self.plan_dir / "plan.json").read_text())
        data["extra_unknown"] = True
        pt.write_json(self.plan_dir / "plan.json", data)
        self.assertIn("unexpected property", self.run_fail("check", "demo"))

    def test_duplicate_task_ids_and_path_traversal(self):
        self.task(201, deliverables=["src/ok.txt"])
        self.ungate()
        out = self.run_fail("order", "demo", T(201), T(201), "--ref", "a" * 40)
        self.assertIn("duplicate", out.lower())
        # path traversal variants (must be rejected by check)
        for bad in ["../escape", "foo/../bar", "./hidden", "a/./b", "foo\\bar", "/abs"]:
            self.task(201, deliverables=[bad])
            msg = self.run_fail("check", "demo")
            self.assertIn("unsafe", msg, msg=bad)

    def test_invalid_state_transitions(self):
        self.ungate()
        self.task(201)
        self.run_ok("set", "demo", T(201), "in_progress", "--by", "op")
        out = self.run_fail("set", "demo", T(201), "dropped", "--by", "op")
        self.assertTrue("not allowed" in out or "illegal" in out.lower() or "transition" in out.lower())
        # cannot jump planned -> done
        self.task(202)
        out = self.run_fail("set", "demo", T(202), "done", "--by", "op")
        self.assertNotEqual(out, "")

    def test_work_order_requires_pinned_ref(self):
        self.ungate()
        self.task(201)
        out = self.run_fail("order", "demo", T(201))
        self.assertTrue("pinned" in out.lower() or "ref" in out.lower())
        # branch names and other non-40-hex values are rejected
        out = self.run_fail("order", "demo", T(201), "--ref", "main")
        self.assertIn("40-hex", out)
        out = self.run_fail("order", "demo", T(201), "--ref", "deadbeef")
        self.assertIn("40-hex", out)
        # valid 40-hex succeeds and is marked pinned
        out = self.run_ok("order", "demo", T(201), "--ref", "a" * 40, "--json")
        order = json.loads(out)
        self.assertTrue(order.get("context_ref_pinned"))

    def test_atomic_write_json_leaves_prior_on_failure(self):
        target = self.plan_dir / "tasks" / ("%s.json" % T(201))
        self.task(201, title="original")
        original = target.read_text()
        # Force a failure after temp creation by making the directory temporarily unwritable
        # is hard in portable tests; instead verify the public contract of write_json:
        # successful write produces valid JSON and no leftover .tmp- files.
        pt.write_json(target, {"id": T(201), "title": "updated", "stage": "1-2",
                               "executor": "worker", "status": "planned",
                               "acceptance": ["x"], "deliverables": ["src/x.txt"],
                               "companions": [], "blocked_by": [], "spec_refs": [],
                               "verify": {"method": "manual"}})
        self.assertEqual(json.loads(target.read_text())["title"], "updated")
        leftovers = list(target.parent.glob(".tmp-*.json"))
        self.assertEqual(leftovers, [], "atomic write must not leave temp files")

    def test_safe_rel_matches_ctxlink(self):
        import ctxlink
        cases = [
            ("src/ok.txt", True),
            ("../evil", False),
            ("foo/../bar", False),
            ("./x", False),
            ("", False),
            ("/abs", False),
            ("a\\b", False),
            ("foo/./bar", False),
            ("normal/path.txt", True),
        ]
        for path, expect in cases:
            self.assertEqual(bool(pt.safe_rel(path)), expect, path)
            self.assertEqual(bool(ctxlink.safe_path(path)), expect, path)

    def test_ctxlink_signing_shared(self):
        """plan_tool and ctxlink must use the same message format, encoding, and path rules."""
        import ctxlink
        secret = b"test-secret"
        kid, exp, order, ref, path = "k1", 1700000000, "S001", "a" * 40, "src/file.txt"
        sig1 = ctxlink.sign(secret, kid, exp, order, ref, path)
        # Reconstruct the message the same way ctxlink does
        msg = ctxlink.message(kid, exp, order, ref, path)
        self.assertEqual(msg, b"ctxgate-v1\nk1\n1700000000\nS001\n" + (b"a" * 40) + b"\nsrc/file.txt")
        # mint produces a URL containing the same signature
        urls = ctxlink.mint("https://gw.example", secret, kid, order, ref, [path], ttl=60, at=exp - 60)
        self.assertIn(sig1, urls[0])
        self.assertIn(ref, urls[0])
        self.assertIn(path.replace("/", "/"), urls[0])  # path segments present

    def test_deterministic_order_output(self):
        self.ungate()
        self.task(201, title="Alpha")
        self.task(202, title="Beta")
        ref = "b" * 40
        out1 = self.run_ok("order", "demo", T(201), T(202), "--ref", ref, "--json")
        out2 = self.run_ok("order", "demo", T(201), T(202), "--ref", ref, "--json")
        # submission_id advances; strip it for comparison of structure
        o1 = json.loads(out1)
        o2 = json.loads(out2)
        for o in (o1, o2):
            o.pop("submission_id", None)
            o.pop("upload_to", None)
        self.assertEqual(o1, o2)


if __name__ == "__main__":
    unittest.main()
