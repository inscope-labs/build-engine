/**
 * The state channel: the Durable Object that holds the revocation set, the audit ring and the
 * rate-limit counters.
 *
 * **The channel fails closed.** A gateway that cannot read the revocation list cannot know
 * whether an order has been revoked, and a gateway that cannot read the counters cannot know
 * whether a budget has been spent. In both cases the only safe answer is "no": the request is
 * refused with 503 and the reason `state-unavailable`. A gateway that treats an unreadable
 * state store as an empty one serves revoked capabilities, and it serves them silently.
 *
 * That is the difference between "there is no revocation" and "I could not read the
 * revocations". The first is a fact the store can answer; the second is an absence of
 * information, and an absence of information is not consent.
 *
 * The channel is also where the audit record is written, so a state-store outage is the one
 * situation in which the request cannot be recorded in the ring. The record is written to the
 * platform log instead, so that a refusal during an outage is not lost. The record holds no
 * signature, no secret and no content: it is the same record the ring would have held.
 */
import type { AuditRecord } from "./audit.ts";
import type { Policy } from "./policy.ts";

/** What the state store was asked and what it answered. */
export interface StateDecision {
  action: string;
  reason: string;
}

/** The state channel, as the rules layer sees it. */
export interface StateClient {
  /** The early abuse gate: per-IP and global budgets. */
  gate(ip: string, now: number): Promise<StateDecision>;
  /** The late gate: revocation, the order's request budget and its abuse cooldown. */
  apply(order: string, now: number): Promise<StateDecision>;
  /** Write the final audit record. */
  audit(record: AuditRecord): Promise<void>;
}

/**
 * The action reported when the state store cannot answer. It is not "allow": the rules layer
 * refuses the request with 503 when it sees this.
 */
export const STATE_UNAVAILABLE = "state-unavailable";

/** The parts of the Worker environment the state channel needs. */
export interface StateBinding {
  STATE: DurableObjectNamespace;
}

/**
 * Build the state channel over the Durable Object.
 *
 * The object is a singleton named "state": it holds the revocation set, the audit ring and the
 * counters, and it is the only place any of them live.
 */
export function buildStateClient(env: StateBinding, policy: Policy): StateClient {
  const stub = env.STATE.get(env.STATE.idFromName("state"));

  const call = async (path: string, body: unknown): Promise<StateDecision> => {
    let response: Response;
    try {
      response = await stub.fetch("https://state.internal" + path, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch {
      // The object could not be reached at all. Fail closed.
      return { action: STATE_UNAVAILABLE, reason: STATE_UNAVAILABLE };
    }
    if (!response.ok) {
      // The object answered with an error. It may hold revocations this gateway cannot read.
      // Fail closed.
      return { action: STATE_UNAVAILABLE, reason: STATE_UNAVAILABLE };
    }
    try {
      return (await response.json()) as StateDecision;
    } catch {
      return { action: STATE_UNAVAILABLE, reason: STATE_UNAVAILABLE };
    }
  };

  return {
    async gate(ip, now) {
      return call("/gate", {
        ip,
        now,
        windowSeconds: 60,
        limits: {
          perIp: policy.rateLimitPerIp,
          global: policy.rateLimitGlobal,
        },
      });
    },
    async apply(order, now) {
      return call("/apply", {
        order,
        now,
        windowSeconds: 60,
        perOrderLimit: policy.rateLimitPerOrder,
      });
    },
    async audit(record) {
      try {
        const response = await stub.fetch("https://state.internal/audit", {
          method: "POST",
          body: JSON.stringify({
            record,
            retention: policy.auditRetention,
            limits: {
              burst: policy.refusalBurst,
              cooldownSeconds: policy.refusalCooldownSeconds,
            },
          }),
        });
        if (!response.ok) throw new Error("the state store refused the audit record");
      } catch {
        // The ring is unreachable. The record goes to the platform log instead: a refusal
        // during a state-store outage must not be lost, and the record holds nothing that must
        // not be logged.
        console.log(JSON.stringify({ audit_fallback: "platform-log", record }));
      }
    },
  };
}

/**
 * The operator channel: revoke an order, read the audit trail, read the metrics.
 *
 * Every call here reports what the state store actually confirmed. A revoke that the store did
 * not accept is reported as a failure, never as a success: an operator who is told "revoked"
 * will stop watching that order, and a silent failure here is a capability that stays alive.
 */
export async function callStateAdmin(
  env: StateBinding,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ ok: true; response: Response } | { ok: false; status: number; message: string }> {
  const stub = env.STATE.get(env.STATE.idFromName("state"));
  let response: Response;
  try {
    response = await stub.fetch("https://state.internal" + path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    return { ok: false, status: 503, message: "the state store could not be reached" };
  }
  if (!response.ok) {
    return { ok: false, status: 503, message: "the state store refused the request" };
  }
  return { ok: true, response };
}
