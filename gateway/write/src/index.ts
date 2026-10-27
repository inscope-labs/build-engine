/**
 * The Worker entry point.
 *
 * The Worker does the parts of the request that need the edge: it authenticates the capability,
 * it enforces the expiry and the maximum lifetime, and it routes. Everything else happens in the
 * Durable Object, which is where the session's state lives.
 *
 * The Worker answers `501` to nothing any more: every route in the contract either works or
 * answers with a documented error. The `commit` route delivers to the provider; the delivery
 * happens inside the Durable Object, because the session's state and the commit's outcome have to
 * change together.
 */
import { loadConfig, ConfigError, type Env } from "./config/env.ts";
import { handleRequest } from "./router.ts";
import { errorResponse } from "./http/responses.ts";
import { textHeaders } from "./http/headers.ts";
import { PROTOCOL } from "./config/constants.ts";
import { newRequestId } from "./audit/logger.ts";

// The Durable Object classes must be exported from the entrypoint so that the runtime can bind
// them.
export { TaskSession } from "./session/task-session.ts";
export { AuditStream } from "./audit/audit-stream.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = newRequestId();

    let config;
    try {
      config = loadConfig(env);
    } catch (e) {
      // A misconfigured gateway fails closed. It says what is wrong to the operator, because a
      // gateway that cannot serve a request must still be diagnosable, and it serves nothing.
      const message = e instanceof ConfigError ? e.message : "configuration error";
      return new Response(`gateway misconfigured: ${message}\n`, {
        status: 503,
        headers: textHeaders(requestId),
      });
    }

    try {
      return await handleRequest({ request, env, config, requestId });
    } catch {
      // Nothing that escapes the router is allowed to become a stack trace in a response: a
      // stack trace carries paths and values.
      const base = new URL(request.url).origin;
      return errorResponse(requestId, 503, {
        op: "unknown",
        task: null,
        order: null,
        state: null,
        base,
        error: { code: "state-unavailable", message: "the gateway could not serve the request", retryable: true },
      });
    }
  },
};

export { PROTOCOL };
