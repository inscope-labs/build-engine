/**
 * Observable replay on the read link (GAP R-1, option R-1.d, ADR 0010).
 *
 * The decision: the read link stays reusable until it expires, so a replay still succeeds. What
 * changes is that every presentation is *counted* and the count is reported against a threshold.
 * These tests hold the implementation to that, and to the three things the decision forbids:
 * a change to the audit record, a counter that unauthenticated noise can raise, and a counting
 * failure that takes a request down with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { GatewayState } from "../../src/state.ts";
import type { AuditRecord } from "../../src/audit.ts";

/** A Durable Object storage backed by a Map, with the four calls the state object uses. */
function fakeStorage(options: { failPut?: (key: string) => boolean } = {}) {
  const data = new Map<string, unknown>();
  return {
    data,
    storage: {
      async get(key: string) {
        return data.get(key);
      },
      async put(key: string, value: unknown) {
        if (options.failPut?.(key)) throw new Error("storage is down");
        data.set(key, JSON.parse(JSON.stringify(value)));
      },
      async delete(key: string) {
        return data.delete(key);
      },
      async list(opts: { prefix?: string } = {}) {
        const out = new Map<string, unknown>();
        for (const key of [...data.keys()].sort()) {
          if (opts.prefix === undefined || key.startsWith(opts.prefix)) out.set(key, data.get(key));
        }
        return out;
      },
    },
  };
}

const THRESHOLD = 3;
const KEEP = 1000;
const REF = "a".repeat(40);

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: 1_800_000_000,
    status: 200,
    reason: "ok",
    kid: "k1",
    order: "10008-S001",
    ref: REF,
    path: "amk/amk-ssot.md",
    bytes: 120,
    request_id: "req-1",
    ...overrides,
  };
}

function build(options?: Parameters<typeof fakeStorage>[0]) {
  const backing = fakeStorage(options);
  const state = new GatewayState({ storage: backing.storage } as never);
  return {
    backing,
    state,
    async audit(rec: AuditRecord) {
      return state.fetch(
        new Request("https://state.internal/audit", {
          method: "POST",
          body: JSON.stringify({
            record: rec,
            retention: 500,
            limits: { burst: 60, cooldownSeconds: 300 },
            replay: { threshold: THRESHOLD, keepSeconds: KEEP },
          }),
        }),
      );
    },
    async report(threshold = THRESHOLD) {
      return (await state.fetch(new Request(`https://state.internal/replay?threshold=${threshold}`))).json() as Promise<Record<string, unknown>>;
    },
    async metrics() {
      return (await state.fetch(new Request("https://state.internal/metrics"))).json() as Promise<Record<string, unknown>>;
    },
    async gate(now: number) {
      return state.fetch(
        new Request("https://state.internal/gate", {
          method: "POST",
          body: JSON.stringify({ ip: "203.0.113.9", now, windowSeconds: 60, limits: { perIp: 1000, global: 1000 } }),
        }),
      );
    },
  };
}

/** Capture what the state object writes to the platform log. */
function captureWarnings() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console.warn = original) };
}

test("each served presentation of a link is counted, and the replay still succeeds", async () => {
  const s = build();
  for (let i = 0; i < 2; i++) assert.equal((await s.audit(record({ request_id: `r${i}` }))).status, 200);
  const metrics = await s.metrics();
  assert.equal(metrics.links_tracked, 1);
  assert.equal(metrics.links_repeated, 1);
});

test("a link at or below the threshold is not reported; above it, it is, with its count", async () => {
  const s = build();
  for (let i = 0; i < THRESHOLD; i++) await s.audit(record({ ts: 1_800_000_000 + i, request_id: `r${i}` }));
  assert.deepEqual((await s.report()).exceeded, []);
  await s.audit(record({ ts: 1_800_000_010, request_id: "over" }));
  const report = await s.report();
  const exceeded = report.exceeded as Array<Record<string, unknown>>;
  assert.equal(exceeded.length, 1);
  assert.equal(exceeded[0]!.presentations, THRESHOLD + 1);
  assert.equal(exceeded[0]!.order, "10008-S001");
  assert.equal(exceeded[0]!.path, "amk/amk-ssot.md");
  assert.equal(exceeded[0]!.first, 1_800_000_000);
  assert.equal(exceeded[0]!.last, 1_800_000_010);
  assert.equal(report.threshold, THRESHOLD);
});

