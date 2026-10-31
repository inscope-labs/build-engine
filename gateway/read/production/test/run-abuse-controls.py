#!/usr/bin/env python3
"""The abuse controls, tested.

The conformance suite judges the scheme: the link format, the signature, the expiry, the
refusal rules. It says nothing about the resource controls, because those are a property of the
deployment and not of the scheme. This test covers them:

  - a valid link is served;
  - a link beyond the order's request budget is refused with 429;
  - a flood of forged links puts the order in a cooldown, and the cooldown is audited as such;
  - the metrics endpoint counts what happened, and discloses no order, path or key id.

The limits used here are deliberately tiny, so that the test is quick and deterministic.

Not shipped in releases: it is a test.
"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from localenv import CONFORMANCE, LocalEnv, log  # noqa: E402

PER_ORDER_LIMIT = 5
REFUSAL_BURST = 3


def main():
    fixture = json.loads((CONFORMANCE / "cases" / "behaviours.json").read_text(encoding="utf-8"))["fixture"]
    work = Path(tempfile.mkdtemp(prefix="ctxgate-abuse-"))
    failures = []
    try:
        with LocalEnv(work, fixture, variables=[
            "RATE_LIMIT_PER_ORDER:%d" % PER_ORDER_LIMIT,
            "RATE_LIMIT_PER_IP:1000",
            "RATE_LIMIT_GLOBAL:5000",
            "REFUSAL_BURST:%d" % REFUSAL_BURST,
            "REFUSAL_COOLDOWN_SECONDS:300",
        ], port_offset=40) as env:
            log("worker is up: %s" % json.dumps(env.health))

            # 1. a valid link is served
            url = env.mint()
            signature = url.split("/")[5]
            status, body = env.request(url)
            if status != 200:
                failures.append("a valid link returned %s, expected 200" % status)
            else:
                log("ok   a valid link is served")

            # 2. the order's request budget is enforced
            statuses = [env.request(url)[0] for _ in range(PER_ORDER_LIMIT + 3)]
            served = 1 + sum(1 for s in statuses if s == 200)   # the first request counts too
            if served != PER_ORDER_LIMIT:
                failures.append("the order was served %d times, expected exactly %d: %s"
                                % (served, PER_ORDER_LIMIT, statuses))
            elif 429 not in statuses:
                failures.append("the order's request budget was never enforced: %s" % statuses)
            else:
                log("ok   the order's request budget is enforced (%d served, then %s)"
                    % (served, [s for s in statuses if s != 200]))

            # 3. a flood of authenticated refusals puts the order in a cooldown
            #
            # The refusals are counted only after the signature has been verified, so a forger
            # cannot lock out a real order by naming it in a link it cannot prove. The refusals
            # here are therefore authentic: a properly signed link whose lifetime has passed.
            noisy_order = "10008-S900"
            expired = env.mint(order=noisy_order, exp=int(time.time()) - 3600)
            refusals = [env.request(expired)[0] for _ in range(REFUSAL_BURST + 1)]
            if not all(s == 403 for s in refusals):
                failures.append("the expired links returned %s, expected 403" % refusals)
            else:
                log("ok   %d authenticated refusals are counted against the order" % len(refusals))

            # 4. the order is now in a cooldown: a valid link for it is refused with 429
            live = env.mint(order=noisy_order)
            status, _ = env.request(live)
            if status != 429:
                failures.append("the order in a cooldown returned %s, expected 429" % status)
            else:
                log("ok   the order in a cooldown is refused with 429")

            # 5. a forged flood cannot put an order in a cooldown
            forged_order = "10008-S901"
            forged = env.mint(order=forged_order, exp=int(time.time()) - 3600)
            parts = forged.split("/")          # /v1/{kid}/{exp}/{order}/{sig}/{ref}/{path}
            forged = "/".join(parts[:5] + ["A" * 43] + parts[6:])
            for _ in range(REFUSAL_BURST + 2):
                env.request(forged)
            live_forged_order = env.mint(order=forged_order)
            status, _ = env.request(live_forged_order)
            if status != 200:
                failures.append("a forged flood put an order in a cooldown: %s" % status)
            else:
                log("ok   a forged flood cannot put an order in a cooldown")

            # 6. the audit trail says what happened, and says nothing it should not
            status, raw = env.admin("/admin/audit")
            if status != 200:
                failures.append("the audit endpoint returned %s" % status)
            else:
                records = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
                reasons = {r["reason"] for r in records}
                if "ok" not in reasons:
                    failures.append("the audit trail has no successful request")
                if "cooldown" not in reasons:
                    failures.append("the audit trail does not record the cooldown: %s" % sorted(reasons))
                blob = json.dumps(records)
                if "test-secret" in blob:
                    failures.append("the signing secret appears in the audit trail")
                if signature in blob:
                    failures.append("a signature appears in the audit trail")
                if not all(r.get("request_id") for r in records):
                    failures.append("an audit record has no request id")
                log("ok   the audit trail records the abuse controls without leaking (%d records)" % len(records))

            # 7. the metrics endpoint counts, and discloses nothing
            status, raw = env.admin("/admin/metrics")
            if status != 200:
                failures.append("the metrics endpoint returned %s" % status)
            else:
                metrics = json.loads(raw)
                if not metrics.get("by_status"):
                    failures.append("the metrics endpoint reports no counters")
                blob = json.dumps(metrics)
                for leak in ("10008-S001", "amk/spec.md", "k1", "test-secret"):
                    if leak in blob:
                        failures.append("the metrics endpoint discloses %r" % leak)
                log("ok   the metrics endpoint counts without disclosing (%s)" % json.dumps(metrics))

            # 8. the admin channel is closed without a credential
            status, _ = env.request("/admin/audit")
            if status != 401:
                failures.append("the admin channel answered %s without a credential" % status)
            else:
                log("ok   the admin channel refuses an unauthenticated caller")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        for failure in failures:
            log("FAIL %s" % failure)
        log("FAILED")
        return 1
    log("PASSED: the abuse controls hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
