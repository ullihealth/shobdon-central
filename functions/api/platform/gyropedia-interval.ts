// Developer-only: GET/PUT /api/platform/gyropedia-interval
//
// Same requireDeveloper + platform_settings shape as this exact page's
// sibling landing-mode.ts - genuinely cross-tenant/platform-wide (no
// organizationId anywhere in this file), since the Gyropedia feed
// itself is one shared UK-wide dataset, not tenant-specific content.
// Consumed by DeveloperToolsPage.tsx's own toggle card and by
// functions/api/public/gyropedia-departures.ts's freshness check.
import { requireDeveloper, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const SETTING_KEY = "gyropedia_refresh_interval_minutes";
const ALLOWED_MINUTES = [5, 15, 30];
const DEFAULT_MINUTES = 15;

async function currentInterval(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM platform_settings WHERE key = ?").bind(SETTING_KEY).first<{ value: string }>();
  const parsed = row ? Number(row.value) : NaN;
  return ALLOWED_MINUTES.includes(parsed) ? parsed : DEFAULT_MINUTES;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;

  return jsonResponse({ minutes: await currentInterval(env.DB) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { minutes?: unknown } | null;
  if (typeof body?.minutes !== "number" || !ALLOWED_MINUTES.includes(body.minutes)) {
    return jsonResponse({ error: "minutes must be one of 5, 15, 30" }, 400);
  }

  await env.DB
    .prepare(
      `INSERT INTO platform_settings (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
    )
    .bind(SETTING_KEY, String(body.minutes), new Date().toISOString())
    .run();

  return jsonResponse({ minutes: body.minutes });
};
