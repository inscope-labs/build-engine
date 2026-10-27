/**
 * The next-step links (protocol section 4.4).
 *
 * > **Links.** Every success response carries next-step links. Agents follow them and never
 * > construct URLs from memory.
 *
 * The rules, in code:
 *
 *  1. every successful response carries `links.next`, except in the `sealed` state, where the only
 *     legal next step is to stop;
 *  2. a link is `{rel, op, href, required}`;
 *  3. a link never contains the capability — it is root-relative;
 *  4. the gateway does not offer a link to an operation that is not legal in the current state:
 *     `seal` is not offered before a successful commit, and nothing is offered after a seal;
 *  5. a link's `href` never contains a parameter value the agent has not been told. Where the
 *     value is unknown, the parameter is listed in `required` instead.
 */
import { href, type LinkTemplate } from "./templates.ts";
import type { Link } from "../types/responses.ts";
import type { Operation } from "../config/constants.ts";
import type { SessionState } from "../types/session.ts";

/** What the link builder needs to know about the session. */
export interface LinkContext {
  /** The operation that was just performed. */
  op: Operation;
  /** The session state. */
  state: SessionState;
  /** Whether the task has a successful commit. */
  committed: boolean;
  /** The path the operation was about, when it was about one. */
  path?: string | undefined;
}

/** The parameters each operation needs from the agent. */
const REQUIRED: Record<string, string[]> = {
  index: [],
  status: [],
  create: ["path"],
  append: ["path", "seq", "hash", "data"],
  replace: ["path", "seq", "hash", "data"],
  read: ["path"],
  delete: ["path"],
  commit: ["files"],
  seal: [],
};

/**
 * The links for a response.
 *
 * The set is derived from the state, not from the operation alone: the same operation offers
 * different next steps depending on whether the task has committed and whether it is sealed.
 */
export function nextLinks(ctx: LinkContext): Link[] {
  if (ctx.state === "sealed") return [];

  const templates: LinkTemplate[] = [];
  const path = ctx.path;

  // Every open session may look at itself and may scaffold a file.
  if (ctx.op !== "status") templates.push({ rel: "status", op: "status" });

  if (ctx.op === "index" || ctx.op === "status" || ctx.op === "create" || ctx.op === "delete") {
    templates.push({ rel: "create", op: "create" });
  }

  // The file-scoped links only make sense when the operation was about a file.
  if (path !== undefined && path !== "") {
    templates.push({ rel: "read", op: "read", query: { path } });
    templates.push({ rel: "append", op: "append", query: { path } });
    templates.push({ rel: "replace", op: "replace", query: { path } });
    templates.push({ rel: "delete", op: "delete", query: { path } });
  }

  // A commit is legal in an open session. A seal is only legal once there is something committed.
  templates.push({ rel: "commit", op: "commit" });
  if (ctx.committed) templates.push({ rel: "seal", op: "seal" });

  return templates.map((template) => ({
    rel: template.rel,
    op: template.op as Operation,
    href: href(template),
    required: [...(template.required ?? REQUIRED[template.op] ?? [])],
  }));
}
