# Phase 2, Stage 2.2 follow-up: plan/order tooling hardening beyond PR #10

- Branch: `phase-2/2.2b-plan-tool-hardening`, rebased on `main` @ `99a5a73` (after PRs #10 and #12)
- Date: 2026-10-26
- Relationship to PR #10: #10 made `write_json` atomic, aligned `safe_rel` and required a 40-hex ref. This follow-up keeps all of that (and #10's 125 lines of tests), and adds what an audit of `plan_tool.py` and `ctxlink.py` found beyond it. Register entries F0-050 to F0-062, R0-018 to R0-020.

## Plan tasks

| Task | Result |
|---|---|
| 2.2.1 Audit schemas against actual behaviour | Every schema field of plan, stages, task, decisions, coverage-exempt (and order/submission files read back from disk) was replaced by 11 wrong-typed values and removed, across `check`, `render`, `next`, `plans` and `order`. The fuzz found crashes that are fixed and is now a permanent test. Schemas reject unknown fields everywhere except the order file, which the tool generates. |
| 2.2.2 Negative tests | Duplicate ids, invalid transitions, unknown and self references, traversal in task paths, wrong-typed files and fields, trailing newlines, moving refs, missing target files, non-git targets. |
| 2.2.3 Exact paths and immutable commits; never resolve moving branches | Full 40-hex ids only; hashes come from the committed blob at that commit, never the working tree. |
| 2.2.4 Atomic writes, no half-written state | Atomic helper for every write; rollback transaction for multi-file commands; `new` builds in a temporary directory; interrupted-write and mid-command failure tests. |
| 2.2.5 Single-writer ownership, stable exit codes, actionable errors | Per-plan lock with timeout; exit codes 0, 1, 2, 70, 130 documented in the tool and in `OPERATOR-GUIDE.md`; no tracebacks. |
| 2.2.6 plan_tool and ctxlink agree on signing | An independent implementation of the documented scheme (in the test) matches both tools for spaces, accents, `%`, `+`, `?`, `#`, emoji and deep paths, and the links `plan_tool order` prints decode back to the exact repository paths and refs. |

## Evidence

- Tool tests: 110 pass (79 already on `main` including #10's, plus 31 new). Run against the pre-fix tools the new tests produced 22 failures and 16 errors, so they guard real behaviour.
- Reference gateway tests (15), release self-test (22), update suites, package and verify (41 files), write-gateway typecheck and bundle: unchanged and passing.
- Merge notes: two #10 details were preserved (`write_json` creates missing parent directories; the stricter `safe_rel`), one #10 test was adapted (`ttl=0, at=exp` became `ttl=60, at=exp-60`, because zero-lifetime links are now refused, see F0-059).

## Not done here

- Reference gateway `max_ttl` default (7 days) vs the decided 72 hours: Phase 4 (F0-060).
- Path normalisation rules in the conformance vectors: Stage 4.1 (R0-020).
- Python versions: only the CI version is exercised; the old "Python 3.8+" claim was removed from the tool's docstring rather than asserted.
