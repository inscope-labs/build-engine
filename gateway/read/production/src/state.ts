/**
 * The gateway's state: the revocation set, the audit trail and the rate-limit counters.
 *
 * A Durable Object is used rather than KV because revocation must take effect immediately.
 * A capability that has been revoked has to stop working at once; a KV read with a
 * propagation delay would leave a window in which a revoked link still served a file.
 *
 * The object is a singleton: one instance named "state" holds everything.
 */
import type { AuditRecord } from "./audit.ts";
import { isAuthenticatedRefusal } from "./audit.ts";

export interface GateRequest {
  ip: string;
  now: number;
  windowSeconds: number;
  limits: { perIp: number; global: number };
}

export interface GateResult {
  action: "allow" | "rate-limited";
  reason: string;
  attempts: number;
}

export interface RefusalLimits {
  /** How many authenticated refusals an order may have in a window before it is cooled down. */
  burst: number;
  /** How long the order is cooled down, in seconds. */
  cooldownSeconds: number;
}

export interface ApplyRequest {
  order: string;
  now: number;
  windowSeconds: number;
  perOrderLimit: number;
}

export interface ApplyResult {
  action: "allow" | "rate-limited" | "revoked" | "cooldown";
  reason: string;
}

const REVOKED_KEY = "revoked";
const SEQ_KEY = "seq";
const AUDIT_PREFIX = "audit:";
const WINDOW_SECONDS = 60;
const PRESENTATION_PREFIX = "pres:";

/** What the gateway keeps about one link's presentations (R-1.d). No signature, no URL, no content. */
export interface Presentation {
  order: string;
  ref: string;
  path: string;
  count: number;
  first: number;
  last: number;
  /** When the entry is no longer needed: the link cannot be presented after this. */
  until: number;
}

export interface ReplaySettings {
  /** Presentations of one link above which it is reported. */
  threshold: number;
  /** How long to keep the entry: the longest a link can live. */
  keepSeconds: number;
}

export class GatewayState {
  private readonly state: DurableObjectState;

