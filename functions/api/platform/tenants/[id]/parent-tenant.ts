// Platform-admin only: GET/PUT /api/platform/tenants/:id/parent-tenant -
// manages this tenant's tenants.parent_tenant_id column (migration
// 0059). Renamed from weather-share.ts (which managed
// tenant_weather_shares, migration 0029) - the parent/sub-tenant round
// found the exact same "co-located tenant" relationship that table only
// ever expressed for weather is also what Met Office forecasts, NOTAMs,
// gas prices, runway/compass data, and active-runway/circuit status all
// need, so the concept (and this file) is now framed as "parent
// airfield," not "weather source." Same one-per-tenant cardinality as
// before - previously enforced by tenant_weather_shares' own
// UNIQUE(target_tenant_id), now structurally true of a single nullable
// column instead. Deliberately generic: :id is the sub-tenant, any
// OTHER tenant can be picked as its parent - nothing here is specific
// to Shobdon, so the same mechanism works for any future main-airfield-
// plus-neighbours arrangement (Jeff's own explicit framing for this
// round).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface ParentTenantResponse {
  parentTenantSlug: string | null;
  parentTenantName: string | null;
}

async function currentParent(db: D1Database, tenantId: number): Promise<ParentTenantResponse> {
  const row = await db
    .prepare(
      `SELECT p.slug AS slug, p.name AS name
       FROM tenants t JOIN tenants p ON p.id = t.parent_tenant_id
       WHERE t.id = ?`
    )
    .bind(tenantId)
    .first<{ slug: string; name: string }>();
  return { parentTenantSlug: row?.slug ?? null, parentTenantName: row?.name ?? null };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  return jsonResponse(await currentParent(env.DB, tenantId));
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const target = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first<{ id: number }>();
  if (!target) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { parentTenantSlug?: unknown } | null;
  if (!body || !("parentTenantSlug" in body)) {
    return jsonResponse({ error: "Provide parentTenantSlug (a tenant slug, or null to clear the link)" }, 400);
  }

  if (body.parentTenantSlug === null) {
    await env.DB.prepare("UPDATE tenants SET parent_tenant_id = NULL WHERE id = ?").bind(tenantId).run();
    return jsonResponse(await currentParent(env.DB, tenantId));
  }

  if (typeof body.parentTenantSlug !== "string" || !body.parentTenantSlug.trim()) {
    return jsonResponse({ error: "parentTenantSlug must be a non-empty string, or null to clear the link" }, 400);
  }

  const parent = await env.DB
    .prepare("SELECT id FROM tenants WHERE slug = ?")
    .bind(body.parentTenantSlug.trim())
    .first<{ id: number }>();
  if (!parent) return jsonResponse({ error: "No tenant found with that slug" }, 404);
  if (parent.id === tenantId) return jsonResponse({ error: "A tenant cannot be its own parent" }, 400);

  await env.DB.prepare("UPDATE tenants SET parent_tenant_id = ? WHERE id = ?").bind(parent.id, tenantId).run();

  return jsonResponse(await currentParent(env.DB, tenantId));
};
