// The single Durable Object class: coordination + in-memory staging (see docs/proposal/project-structure.md).
// STATUS: scaffold only. Present so wrangler.toml's binding and migration resolve.
export class TaskSession {
  constructor(readonly state: DurableObjectState, readonly env: unknown) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("ctxgate session: not implemented\n", { status: 501 });
  }
}