test("different links of one order are counted separately, so a task that reads many files is not a replay", async () => {
  const s = build();
  for (let i = 0; i < 20; i++) await s.audit(record({ path: `amk/file-${i}.md`, request_id: `r${i}` }));
  const report = await s.report();
  assert.deepEqual(report.exceeded, []);
  assert.equal(report.links_tracked, 20);
  assert.equal(report.links_repeated, 0);
});

test("the same path at another commit is another link", async () => {
  const s = build();
  for (let i = 0; i < THRESHOLD; i++) await s.audit(record({ ref: "a".repeat(40) }));
  for (let i = 0; i < THRESHOLD; i++) await s.audit(record({ ref: "b".repeat(40) }));
  const report = await s.report();
  assert.deepEqual(report.exceeded, []);
  assert.equal(report.links_tracked, 2);
});

test("refusals are never counted as presentations", async () => {
  const s = build();
  for (const [reason, status] of [
    ["bad-signature", 401],
    ["expired", 410],
    ["revoked", 403],
    ["path-denied", 403],
    ["not-found", 404],
    ["rate-limited", 429],
    ["cooldown", 429],
    ["state-unavailable", 503],
  ] as const) {
    for (let i = 0; i < 10; i++) await s.audit(record({ reason, status }));
  }
  const report = await s.report();
  assert.equal(report.links_tracked, 0);
});

test("a record with no order, commit or path cannot raise a count", async () => {
  const s = build();
  for (let i = 0; i < 20; i++) {
    await s.audit(record({ order: "-" }));
    await s.audit(record({ ref: "-" }));
    await s.audit(record({ path: "-" }));
  }
  assert.equal((await s.report()).links_tracked, 0);
});

test("the audit record is stored exactly as written: its schema does not change", async () => {
  const s = build();
  const rec = record();
  await s.audit(rec);
  const stored = [...s.backing.data.entries()].filter(([k]) => k.startsWith("audit:")).map(([, v]) => v);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], rec);
  assert.deepEqual(Object.keys(stored[0] as object).sort(), Object.keys(rec).sort());
});

test("the stored count holds no signature, URL or content", async () => {
  const s = build();
  await s.audit(record());
  const entries = [...s.backing.data.entries()].filter(([k]) => k.startsWith("pres:"));
  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]![1] as object).sort(), ["count", "first", "last", "order", "path", "ref", "until"]);
});

test("the alert is logged once, when the threshold is first crossed, and names no link", async () => {
  const warnings = captureWarnings();
  try {
    const s = build();
    for (let i = 0; i < THRESHOLD + 5; i++) await s.audit(record());
    assert.equal(warnings.lines.length, 1);
    const line = JSON.parse(warnings.lines[0]!) as Record<string, unknown>;
    assert.equal(line.replay_alert, "threshold-exceeded");
    assert.equal(line.order, "10008-S001");
    assert.equal(line.presentations, THRESHOLD + 1);
    assert.equal(line.threshold, THRESHOLD);
    for (const forbidden of [REF, "amk-ssot", "k1", "sig", "req-1"]) {
      assert.equal(warnings.lines[0]!.includes(forbidden), false, `the alert must not contain ${forbidden}`);
    }
  } finally {
    warnings.restore();
  }
});

test("a count is dropped once the link can no longer be presented", async () => {
  const s = build();
  await s.audit(record({ ts: 1_800_000_000 }));
  assert.equal((await s.report()).links_tracked, 1);
  // The sweep runs from the early gate. A request after `until` removes the entry.
  assert.equal((await s.gate(1_800_000_000 + KEEP + 1)).status, 200);
  assert.equal((await s.report()).links_tracked, 0);
});

