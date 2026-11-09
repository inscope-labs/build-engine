#!/usr/bin/env python3
"""transition_reference.py - the reference decision for the task-state transition (D-4).

This is the executable form of docs/release/TASK-STATE-TRANSITION-CONTRACT.md section 5. It is a
*specification you can run*, not a gateway: it takes one transition request, the task's current
status, the outcome of the capability checks that happen first, and the seal fact from the write
gateway (`GET /admin/task-state`), and returns the decision Gateway A must reach.

It exists so that the refusal rules are checked here, in this repository, against vectors that
operator-console can run the same way (conformance/cases/task-state-transition.json). Gateway A is
not in this repository; this file does not claim that Gateway A behaves this way. It says what the
contract requires, and the vectors let Gateway A's own tests prove it.

The standard library only. Not shipped in releases.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# The task's status set. The authority is template/engine/schemas/task.schema.json (ADR 0011 item 2);
# conformance/test_task_state_transition.py checks that this list equals the schema's enum.
STATUSES = ("planned", "in_progress", "pr_open", "done", "dropped", "superseded")
TERMINAL = ("done", "dropped", "superseded")

# The operations this contract governs. `decide` (DECIDE) is not governed here.
OPERATIONS = ("SET", "SET_IN_PROGRESS", "SET_DONE")

# operation -> (statuses it may start from, the status it produces). SET produces its target.
LEGAL_FROM = {
    "SET_IN_PROGRESS": ("planned",),
    "SET_DONE": ("in_progress", "pr_open"),
}

# The fields of the seal fact, exactly as protocol.md section 10.4.1 lists them.
SEAL_FACT_FIELDS = ("task", "order", "known", "state", "committed", "sealed", "commit", "seal", "seal_attested", "ok")

# code -> HTTP status. The first five are inherited from Gateway A's frozen catalogue
# (gateway/docs/error-catalogue.md in operator-console); the last three are the ones this contract adds.
CODES = {
    "UNKNOWN_OP": 400,
    "BRANCH_MISMATCH": 403,
    "NONCE_REPLAYED": 409,
    "HEAD_MOVED": 409,
    "TRANSITION_NOT_ALLOWED": 409,
    "SEAL_NOT_ATTESTED": 409,
    "SEAL_FACT_UNAVAILABLE": 503,
}


def refuse(code: str, message: str) -> dict:
    return {"accepted": False, "code": code, "http": CODES[code], "message": message}


def evaluate(request: dict) -> dict:
    """Decide one transition.

    request keys: operation, task, order, current_status, target_status (SET only), branch_matches,
    nonce_seen, head_matches, seal_fact (a dict, the string "unavailable", or None when not asked).
    """
    operation = request["operation"]
    if operation not in OPERATIONS:
        return refuse("UNKNOWN_OP", "the operation is not a status transition")

    # The capability gate comes first. These are Gateway A's existing checks, in its existing order
    # (gateway/src/capability/gate.ts: verify, then the nonce), followed by the head check.
    if not request["branch_matches"]:
        return refuse("BRANCH_MISMATCH", "the capability's branch is not the task branch")
    if request["nonce_seen"]:
        return refuse("NONCE_REPLAYED", "this capability was already presented")
    if not request["head_matches"]:
        return refuse("HEAD_MOVED", "the task branch moved since the operator decided")

    current = request["current_status"]
    if current not in STATUSES:
        return refuse("TRANSITION_NOT_ALLOWED", "the task's status is not one the schema defines")

    # `done` is reachable only through SET_DONE, so the seal check cannot be bypassed with SET.
    target = {"SET_DONE": "done", "SET_IN_PROGRESS": "in_progress"}.get(operation) or request.get("target_status")
    if operation == "SET":
        if target not in STATUSES:
            return refuse("TRANSITION_NOT_ALLOWED", "the target status is not one the schema defines")
        if target == "done":
            return refuse("TRANSITION_NOT_ALLOWED", "done is set only by SET_DONE, over a sealed task")

    if current in TERMINAL:
        return refuse("TRANSITION_NOT_ALLOWED", "the task is %s and no transition leaves that status" % current)
    if operation in LEGAL_FROM and current not in LEGAL_FROM[operation]:
        return refuse("TRANSITION_NOT_ALLOWED", "%s is not allowed from %s" % (operation, current))
    if operation == "SET" and target == current:
        return refuse("TRANSITION_NOT_ALLOWED", "the task is already %s" % current)

    if operation == "SET_DONE":
        fact = request.get("seal_fact")
        if fact == "unavailable" or fact is None:
            return refuse("SEAL_FACT_UNAVAILABLE", "the write gateway's seal fact could not be read; nothing was recorded")
        if fact.get("task") != request["task"] or fact.get("order") != request["order"]:
            return refuse("SEAL_NOT_ATTESTED", "the seal fact is for a different task or work order")
        if fact.get("known") is not True:
            return refuse("SEAL_NOT_ATTESTED", "the write gateway holds no session for this task")
        if fact.get("seal_attested") is not True:
            return refuse("SEAL_NOT_ATTESTED", "the task is not sealed over a successful commit for this work order")

    return {"accepted": True, "code": None, "http": 200, "message": "accepted", "new_status": target}


def run_vectors(path: Path) -> int:
    cases = json.loads(path.read_text(encoding="utf-8"))["cases"]
    failures = 0
    for case in cases:
        got = evaluate(case["request"])
        want = case["expect"]
        ok = got["accepted"] == want["accepted"] and got["code"] == want.get("code") and got["http"] == want["http"]
        if "new_status" in want:
            ok = ok and got.get("new_status") == want["new_status"]
        print(("  ok   " if ok else "  FAIL ") + case["id"] + " - " + case["description"])
        failures += 0 if ok else 1
    print("%d case(s), %d failure(s)" % (len(cases), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent / "cases" / "task-state-transition.json"
    sys.exit(run_vectors(Path(sys.argv[1]) if len(sys.argv) > 1 else here))
