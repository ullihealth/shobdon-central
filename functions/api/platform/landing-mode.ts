// Developer-only: GET/PUT /api/platform/landing-mode
//
// requireDeveloper, not requirePlatformAdmin - matches this exact page's
// (DeveloperToolsPage.tsx, /developertools) own existing convention for
// its sibling "Compass Safety Net" toggle (functions/api/tenant/
// developer-settings/index.ts), not the /platform/tenants family's
// requirePlatformAdmin. Genuinely cross-tenant/platform-wide (no
// organizationId anywhere in this file) - unlike that sibling toggle,
// which happens to be developer-gated but still per-tenant data.
import { requireDeveloper, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

async function currentMode(db: D1Database): Promise<"coming_soon" | "live"> {
  const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'landing_page_mode'").first<{ value: string }>();
  return row?.value === "live" ? "live" : "coming_soon";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;

  return jsonResponse({ mode: await currentMode(env.DB) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  if (body?.mode !== "coming_soon" && body?.mode !== "live") {
    return jsonResponse({ error: 'mode must be "coming_soon" or "live"' }, 400);
  }

  await env.DB
    .prepare(
      `INSERT INTO platform_settings (key, value, updatedAt) VALUES ('landing_page_mode', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
    )
    .bind(body.mode, new Date().toISOString())
    .run();

  return jsonResponse({ mode: body.mode });
};
