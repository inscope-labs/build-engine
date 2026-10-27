/**
 * The source adapter: reads exactly one blob at one pinned commit from the private repository.
 *
 * The call is the GitHub contents API (docs/decisions/0001, and the source-adapter design in
 * gateway/read/production/source-adapter/README.md):
 *
 *     GET {api_base}/repos/{slug}/contents/{path}?ref={sha}
 *
 * with the raw media type, so the body IS the file. The ref is always a 40-hex commit sha: the
 * rules layer has already refused anything else, so a moving ref never reaches this code.
 *
 * What this adapter must never do: fetch anything but the one named path at the one named
 * commit, follow a symlink, return a directory listing, or copy the content anywhere.
 */
import { encodePath } from "./scheme.ts";

export class NotFound extends Error {}
export class TooLarge extends Error {}
export class UpstreamError extends Error {}
export class UpstreamTimeout extends Error {}
export class UpstreamUnauthorized extends Error {}
export class UpstreamRateLimited extends Error {}

export interface Source {
  read(ref: string, path: string): Promise<Uint8Array>;
}

export interface GitHubSourceConfig {
  apiBase: string;
  repo: string;
  token: string;
  maxBytes: number;
  timeoutMs: number;
}

export class GitHubContentsSource implements Source {
  constructor(private readonly config: GitHubSourceConfig) {}

  async read(ref: string, path: string): Promise<Uint8Array> {
    const url = `${this.config.apiBase.replace(/\/$/, "")}/repos/${this.config.repo}/contents/${encodePath(path)}?ref=${ref}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ctxgate-read",
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") throw new UpstreamTimeout(err.message);
      throw new UpstreamError(err.message);
    }
    if (response.status === 404) throw new NotFound("not found");
    if (response.status === 401 || response.status === 403) throw new UpstreamUnauthorized("upstream refused the credential");
    if (response.status === 429) throw new UpstreamRateLimited("upstream rate limited");
    if (!response.ok) throw new UpstreamError(`upstream returned ${response.status}`);
    // A directory is returned as JSON, not as a blob. It is not the named file, so it is not
    // found. This is the guard that stops the adapter from ever serving a listing.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) throw new NotFound("not a blob");
    return this.readBounded(response);
  }

  /** Read at most maxBytes, and stop as soon as the limit is passed. */
  private async readBounded(response: Response): Promise<Uint8Array> {
    if (!response.body) {
      const buf = new Uint8Array(await response.arrayBuffer());
      if (buf.length > this.config.maxBytes) throw new TooLarge("too large");
      return buf;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > this.config.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TooLarge("too large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
