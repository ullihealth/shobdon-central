// Platform-admin only: POST /api/platform/force-pilot-update
// Body: { tenant: string } - a tenant slug, or the literal "all".
//
// "Force Pilot App update" - asks every Pilot's App that is currently open for
// that tenant (on the new code) to update itself: show "Updating to the latest
// version…", fetch the newest service worker, activate it and reload, once.
// Open apps see it within about a minute (their 60 s tick / return to
// foreground); an app that is closed simply loads the latest on next open.
//
// Reuses the existing refresh-flag mechanism rather than a new channel: the
// SAME capture-Worker KV flag RemoteRefreshWatcher / refresh-displays.ts use for
// the dashboards, under a separate tenant key `pilot:<slug>` (the Worker stores
// any tenant string, and its read side is non-consuming, so any number of open
// apps can read it). "Refresh displays" therefore never touches /pilot and this
// never touches the dashboards. "all" is fanned out HERE (one flag per active
// tenant) because the Worker's own "all" sentinel only writes the plain
// dashboard keys.
//
// requirePlatformAdmin, like refresh-displays.ts; CAPTURE_KEY only ever travels
// server-side from here to the Worker.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  CAPTURE_KEY?: string;
}

const CAPTURE_WORKER_BASE = "https://shobdon-central-capture.jeffthompson.workers.dev";
const FALLBACK_CAPTURE_KEY = "49f761797d8e1fe76898e079b997980f";
const FORCE_ALL_SENTINEL = "all";

async function setPilotFlag(key: string, slug: string): Promise<boolean> {
  const response = await fetch(`${CAPTURE_WORKER_BASE}/refresh?key=${key}&tenant=${encodeURIComponent(`pilot:${slug}`)}`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  return !!response && response.ok;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requirePlatformAdmin(request, env);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as { tenant?: unknown } | null;
  if (typeof body?.tenant !== "string" || !body.tenant.trim()) {
    return jsonResponse({ error: "tenant (a slug, or \"all\") is required" }, 400);
  }
  const tenant = body.tenant.trim();
  const key = env.CAPTURE_KEY || FALLBACK_CAPTURE_KEY;

  let slugs: string[];
  if (tenant === FORCE_ALL_SENTINEL) {
    const { results } = await env.DB
      .prepare("SELECT slug FROM tenants WHERE active = 1 AND deleted_at IS NULL")
      .all<{ slug: string }>();
    slugs = results.map((row) => row.slug);
  } else {
    const row = await env.DB
      .prepare("SELECT 1 FROM tenants WHERE slug = ? AND active = 1 AND deleted_at IS NULL")
      .bind(tenant)
      .first();
    if (!row) return jsonResponse({ error: `No active tenant with slug "${tenant}"` }, 404);
    slugs = [tenant];
  }

  const outcomes = await Promise.all(slugs.map((slug) => setPilotFlag(key, slug)));
  const failed = outcomes.filter((ok) => !ok).length;
  if (failed > 0) {
    return jsonResponse({ error: `Could not reach the capture worker for ${failed} of ${slugs.length} tenant(s)`, flagged: slugs.length - failed }, 502);
  }
  return jsonResponse({ ok: true, tenant, flagged: slugs.length });
};
