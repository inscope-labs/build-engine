#!/usr/bin/env python3
"""Adversarial, atomicity and signing-consistency tests for plan_tool.py and ctxlink.py (Stage 2.2).

Run: python3 -m unittest discover -s engine/tools -v
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxlink  # noqa: E402
import plan_tool as pt  # noqa: E402
from test_plan_tool import PN, REAL_ENGINE, Base, T  # noqa: E402

REF = "a" * 40
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid"]


def git(repo, *args):
    return subprocess.run(GIT + ["-C", str(repo)] + list(args), check=True, capture_output=True, text=True).stdout.strip()


class Hardened(Base):
    def setUp(self):
        super().setUp()
        self.ungate()

    def make_target(self, files):
        repo = self.tmp / "ctx"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        for rel, text in files.items():
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (repo / rel).write_text(text)
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "ctx")
        return repo, git(repo, "rev-parse", "HEAD")


class TestMalformedInput(Hardened):
    def test_duplicate_task_ids_are_an_error_not_silently_dropped(self):
        t = self.task(201)
        dup = dict(t, title="duplicate")
        pt.write_json(self.plan_dir / "tasks" / (PN + "-1-200-00.json"), dup)  # same id inside, other file name
        out = self.run_fail("check", "demo")
        self.assertIn("duplicate task id " + T(201), out)
        self.assertIn("fix them before ordering", self.run_fail("order", "demo", T(201), "--ref", REF))

    def test_order_refuses_a_plan_that_fails_check(self):
        self.task(201, context=[{"source": "target", "path": "../secret.txt"}])
        out = self.run_fail("order", "demo", T(201), "--ref", REF, "--write")
        self.assertIn("fix them before ordering", out)
        self.assertEqual(list((self.plan_dir / "orders").glob("*.json")), [])

    def test_order_refuses_schema_invalid_plan_json(self):
        self.task(201)
        pm = json.loads((self.plan_dir / "plan.json").read_text())
        pm["title"] = 5
        pt.write_json(self.plan_dir / "plan.json", pm)
        self.assertIn("fix them before ordering", self.run_fail("order", "demo", T(201), "--ref", REF))

    def test_wrong_typed_fields_give_errors_not_tracebacks(self):
        for label, over in (("context strings", {"context": ["x"]}), ("blocked_by strings", {"blocked_by": ["x"]}),
                            ("deliverables int", {"deliverables": 7}), ("verify string", {"verify": "x"}),
                            ("acceptance int", {"acceptance": 5}), ("evidence string", {"evidence": "x"}),
                            ("null stage", {"stage": None})):
            with self.subTest(label):
                self.task(201, **over)
                rc, out, err = self.run_tool("check", "demo")
                self.assertEqual(rc, 1, label)
                self.assertNotIn("Traceback", out + err)
                self.assertIn("ERROR", out + err)

    def test_wrong_typed_files_give_errors_not_tracebacks(self):
        cases = {
            "task is an array": (self.plan_dir / "tasks" / (T(201) + ".json"), "[1, 2]"),
            "empty task file": (self.plan_dir / "tasks" / (T(202) + ".json"), ""),
            "stages wrong types": (self.plan_dir / "stages.json", '{"phases": 5, "stages": 7}'),
            "plan.json is a string": (self.plan_dir / "plan.json", '"x"'),
            "decisions wrong type": (self.plan_dir / "decisions.json", '{"decisions": 5}'),
        }
        original = {k: p.read_text() if p.exists() else None for k, (p, _) in cases.items()}
        for label, (path, text) in cases.items():
            with self.subTest(label):
                path.write_text(text)
                rc, out, err = self.run_tool("check", "demo")
                self.assertNotEqual(rc, 0, label)
                self.assertNotIn("Traceback", out + err)
                self.assertIn("ERROR", out + err)
                if original[label] is None:
                    path.unlink()
                else:
                    path.write_text(original[label])

    def test_unexpected_errors_exit_70_without_a_traceback(self):
        with mock.patch.object(pt, "cmd_plans", side_effect=RuntimeError("boom")):
            rc, out, err = self.run_tool("plans")
        self.assertEqual(rc, 70)
        self.assertIn("unexpected RuntimeError: boom", err)
        self.assertNotIn("Traceback", err)
        with mock.patch.object(pt, "cmd_plans", side_effect=RuntimeError("boom")), mock.patch.dict(os.environ, {"PLAN_DEBUG": "1"}):
            with self.assertRaises(RuntimeError):
                self.run_tool("plans")

    def test_exit_codes_are_stable(self):
        self.assertEqual(self.run_tool("check", "demo")[0], 0)
        self.assertEqual(self.run_tool("check", "nope")[0], 1)
        with self.assertRaises(SystemExit) as cm:
            self.run_tool("bogus-command")
        self.assertEqual(cm.exception.code, 2)

    def test_ids_with_trailing_newline_or_traversal_are_rejected(self):
        self.assertIsNone(pt.parse_id(T(201) + "\n"))
        before = sorted(p.name for p in (self.tmp / "plans").iterdir())
        self.assertIn("plan_id", self.run_fail("new", "x\n", "--number", "99002"))
        self.assertEqual(sorted(p.name for p in (self.tmp / "plans").iterdir()), before)
        with self.assertRaises(pt.ToolError):
            pt.Plan("demo\n")
        self.assertIn("bad submission id", self.run_fail("check-submission", "demo", "../../x"))
        self.assertIn("bad order id", self.run_fail("links", "demo", "../../x/leak"))

    def test_path_traversal_variants_in_task_paths(self):
        for bad in ("../x", "a/../b", "/abs", "a\\b", "C:/x", ""):
            with self.subTest(bad):
                self.assertFalse(pt.safe_rel(bad), bad)
        self.assertTrue(pt.safe_rel("a..b/c.txt"))  # a name that merely contains two dots is fine
        self.task(201, deliverables=["src/../../etc/passwd"])
        self.assertIn("unsafe deliverable path", self.run_fail("check", "demo"))

    def test_invalid_state_transitions_and_cross_references(self):
        self.task(201)
        self.assertIn("not allowed", self.run_fail("set", "demo", T(201), "done", "--by", "me"))
        self.task(202, blocked_by=[{"type": "task", "ref": PN + "-1-299-00"}])
        self.assertIn("blocked_by unknown task", self.run_fail("check", "demo"))
        self.task(202, blocked_by=[{"type": "task", "ref": T(202)}])
        self.assertIn("blocked by itself", self.run_fail("check", "demo"))


class TestPinning(Hardened):
    def test_moving_refs_are_refused(self):
        self.task(201)
        for bad in ("main", "HEAD", "a" * 39, "A" * 40, "a" * 40 + "\n", "refs/heads/main"):
            with self.subTest(bad):
                self.assertIn("not a pinned commit", self.run_fail("order", "demo", T(201), "--ref", bad))
        self.assertIn("--plan-ref", self.run_fail("order", "demo", T(201), "--ref", REF, "--plan-ref", "main"))

    def test_printed_order_claims_pinning_only_when_true(self):
        self.task(201)
        o = json.loads(self.run_ok("order", "demo", T(201), "--ref", REF, "--json"))
        self.assertTrue(o["context_ref_pinned"])
        self.assertRegex(o["context_ref"], r"^[0-9a-f]{40}$")

    def test_hash_is_of_the_committed_file_not_the_working_tree(self):
        repo, head = self.make_target({"specs/a.md": "COMMITTED\n"})
        (repo / "specs" / "a.md").write_text("DIRTY UNCOMMITTED\n")
        (repo / "specs" / "untracked.md").write_text("never committed\n")
        self.task(201, context=[{"source": "target", "path": "specs/a.md"}], deliverables=["specs/untracked.md"])
        o = json.loads(self.run_ok("order", "demo", T(201), "--target", str(repo), "--json"))
        ctx = {c["path"]: c for c in o["tasks"][0]["context"]}
        self.assertEqual(o["context_ref"], head)
        self.assertEqual(ctx["specs/a.md"]["sha256"], hashlib.sha256(b"COMMITTED\n").hexdigest())
        self.assertNotIn("specs/untracked.md", ctx)  # an uncommitted file is not served at the pinned commit

    def test_target_file_missing_at_the_pinned_commit_is_refused(self):
        repo, head = self.make_target({"a.md": "x"})
        self.task(201, context=[{"source": "target", "path": "missing.md"}])
        self.assertIn("not found at the pinned commit", self.run_fail("order", "demo", T(201), "--target", str(repo)))
        self.task(201, context=[{"source": "target", "path": "a.md"}])
        self.assertIn("not found", self.run_fail("order", "demo", T(201), "--target", str(repo), "--ref", REF))

    def test_not_a_git_checkout_is_refused(self):
        plain = self.tmp / "plain"
        plain.mkdir()
        self.task(201)
        self.assertIn("cannot read HEAD of --target", self.run_fail("order", "demo", T(201), "--target", str(plain)))

    def test_gateway_misconfiguration_gives_clean_errors(self):
        self.task(201)  # no context items: a bad ttl must be refused anyway, as it is a configuration error
        cfg = json.loads((self.tmp / "engine" / "engine.json").read_text())
        cfg["context"]["gateway"].update({"base": "https://gw.example"})
        for ttl, expect in (("abc", "between 1 and"), (0, "between 1 and"), (-5, "between 1 and"), (ctxlink.MAX_TTL + 1, "between 1 and")):
            with self.subTest(ttl):
                cfg["context"]["gateway"]["ttl_seconds"] = ttl
                pt.write_json(self.tmp / "engine" / "engine.json", cfg)
                with mock.patch.dict(os.environ, {"CTXGATE_SECRET": "s"}):
                    out = self.run_fail("order", "demo", T(201), "--ref", REF)
                self.assertIn(expect, out)
                self.assertNotIn("Traceback", out)


class TestAtomicity(Hardened):
    def test_interrupted_write_leaves_the_old_file_and_no_temp_files(self):
        t = self.task(201)
        f = self.plan_dir / "tasks" / (T(201) + ".json")
        before = f.read_text()
        with mock.patch("os.replace", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                pt.write_json(f, dict(t, title="CHANGED"))
        self.assertEqual(f.read_text(), before)
        json.loads(f.read_text())
        self.assertEqual([p.name for p in f.parent.iterdir() if p.name.endswith(".tmp")], [])

    def test_write_preserves_file_mode(self):
        self.task(201)
        f = self.plan_dir / "tasks" / (T(201) + ".json")
        os.chmod(f, 0o640)
        pt.write_json(f, json.loads(f.read_text()))
        self.assertEqual(f.stat().st_mode & 0o777, 0o640)

    def test_new_failure_leaves_no_partial_plan_and_no_counter_bump(self):
        counter = self.tmp / "plans" / "counter.json"
        before = counter.read_text()
        names = sorted(p.name for p in (self.tmp / "plans").iterdir())
        with mock.patch.object(pt, "write_generated", side_effect=RuntimeError("disk full")):
            rc, out, err = self.run_tool("new", "second", "--number", "99002")
        self.assertEqual(rc, 70)
        self.assertEqual(sorted(p.name for p in (self.tmp / "plans").iterdir()), names)
        self.assertEqual(counter.read_text(), before)  # a failed attempt must not consume a plan number
        self.run_ok("new", "second", "--number", "99002")  # and does not block a retry

    def test_order_start_failure_rolls_back_order_file_and_task_state(self):
        self.task(201)
        self.task(202)
        real = pt.Plan.save_task
        calls = {"n": 0}

        def flaky(plan, tid, txn=None):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("simulated disk failure on the second task")
            return real(plan, tid, txn)

        with mock.patch.object(pt.Plan, "save_task", flaky):
            rc, out, err = self.run_tool("order", "demo", T(201), T(202), "--ref", REF, "--write", "--start")
        self.assertNotEqual(rc, 0)
        self.assertEqual(list((self.plan_dir / "orders").glob("*.json")), [], "orphan order file left behind")
        for n in (201, 202):
            self.assertEqual(json.loads((self.plan_dir / "tasks" / (T(n) + ".json")).read_text())["status"], "planned")
        self.run_ok("order", "demo", T(201), T(202), "--ref", REF, "--write", "--start")  # retry works from clean state

    def test_decide_failure_rolls_back(self):
        pt.write_json(self.plan_dir / "decisions.json", {"decisions": [{"id": "D-01", "title": "t", "status": "open"}]})
        before = (self.plan_dir / "decisions.json").read_text()
        with mock.patch.object(pt, "write_generated", side_effect=OSError("disk full")):
            rc, out, err = self.run_tool("decide", "demo", "D-01", "--by", "me", "--notes", "ok")
        self.assertNotEqual(rc, 0)
        self.assertEqual((self.plan_dir / "decisions.json").read_text(), before)

    def test_create_new_refuses_to_overwrite(self):
        f = self.plan_dir / "orders" / (PN + "-S001.json")
        f.write_text("ORIGINAL")
        with self.assertRaises(pt.ToolError):
            pt.Txn().create_new(f, "NEW")
        self.assertEqual(f.read_text(), "ORIGINAL")

    def test_concurrent_orders_get_distinct_ids_and_none_is_lost(self):
        self.task(201)
        self.task(202)
        tool = str(REAL_ENGINE / "tools" / "plan_tool.py")
        for _ in range(4):
            for f in (self.plan_dir / "orders").glob("*.json"):
                f.unlink()
            procs = [subprocess.Popen([sys.executable, tool, "--root", str(self.tmp), "order", "demo", T(n), "--ref", REF, "--write"],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dict(os.environ, PLAN_NOW="2026-01-01T00:00:00Z"))
                     for n in (201, 202)]
            results = []
            for p in procs:
                _, err = p.communicate()
                results.append((p.returncode, err.decode()))
            self.assertEqual([r[0] for r in results], [0, 0], results)
            files = sorted(p.name for p in (self.plan_dir / "orders").glob("*.json"))
            self.assertEqual(files, [PN + "-S001.json", PN + "-S002.json"])

    def test_lock_times_out_with_a_clear_message(self):
        self.task(201)
        with pt.plan_lock("demo"):
            with mock.patch.dict(os.environ, {"PLAN_LOCK_TIMEOUT": "0.2"}):
                out = self.run_fail("order", "demo", T(201), "--ref", REF, "--write")
        self.assertIn("still writing demo", out)
        self.assertEqual(list((self.plan_dir / "orders").glob("*.json")), [])


class TestDeterminism(Hardened):
    def test_outputs_are_reproducible(self):
        self.task(201)
        self.task(202, blocked_by=[{"type": "task", "ref": T(201)}])
        a = [self.run_tool(*c) for c in (("check", "demo"), ("next", "demo", "--all", "--json"), ("render", "demo", "--check"))]
        b = [self.run_tool(*c) for c in (("check", "demo"), ("next", "demo", "--all", "--json"), ("render", "demo", "--check"))]
        self.assertEqual(a, b)
        o1 = self.run_ok("order", "demo", T(201), "--ref", REF, "--json")
        o2 = self.run_ok("order", "demo", T(201), "--ref", REF, "--json")
        self.assertEqual(o1, o2)
        self.assertNotIn("\r", o1)


class TestFuzzedShapes(Hardened):
    """Every schema field, replaced by values of the wrong type or removed, must produce an ERROR line, never a crash."""

    VALUES = [[], {}, 0, "", None, True, "x", -1, [1], ["a"], {"a": 1}]
    COMMANDS = (("check", "demo"), ("render", "demo", "--check"), ("next", "demo", "--all", "--json"), ("plans",))

    def assert_no_crash(self, label):
        for cmd in self.COMMANDS:
            rc, out, err = self.run_tool(*cmd)
            self.assertNotIn(rc, (70,), "%s: %s crashed: %s" % (label, cmd[0], err))
            self.assertNotIn("Traceback", out + err, label)

    def fuzz_file(self, path, schema, base):
        props = json.loads((REAL_ENGINE / "schemas" / ("%s.schema.json" % schema)).read_text())["properties"]
        for key in props:
            for v in self.VALUES + ["__REMOVE__"]:
                doc = json.loads(json.dumps(base))
                if v == "__REMOVE__":
                    doc.pop(key, None)
                else:
                    doc[key] = v
                pt.write_json(path, doc)
                self.assert_no_crash("%s.%s=%r" % (path.name, key, v))
        pt.write_json(path, base)

    def test_task_plan_stages_decisions_and_exempt_files(self):
        base = self.task(201)
        self.fuzz_file(self.plan_dir / "tasks" / (T(201) + ".json"), "task", base)
        for fn, schema in (("plan.json", "plan"), ("stages.json", "stages"), ("coverage_exempt.json", "coverage_exempt")):
            path = self.plan_dir / fn
            self.fuzz_file(path, schema, json.loads(path.read_text()))
        dpath = self.plan_dir / "decisions.json"
        pt.write_json(dpath, {"decisions": [{"id": "D-01", "title": "t", "status": "open"}]})
        self.fuzz_file(dpath, "decisions", json.loads(dpath.read_text()))

    def test_order_and_submission_files_read_back_from_disk(self):
        self.task(201)
        self.run_ok("order", "demo", T(201), "--ref", REF, "--write")
        sid = PN + "-S001"
        opath = self.plan_dir / "orders" / (sid + ".json")
        order = json.loads(opath.read_text())
        sdir = self.plan_dir / "submissions" / sid
        sdir.mkdir(parents=True)
        for key in list(order) + ["__list__"]:
            for v in self.VALUES:
                doc = json.loads(json.dumps(order))
                if key == "__list__":
                    doc = [doc]
                else:
                    doc[key] = v
                pt.write_json(opath, doc)
                pt.write_json(sdir / "SUBMISSION.json", {"submission_id": sid, "plan_id": "demo", "tasks": []})
                for cmd in (("check-submission", "demo", sid, "--no-upload-record"), ("links", "demo", sid), ("next", "demo", "--all")):
                    rc, out, err = self.run_tool(*cmd)
                    self.assertNotEqual(rc, 70, "%s=%r %s crashed: %s" % (key, v, cmd[0], err))
                    self.assertNotIn("Traceback", out + err)
        pt.write_json(opath, order)
        for key in ("submission_id", "plan_id", "tasks", "files"):
            for v in self.VALUES:
                pt.write_json(sdir / "SUBMISSION.json", {"submission_id": sid, "plan_id": "demo", "tasks": [], key: v})
                rc, out, err = self.run_tool("check-submission", "demo", sid, "--no-upload-record")
                self.assertNotEqual(rc, 70, "SUBMISSION.%s=%r crashed: %s" % (key, v, err))


def spec_sign(secret, kid, exp, order, ref, path):
    """Independent implementation of the documented scheme (ctxlink.py docstring), used as the oracle."""
    msg = ("ctxgate-v1\n%s\n%d\n%s\n%s\n%s" % (kid, exp, order, ref, path)).encode("utf-8")
    return base64.urlsafe_b64encode(hmac.new(secret, msg, hashlib.sha256).digest()).rstrip(b"=").decode()


class TestSigningConsistency(unittest.TestCase):
    SECRET = b"consistency-secret"

    def test_strict_validation_of_identifiers(self):
        for kw in ({"kid": "k1\n"}, {"order": "ORD-1\n"}, {"ref": REF + "\n"}, {"ref": REF.upper()}, {"kid": ""}, {"order": "-x"}):
            args = dict(kid="k1", order="ORD-1", ref=REF)
            args.update(kw)
            with self.subTest(kw), self.assertRaises(ValueError):
                ctxlink.mint("https://g", self.SECRET, args["kid"], args["order"], args["ref"], ["a.md"])
        for bad in ("a\nb", "a\tb", "a\x7fb", "a\x00b", "a\rb"):
            with self.subTest(repr(bad)), self.assertRaises(ValueError):
                ctxlink.mint("https://g", self.SECRET, "k1", "ORD-1", REF, [bad])

    def test_ttl_bounds_and_cli(self):
        for ttl in (0, -1, ctxlink.MAX_TTL + 1):
            with self.subTest(ttl), self.assertRaises(ValueError):
                ctxlink.mint("https://g", self.SECRET, "k1", "ORD-1", REF, ["a.md"], ttl=ttl, at=1000)
        for ttl in (1, ctxlink.MAX_TTL):
            self.assertEqual(ctxlink.mint("https://g", self.SECRET, "k1", "ORD-1", REF, ["a.md"], ttl=ttl, at=1000)[0].split("/")[5], str(1000 + ttl))
        r = subprocess.run([sys.executable, str(REAL_ENGINE / "tools" / "ctxlink.py"), "mint", "--base", "https://g", "--order", "ORD-1", "--ref", REF,
                            "--ttl", "0", "a.md"], env=dict(os.environ, CTXGATE_SECRET="s"), capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("ttl must be between", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_signature_matches_an_independent_implementation_for_tricky_paths(self):
        paths = ["a.md", "dir with space/file name.md", "caf\u00e9/\u00fcber.md", "percent%20sign/x.md", "plus+sign/x.md", "q?x/h#y.md",
                 "emoji/\U0001F600.md", "a..b/c.md", "UPPER/Case.MD", "deep/" * 20 + "f.md"]
        urls = ctxlink.mint("https://gw.example/base", self.SECRET, "k1", "10008-S001", REF, paths, ttl=60, at=1999999940)
        self.assertEqual(len(urls), len(paths))
        for path, url in zip(paths, urls):
            with self.subTest(path):
                head, _, rest = url.partition("/v1/")
                self.assertEqual(head, "https://gw.example/base")
                kid, exp, order, sig, ref, tail = rest.split("/", 5)
                self.assertEqual((kid, exp, order, ref), ("k1", "2000000000", "10008-S001", REF))
                self.assertEqual("/".join(unquote(seg) for seg in tail.split("/")), path)
                self.assertEqual(sig, spec_sign(self.SECRET, kid, int(exp), order, ref, path))
                self.assertTrue(tail.isascii(), tail)
                for ch in " ?#+":
                    self.assertNotIn(ch, tail)  # specials are percent-encoded, never raw

    def test_plan_tool_links_use_the_same_scheme(self):
        t = Base()
        t.setUp()
        try:
            t.ungate()
            t.task(201, context=[{"source": "target", "path": "specs/a b.md"}, {"source": "plan", "path": "pkg/x.md"}])
            cfg = json.loads((t.tmp / "engine" / "engine.json").read_text())
            cfg["context"]["gateway"].update({"base": "https://gw.example", "kid": "k7", "ttl_seconds": 3600})
            pt.write_json(t.tmp / "engine" / "engine.json", cfg)
            env = {"CTXGATE_SECRET": "pt-secret", "CTXGATE_NOW": "1000000"}
            with mock.patch.dict(os.environ, env):
                o = json.loads(t.run_ok("order", "demo", T(201), "--ref", REF, "--plan-ref", "b" * 40, "--json"))
            items = o["tasks"][0]["context"]
            self.assertEqual(len(items), 2)
            for c in items:
                _, _, rest = c["gateway_url"].partition("/v1/")
                kid, exp, order, sig, ref, tail = rest.split("/", 5)
                path = "/".join(unquote(s) for s in tail.split("/"))
                self.assertEqual((kid, int(exp), order, ref, path), ("k7", 1003600, o["submission_id"], c["ref"], c["repo_path"]))
                self.assertEqual(sig, spec_sign(b"pt-secret", kid, int(exp), order, ref, path))
            self.assertEqual(items[1]["repo_path"], "plans/demo/package/pkg/x.md")
            self.assertEqual(items[1]["ref"], "b" * 40)
            written = (t.plan_dir / "orders")
            self.assertEqual(list(written.glob("*.json")), [])
        finally:
            t.tearDown()


if __name__ == "__main__":
    unittest.main()