test("a count that is still live survives the sweep", async () => {
  const s = build();
  await s.audit(record({ ts: 1_800_000_000 }));
  assert.equal((await s.gate(1_800_000_000 + KEEP - 1)).status, 200);
  assert.equal((await s.report()).links_tracked, 1);
});

test("if counting fails, the audit record is still written and the request is not failed", async () => {
  const warnings = captureWarnings();
  try {
    const s = build({ failPut: (key) => key.startsWith("pres:") });
    const response = await s.audit(record());
    assert.equal(response.status, 200);
    assert.equal([...s.backing.data.keys()].filter((k) => k.startsWith("audit:")).length, 1);
    assert.equal(warnings.lines.length, 1);
    assert.deepEqual(JSON.parse(warnings.lines[0]!), { replay_count: "failed" });
  } finally {
    warnings.restore();
  }
});

test("the report is counts and names only, most presented first", async () => {
  const s = build();
  for (let i = 0; i < THRESHOLD + 2; i++) await s.audit(record({ path: "amk/a.md" }));
  for (let i = 0; i < THRESHOLD + 5; i++) await s.audit(record({ path: "amk/b.md" }));
  const exceeded = (await s.report()).exceeded as Array<Record<string, unknown>>;
  assert.deepEqual(exceeded.map((e) => e.path), ["amk/b.md", "amk/a.md"]);
  for (const entry of exceeded) {
    assert.deepEqual(Object.keys(entry).sort(), ["first", "last", "order", "path", "presentations", "ref"]);
  }
});

// -- the status of one order (the link lifecycle's "status" operation)

async function status(s: ReturnType<typeof build>, order: string, now = 1_800_000_000) {
  const response = await s.state.fetch(
    new Request(`https://state.internal/order-status?order=${encodeURIComponent(order)}&now=${now}`),
  );
  return (await response.json()) as Record<string, unknown>;
}

test("an order that has presented nothing reports an empty, unrevoked status", async () => {
  const s = build();
  assert.deepEqual(await status(s, "10008-S001"), {
    order: "10008-S001",
    revoked: false,
    cooldown: { active: false, until: null },
    links_tracked: 0,
    links_repeated: 0,
    most_presented: 0,
    last_presented: null,
  });
});

test("an order's status counts its own links and not another order's", async () => {
  const s = build();
  for (let i = 0; i < 4; i++) await s.audit(record({ request_id: `a${i}` }));
  await s.audit(record({ path: "amk/other.md", ts: 1_800_000_050 }));
  await s.audit(record({ order: "10008-S002" }));
  const a = await status(s, "10008-S001");
  assert.equal(a.links_tracked, 2);
  assert.equal(a.links_repeated, 1);
  assert.equal(a.most_presented, 4);
  assert.equal(a.last_presented, 1_800_000_050);
  assert.equal((await status(s, "10008-S002")).links_tracked, 1);
  // 10008-S0010 starts with the same text as 10008-S001: a prefix match must not mix them up.
  await s.audit(record({ order: "10008-S0010" }));
  assert.equal((await status(s, "10008-S001")).links_tracked, 2);
});

test("an order's status reports a revocation and a cooldown", async () => {
  const s = build();
  await s.state.fetch(new Request("https://state.internal/revoke", { method: "POST", body: JSON.stringify({ order: "10008-S001" }) }));
  await s.backing.storage.put("cool:10008-S001", 1_800_000_300);
  const live = await status(s, "10008-S001", 1_800_000_100);
  assert.equal(live.revoked, true);
  assert.deepEqual(live.cooldown, { active: true, until: 1_800_000_300 });
  const over = await status(s, "10008-S001", 1_800_000_301);
  assert.deepEqual(over.cooldown, { active: false, until: null });
});

test("an order's status holds no path, commit or signature", async () => {
  const s = build();
  await s.audit(record());
  const text = JSON.stringify(await status(s, "10008-S001"));
  for (const forbidden of [REF, "amk-ssot", "k1", "req-1"]) assert.equal(text.includes(forbidden), false);
});
