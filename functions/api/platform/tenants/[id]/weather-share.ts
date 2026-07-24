// Platform-admin only: GET/PUT /api/platform/tenants/:id/weather-share -
// manages this tenant's row in tenant_weather_shares (migration 0029),
// which functions/api/public/weather-latest.ts already reads from (a
// target tenant with an active share reads the SOURCE tenant's
// latest_conditions instead of its own). That table previously had no
// API/UI at all - "only ever written directly against D1" per its own
// migration comment - built during the ATC/PC2 multi-tenant migration
// to support co-located clubs (e.g. a future gyrocopter/microlight
// tenant at Shobdon reading Shobdon's own ATC station instead of
// running their own feed). Deliberately generic: :id is the target,
// sourceTenantSlug in the body is any other tenant by slug - nothing
// here is specific to Shobdon, so the same mechanism works for any
// future main-airfield-plus-neighbours arrangement.
//
// Same admin-only posture as has_physical_atc's own PATCH
// (functions/api/platform/tenants/[id].ts) - cross-tenant settings like
// this are developer/platform-admin-controlled, not something a tenant
// grants itself, matching tenant_weather_shares' own migration comment.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface ShareResponse {
  sourceTenantSlug: string | null;
  sourceTenantName: string | null;
}

async function currentShare(db: D1Database, targetTenantId: number): Promise<ShareResponse> {
  const row = await db
    .prepare(
      `SELECT t.slug AS slug, t.name AS name
       FROM tenant_weather_shares s JOIN tenants t ON t.id = s.source_tenant_id
       WHERE s.target_tenant_id = ?`
    )
    .bind(targetTenantId)
    .first<{ slug: string; name: string }>();
  return { sourceTenantSlug: row?.slug ?? null, sourceTenantName: row?.name ?? null };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const targetTenantId = Number(params.id);
  if (!Number.isInteger(targetTenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  return jsonResponse(await currentShare(env.DB, targetTenantId));
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const targetTenantId = Number(params.id);
  if (!Number.isInteger(targetTenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const target = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(targetTenantId).first<{ id: number }>();
  if (!target) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { sourceTenantSlug?: unknown } | null;
  if (!body || !("sourceTenantSlug" in body)) {
    return jsonResponse({ error: "Provide sourceTenantSlug (a tenant slug, or null to clear the share)" }, 400);
  }

  if (body.sourceTenantSlug === null) {
    await env.DB.prepare("DELETE FROM tenant_weather_shares WHERE target_tenant_id = ?").bind(targetTenantId).run();
    return jsonResponse(await currentShare(env.DB, targetTenantId));
  }

  if (typeof body.sourceTenantSlug !== "string" || !body.sourceTenantSlug.trim()) {
    return jsonResponse({ error: "sourceTenantSlug must be a non-empty string, or null to clear the share" }, 400);
  }

  const source = await env.DB
    .prepare("SELECT id FROM tenants WHERE slug = ?")
    .bind(body.sourceTenantSlug.trim())
    .first<{ id: number }>();
  if (!source) return jsonResponse({ error: "No tenant found with that slug" }, 404);
  if (source.id === targetTenantId) return jsonResponse({ error: "A tenant cannot share weather from itself" }, 400);

  const id = `share_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB
    .prepare(
      `INSERT INTO tenant_weather_shares (id, source_tenant_id, target_tenant_id) VALUES (?, ?, ?)
       ON CONFLICT(target_tenant_id) DO UPDATE SET source_tenant_id = excluded.source_tenant_id`
    )
    .bind(id, source.id, targetTenantId)
    .run();

  return jsonResponse(await currentShare(env.DB, targetTenantId));
};
