# Pilot

The acceptance test for the read path, before it is relied on (production path step 5 in
`template/docs/CONTEXT-EXPORT.md`): **one real task, one Class B agent, end to end, including revoke and audit.**

Done when: the task is submitted, and the audit shows only the reads the order expected.

## Preconditions

- `docs/decisions/0001` to `0004` decided.
- Production path steps 2 to 4 done: source adapter, ported rules, rate limiting and alerting
  (`gateway/read/production/`), and `conformance/` passing for the deployed gateway.
- A scratch private repository passed conformance first; the pilot uses a real task on the real repository.

## Run (the design's eight-step flow)

1. Setup: signing secret per key id, gateway configured, base URL in `engine.json` `context.gateway`.
2. Order: `plan_tool.py order ... --write --start` with `CTXGATE_SECRET` set; confirm the order file contains no signed link.
3. Hand the printed order to the agent.
4. The agent fetches each link with plain GET; compare `X-Content-SHA256` with the order's `sha256` where it can hash.
5. Let a link expire; re-mint with `plan_tool.py links`; confirm the order file hash did not change.
6. Submit the deliverable.
7. Revoke the order; confirm its links are now refused.
8. Audit: files served, files never fetched, refused attempts. Any unexpected read fails the pilot.

## Record

Write the outcome and any deviation here after the run (date, task id, agent, audit summary, issues).
