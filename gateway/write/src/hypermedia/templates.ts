/**
 * The link templates.
 *
 * The gateway hands out **root-relative** links: the path and query after the capability prefix,
 * always beginning with `/`. The agent resolves one as `its root URL + href`.
 *
 * The reason is in protocol section 4.4, rule 3: a link that carried the capability would put the
 * capability in every response body, and a body that carries the capability is a body that gets
 * logged.
 */
import { encodeComponent } from "../auth/root-url.ts";

/** One operation's link template. */
export interface LinkTemplate {
  /** The stable name of the relation. */
  rel: string;
  /** The operation the link invokes. */
  op: string;
  /** The parameters the link carries, when their values are known. */
  query?: Record<string, string | undefined>;
  /** The parameters the agent has to supply. */
  required?: string[];
}

/**
 * Build the root-relative href of a link.
 *
 * The query is built in a stable order, so that the same logical request always produces the same
 * href. That is what makes the derived idempotency key deterministic.
 */
export function href(template: LinkTemplate): string {
  const query = template.query ?? {};
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) continue;
    parts.push(`${encodeComponent(key)}=${encodeComponent(value)}`);
  }
  if (parts.length === 0) return `/${template.op}`;
  return `/${template.op}?${parts.join("&")}`;
}
