// Platform-admin only: POST /api/platform/refresh-displays
// Body: { tenant: string } - a tenant slug, or the literal "all".
//
// "Refresh displays" round - closes the auth gap found in review: the
// Worker's own /refresh trigger is gated only by CAPTURE_KEY, a shared
// secret that ships in the PUBLIC client bundle (src/config/
// captureEndpoint.ts) so anyone can extract it and curl the endpoint
// directly. That's a deliberate, documented, low-stakes tradeoff for its
// original purpose (open a URL on a phone, no login, refresh PC2 - see
// that file's own comment) - fine for that one narrow use case, wrong
// for a general-purpose admin UI action that can reload every tenant's
// live screen platform-wide. This route is what a NEW admin-facing
// button actually calls: requirePlatformAdmin (same gate every other
// /platform/tenants route uses - session + user.developer, no
// dependency on org membership, see that helper's own comment) enforces
// a real authenticated session with a normal cookie, and CAPTURE_KEY
// only ever travels server-side from here to the Worker, via a Pages
// Functions environment secret - never present in this route's own
// response or reachable from the browser at all.
//
// Deliberately does NOT touch or rotate CAPTURE_KEY itself - PC2's own
// phone-bookmark shortcut (bare GET /refresh?key=...) and the other
// existing direct-from-browser callers (DesignPage.tsx, RunwaysPage.tsx)
// keep using the same public key exactly as before; this route is an
// ADDITIONAL, properly-gated path onto the same Worker trigger, not a
// replacement for the old one.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  // Same duplication as capture-refresh.ts/capture-logs.ts/ops-panel's
  // own comment - no shared util exists for this constant pair today.
  CAPTURE_KEY?: string;
}

const CAPTURE_WORKER_BASE = "https://shobdon-central-capture.jeffthompson.workers.dev";
const FALLBACK_CAPTURE_KEY = "49f761797d8e1fe76898e079b997980f";

const REFRESH_ALL_SENTINEL = "all";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requirePlatformAdmin(request, env);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as { tenant?: unknown } | null;
  if (typeof body?.tenant !== "string" || !body.tenant.trim()) {
    return jsonResponse({ error: "tenant (a slug, or \"all\") is required" }, 400);
  }
  const tenant = body.tenant.trim();

  // Validated here (not left to the Worker to silently no-op on a typo)
  // so a mistyped slug in the admin UI produces a clear 400 instead of
  // quietly flagging a KV key nothing will ever poll for.
  if (tenant !== REFRESH_ALL_SENTINEL) {
    const row = await env.DB
      .prepare("SELECT 1 FROM tenants WHERE slug = ? AND active = 1 AND deleted_at IS NULL")
      .bind(tenant)
      .first();
    if (!row) return jsonResponse({ error: `No active tenant with slug "${tenant}"` }, 404);
  }

  const key = env.CAPTURE_KEY || FALLBACK_CAPTURE_KEY;
  const upstream = await fetch(`${CAPTURE_WORKER_BASE}/refresh?key=${key}&tenant=${encodeURIComponent(tenant)}`).catch(() => null);
  if (!upstream || !upstream.ok) {
    return jsonResponse({ error: "Could not reach the capture worker" }, 502);
  }

  return jsonResponse({ ok: true, tenant });
};