  // A plain assignment, not a parameter property: the unit tests run this file under Node's
  // type-stripping mode, which does not support parameter properties. The behaviour is the same.
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/gate":
          return Response.json(await this.gate((await request.json()) as GateRequest));
        case "/apply":
          return Response.json(await this.apply((await request.json()) as ApplyRequest));
        case "/revoke": {
          const body = (await request.json()) as { order: string };
          await this.revoke(body.order);
          return Response.json({ revoked: body.order });
        }
        case "/audit": {
          if (request.method === "POST") {
            const body = (await request.json()) as {
              record: AuditRecord;
              retention?: number;
              limits?: RefusalLimits;
              replay?: ReplaySettings;
            };
            this.retention = body.retention ?? this.retention;
            await this.appendAudit(body.record);
            await this.countRefusal(body.record, body.limits ?? { burst: 30, cooldownSeconds: 300 });
            await this.countPresentation(body.record, body.replay ?? { threshold: 10, keepSeconds: 259_200 + 120 });
            return Response.json({ written: 1 });
          }
          return new Response(await this.auditRecords(), {
            headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
          });
        }
        case "/order-status": {
          const order = url.searchParams.get("order") ?? "";
          const now = Number(url.searchParams.get("now") ?? "0");
          return Response.json(await this.orderStatus(order, Number.isFinite(now) ? now : 0));
        }
        case "/replay": {
          const threshold = Number(url.searchParams.get("threshold") ?? "10");
          return Response.json(await this.replayReport(Number.isFinite(threshold) && threshold >= 1 ? threshold : 10));
        }
        case "/metrics":
          return Response.json(await this.metrics());
        default:
          return new Response("not found", { status: 404 });
      }
    } catch (e) {
      return new Response(`state error: ${(e as Error).message}`, { status: 500 });
    }
  }

  // -- revocation
  private async revoked(): Promise<Set<string>> {
    const raw = (await this.state.storage.get(REVOKED_KEY)) as string[] | undefined;
    return new Set(raw ?? []);
  }

  private async revoke(order: string): Promise<void> {
    const set = await this.revoked();
    set.add(order);
    await this.state.storage.put(REVOKED_KEY, [...set].sort());
  }

  private async isRevoked(order: string): Promise<boolean> {
    return (await this.revoked()).has(order);
  }

  // -- counters
  private async bump(key: string): Promise<number> {
    const current = ((await this.state.storage.get(key)) as number | undefined) ?? 0;
    const next = current + 1;
    await this.state.storage.put(key, next);
    return next;
  }

  /**
   * Sweep the expired rate-limit windows. The Durable Object storage has no per-key expiry, so
   * the windows are removed by hand. The sweep runs at most once a minute, when the window
   * turns over, and it only ever touches the counter prefixes.
   */
  private async sweep(now: number): Promise<void> {
    const window = Math.floor(now / WINDOW_SECONDS);
    const last = ((await this.state.storage.get("lastSweep")) as number | undefined) ?? -1;
    if (last === window) return;
    const cutoff = window - 2;
    for (const prefix of ["ip:", "bud:", "ref:", "glob:"]) {
      const listed = await this.state.storage.list({ prefix });
      for (const key of listed.keys()) {
        const tail = key.slice(key.lastIndexOf(":") + 1);
        const w = Number(tail);
        if (Number.isFinite(w) && w < cutoff) await this.state.storage.delete(key);
      }
    }
    // A link's presentation count is kept only as long as the link can still be presented.
    const presentations = await this.state.storage.list({ prefix: PRESENTATION_PREFIX });
    for (const [key, value] of presentations.entries()) {
      const until = (value as Presentation | undefined)?.until;
      if (typeof until !== "number" || until < now) await this.state.storage.delete(key);
    }
    // The cooldowns are timestamps, not windows: one is removed when it has run out.
    const cooldowns = await this.state.storage.list({ prefix: "cool:" });
    for (const [key, value] of cooldowns.entries()) {
      const until = value as number | undefined;
      if (typeof until !== "number" || until < now) await this.state.storage.delete(key);
    }
    await this.state.storage.put("lastSweep", window);
  }

  /**
   * The early gate. It runs before the link is even parsed, so a flood of forged or malformed
   * requests is bounded before any work is done on them.
   *
   * It counts requests per IP and globally. It knows nothing about an order: the order in an
   * unverified link is a string the caller chose, so counting against it would let a forger
   * spend somebody else's budget.
   */
  private async gate(req: GateRequest): Promise<GateResult> {
    await this.sweep(req.now);
    const window = Math.floor(req.now / WINDOW_SECONDS);

    const ip = await this.bump(`ip:${req.ip}:${window}`);
    const global = await this.bump(`glob:${window}`);
    if (ip > req.limits.perIp) {
      return { action: "rate-limited", reason: "rate-limited", attempts: ip };
    }
    if (global > req.limits.global) {
      return { action: "rate-limited", reason: "rate-limited", attempts: global };
    }
    return { action: "allow", reason: "ok", attempts: ip };
  }

  /**
   * The late gate. It runs only after the link has proved itself: the signature is valid, the
   * link is live and within its lifetime. It then checks the order's request budget, the order's
   * abuse cooldown and the revocation list.
   *
   * It does NOT write the audit record. The record carries the final outcome, which is not
   * known until the file has been read, so it is written by a separate call at the end.
   */
  private async apply(req: ApplyRequest): Promise<ApplyResult> {
    if (await this.isRevoked(req.order)) {
      return { action: "revoked", reason: "revoked" };
    }
    const window = Math.floor(req.now / WINDOW_SECONDS);

    // The abuse cooldown comes first: an order in a cooldown is answered with 429 whatever else
    // is true of the request, and it must not be able to spend its own budget while it cools.
    const until = (await this.state.storage.get(`cool:${req.order}`)) as number | undefined;
    if (typeof until === "number" && req.now < until) {
      return { action: "cooldown", reason: "cooldown" };
    }

    const spent = await this.bump(`bud:${req.order}:${window}`);
    if (spent > req.perOrderLimit) {
      return { action: "rate-limited", reason: "rate-limited" };
    }
    return { action: "allow", reason: "ok" };
  }

  // -- the audit trail
  private async appendAudit(record: AuditRecord): Promise<void> {    const seq = ((await this.state.storage.get(SEQ_KEY)) as number | undefined) ?? 0;
    await this.state.storage.put(`${AUDIT_PREFIX}${String(seq).padStart(8, "0")}`, record);
    await this.state.storage.put(SEQ_KEY, seq + 1);
    await this.trimAudit();
  }

  /**
   * Count a refusal against its order, and put the order in a cooldown when it has refused too
   * many times.
   *
   * Only refusals that happened after the signature was verified are counted: those are the ones
   * that say something about the order. A refusal that happened before the signature (a bad
   * signature, an unknown key) is counted against the caller's IP and against the global budget,
   * never against an order the caller named in a link it could not prove.
   */
  private async countRefusal(record: AuditRecord, limits: RefusalLimits): Promise<void> {
    if (!isAuthenticatedRefusal(record.reason)) return;
    if (!record.order || record.order === "-") return;
    const window = Math.floor(record.ts / WINDOW_SECONDS);
    const refusals = await this.bump(`ref:${record.order}:${window}`);
    if (refusals > limits.burst) {
      await this.state.storage.put(`cool:${record.order}`, record.ts + limits.cooldownSeconds);
    }
  }

  /**
   * Count a presentation of a link (GAP R-1, option R-1.d, ADR 0010).
   *
   * Every request that proved its link and was served is one presentation of that link. The link
   * is identified by what it names: the order, the commit and the path. Nothing prevents a second
   * presentation; the count only makes it visible, and the operator's threshold is the tripwire.
   *
   * Only served requests are counted (`reason: "ok"`). A refusal is not a presentation that
   * returned content, and a refusal before the signature says nothing about an order.
   * The audit record's schema does not change: this reads fields it already has.
   *
   * Counting must never fail a request: if it cannot be done, the audit write still stands and
   * the gateway says so in the platform log, without any link data.
   */
  private async countPresentation(record: AuditRecord, replay: ReplaySettings): Promise<void> {
    if (record.reason !== "ok" || record.status !== 200) return;
    if (!record.order || record.order === "-" || !record.ref || record.ref === "-" || !record.path || record.path === "-") return;
    try {
      const key = `${PRESENTATION_PREFIX}${record.order}:${record.ref}:${encodeURIComponent(record.path)}`;
      const existing = (await this.state.storage.get(key)) as Presentation | undefined;
      const entry: Presentation = {
        order: record.order,
        ref: record.ref,
        path: record.path,
        count: (existing?.count ?? 0) + 1,
        first: existing?.first ?? record.ts,
        last: record.ts,
        until: record.ts + replay.keepSeconds,
      };
      await this.state.storage.put(key, entry);
      if (entry.count === replay.threshold + 1) {
        // Said once, when the threshold is first crossed. It names the order and the count only.
        console.warn(JSON.stringify({ replay_alert: "threshold-exceeded", order: entry.order, presentations: entry.count, threshold: replay.threshold }));
      }
    } catch {
      console.warn(JSON.stringify({ replay_count: "failed" }));
    }
  }

  /**
   * Where one order stands: revoked or not, in a cooldown or not, and how its links have been
   * presented. Counts and a flag only: no path, no commit, no signature.
   */
  private async orderStatus(order: string, now: number): Promise<Record<string, unknown>> {
    const revoked = await this.isRevoked(order);
    const until = (await this.state.storage.get(`cool:${order}`)) as number | undefined;
    const listed = await this.state.storage.list({ prefix: `${PRESENTATION_PREFIX}${order}:` });
    let repeated = 0;
    let most = 0;
    let last: number | null = null;
    for (const value of listed.values()) {
      const entry = value as Presentation;
      if (entry.count >= 2) repeated += 1;
      if (entry.count > most) most = entry.count;
      if (last === null || entry.last > last) last = entry.last;
    }
    const cooling = typeof until === "number" && now < until;
    return {
      order,
      revoked,
      cooldown: { active: cooling, until: cooling ? until : null },
      links_tracked: listed.size,
      links_repeated: repeated,
      most_presented: most,
      last_presented: last,
    };
  }

  /** The links presented more than the threshold, most presented first. Counts and names only. */
  private async replayReport(threshold: number): Promise<Record<string, unknown>> {
    const listed = await this.state.storage.list({ prefix: PRESENTATION_PREFIX });
    const exceeded: Array<Record<string, unknown>> = [];
    let repeated = 0;
    for (const value of listed.values()) {
      const entry = value as Presentation;
      if (entry.count >= 2) repeated += 1;
      if (entry.count > threshold) {
        exceeded.push({ order: entry.order, ref: entry.ref, path: entry.path, presentations: entry.count, first: entry.first, last: entry.last });
      }
    }
    exceeded.sort((a, b) => (b.presentations as number) - (a.presentations as number));
    return {
      note: "a replay is not prevented: this reports presentations of one link above the threshold (GAP R-1, accepted, ADR 0010)",
      threshold,
      links_tracked: listed.size,
      links_repeated: repeated,
      exceeded,
    };
  }

  /** The trail is a bounded ring, not an archive. Retention is documented in ops/limits.md. */
  private async trimAudit(): Promise<void> {
    const listed = await this.state.storage.list({ prefix: AUDIT_PREFIX });
    const keys = [...listed.keys()].sort();
    const excess = keys.length - this.retention;
    for (let i = 0; i < excess; i++) await this.state.storage.delete(keys[i]!);
  }

  private retention = 500;

  setRetention(n: number): void {
    this.retention = n;
  }

  private async auditRecords(): Promise<string> {
    const listed = await this.state.storage.list({ prefix: AUDIT_PREFIX });
    const keys = [...listed.keys()].sort();
    const out: string[] = [];
    for (const key of keys) {
      const record = (await this.state.storage.get(key)) as AuditRecord | undefined;
      if (record) out.push(JSON.stringify(record));
    }
    return out.length ? out.join("\n") + "\n" : "";
  }

  /** Counters for the operator. No order, no path, no key id: counts only. */
  private async metrics(): Promise<Record<string, unknown>> {
    const revoked = await this.revoked();
    const listed = await this.state.storage.list({ prefix: AUDIT_PREFIX });
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const key of listed.keys()) {
      const record = (await this.state.storage.get(key)) as AuditRecord | undefined;
      if (!record) continue;
      byStatus[String(record.status)] = (byStatus[String(record.status)] ?? 0) + 1;
      byReason[record.reason] = (byReason[record.reason] ?? 0) + 1;
    }
    const presented = await this.state.storage.list({ prefix: PRESENTATION_PREFIX });
    let repeatedLinks = 0;
    for (const value of presented.values()) if (((value as Presentation).count ?? 0) >= 2) repeatedLinks += 1;
    return {
      revoked_orders: revoked.size,
      links_tracked: presented.size,
      links_repeated: repeatedLinks,
      audit_records: listed.size,
      by_status: byStatus,
      by_reason: byReason,
    };
  }
}
