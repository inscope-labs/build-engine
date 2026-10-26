// Worker entry. STATUS: scaffold only. Every request answers 501 until the router exists.
export { TaskSession } from "./session/task-session";

export default {
  async fetch(): Promise<Response> {
    return new Response("ctxgate: not implemented\n", {
      status: 501,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
