/**
 * The audit stream: a durable, queryable copy of the audit records for one order.
 *
 * The platform's log is the **complete** stream — every request writes exactly one line there,
 * and the operator's log retention decides how long it is kept (protocol section 10.2). This
 * Durable Object is the **durable** copy: it survives a log pipeline that samples, it is
 * queryable over HTTP by the operator, and it is what the runbook's procedures read.
 *
 * Three properties matter more than the storage:
 *
 *  - **The Durable Object does not trust the record it is handed.** It rebuilds the record from
 *    the fields it is handed, through the same fixed-schema gate the platform log uses, and it
 *    refuses to store a record that still contains something that looks like a secret. A bug in
 *    the Worker, or a compromised one, cannot put a capability into the durable stream.
 *  - **The retention is bounded and the operator's.** The oldest records are pruned by age, and
 *    the window is a setting. An unbounded audit log is a disk-filling denial of service.
 *  - **The requests that never authenticated are not here.** A request with no valid capability
 *    has no order, and an order's stream is about that order. Those refusals are counted in the
 *    metrics and appear in the platform's log, which is where an operator watches for abuse.
 */
import { auditRecord, containsSecret, type AuditFields } from "./redaction.ts";
import type { Env } from "../config/env.ts";
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_DEFAULT_RETENTION_SECONDS,
  AUDIT_MAX_LIMIT,
  AUDIT_MAX_RETENTION_SECONDS,
  type AuditQuery,
  type AuditRecord,
} from "../types/audit.ts";

/** The prefix of a record key. */
const RECORD_PREFIX = "r:";

/** The Durable Object that holds one order's audit stream. */
export class AuditStream {
  /** The Durable Object state. */
  private readonly state: DurableObjectState;
  /** The environment. The runtime passes it as the second constructor argument. */
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/record" && request.method === "POST") {
      return this.record(request);
    }
    if (url.pathname === "/records" && request.method === "GET") {
      return this.records(url);
    }
    return new Response("not found\n", { status: 404 });
  }

  /**
   * Append one record.
   *
   * The fields are rebuilt here, not taken. The rebuild is the gate.
   */
  private async record(request: Request): Promise<Response> {
    let fields: AuditFields;
    try {
      fields = (await request.json()) as AuditFields;
    } catch {
      return new Response("bad request\n", { status: 400 });
    }
    if (typeof fields?.ts !== "number" || typeof fields?.request_id !== "string") {
      return new Response("bad request\n", { status: 400 });
    }

    const rebuilt = auditRecord(fields) as unknown as AuditRecord;

    // The second gate: even after the schema has been applied, nothing that looks like a secret
    // may be stored. A schema is a strong gate; this is the backstop.
    if (containsSecret(JSON.stringify(rebuilt))) {
      return new Response("refused\n", { status: 422 });
    }

    const key = recordKey(rebuilt);
    await this.state.storage.put(key, rebuilt);
    await this.prune(rebuilt.ts);
    return new Response("ok\n", { status: 200 });
  }

  /**
   * The records, most recent last.
   *
   * The query is bounded twice: by the age the operator asked for, and by the count. A query
   * that could return everything is a query that can take the instance down.
   */
  private async records(url: URL): Promise<Response> {
    const query: AuditQuery = {
      since: optionalNumber(url.searchParams.get("since")),
      limit: optionalNumber(url.searchParams.get("limit")),
    };
    const limit = Math.min(Math.max(1, query.limit ?? AUDIT_DEFAULT_LIMIT), AUDIT_MAX_LIMIT);
    const since = query.since ?? 0;

    const stored = await this.state.storage.list<AuditRecord>({
      prefix: RECORD_PREFIX,
      limit: AUDIT_MAX_LIMIT,
      reverse: true,
    });

    const records: AuditRecord[] = [];
    for (const record of stored.values()) {
      if (record.ts < since) continue;
      records.push(record);
    }
    records.sort((a, b) => a.ts - b.ts);
    return Response.json(records.slice(-limit));
  }

  /**
   * Prune the records that have aged out.
   *
   * The oldest key is the one that sorts first, so one listing of one key is enough to find it,
   * and the loop deletes only what has aged out. A write usually deletes nothing.
   */
  private async prune(now: number): Promise<void> {
    const retention = this.retentionSeconds();
    const cutoff = now - retention;
    for (let i = 0; i < 1000; i++) {
      const oldest = await this.state.storage.list<AuditRecord>({ prefix: RECORD_PREFIX, limit: 1 });
      if (oldest.size === 0) return;
      const key = [...oldest.keys()][0]!;
      const record = oldest.get(key)!;
      if (record.ts >= cutoff) return;
      await this.state.storage.delete(key);
    }
  }

  /**
   * The retention window.
   *
   * The setting is read from the environment the Durable Object was given, and the bound is
   * applied here: a retention of a hundred years is a disk-filling denial of service with extra
   * steps.
   */
  private retentionSeconds(): number {
    const raw = this.env.AUDIT_RETENTION_SECONDS;
    const parsed = raw === undefined ? NaN : Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return AUDIT_DEFAULT_RETENTION_SECONDS;
    return Math.min(parsed, AUDIT_MAX_RETENTION_SECONDS);
  }
}

/**
 * The key of a record.
 *
 * The timestamp sorts first, so the oldest record is the first key, and the request id breaks
 * the tie between two records in the same second. The request id is already unique and it is
 * already in the record.
 */
function recordKey(record: AuditRecord): string {
  return `${RECORD_PREFIX}${String(record.ts).padStart(12, "0")}:${record.request_id}`;
}

/** A query parameter that is a number, or undefined. */
function optionalNumber(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
