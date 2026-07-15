// Authenticated proxy for triggering a remote PC2 refresh.
// GET /api/tenant/capture-refresh[?org=slug]
//
// Same fix/reasoning as capture-logs.ts (see that file's comment) applied
// to the "Refresh PC2 Now" button specifically - requires an owner/admin
// session and injects CAPTURE_KEY server-side, so it's never present in
// this route's own URL or visible to the browser. Deliberately narrow:
// the OTHER, pre-existing fetch(REFRESH_TRIGGER_URL) call sites (DesignPage,
// AtcControlPage, RunwaysPage - each triggering a refresh as a side effect
// of an unrelated save action, not a user-facing link/button of their own)
// are out of scope for this change and still call the worker directly.

import { requireOwner, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  CAPTURE_KEY?: string;
}

const CAPTURE_WORKER_BASE = "https://shobdon-central-capture.jeffthompson.workers.dev";
const FALLBACK_CAPTURE_KEY = "49f761797d8e1fe76898e079b997980f";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if ("error" in auth) return auth.error;

  const key = env.CAPTURE_KEY || FALLBACK_CAPTURE_KEY;
  const upstream = await fetch(`${CAPTURE_WORKER_BASE}/refresh?key=${key}`).catch(() => null);
  if (!upstream) {
    return new Response(JSON.stringify({ error: "Could not reach the capture worker" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "text/plain",
      "Cache-Control": "no-store",
    },
  });
};
