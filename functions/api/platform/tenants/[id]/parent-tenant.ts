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
//
// Weather-source sync round (Tiger Helicopters investigation) - choosing
// a parent IS choosing this tenant's weather source, not a second manual
// step: setting parentTenantSlug now ALSO sets active_weather_provider =
// 'ingested' in the SAME UPDATE (one statement, atomic by construction -
// no separate transaction/batch needed since both columns live on the
// same tenants row). Before this round, only parent_tenant_id was
// written here; active_weather_provider had to be flipped separately on
// the tenant's own /config page, which Tiger Helicopters (id 29) never
// got - the exact bug this round fixes at the root, not just for that
// one tenant.
//
// Guard rail: a tenant whose active_weather_provider is already 'atc'
// (it owns real physical station hardware - has_physical_atc) is never
// silently switched. The request is rejected (409) unless the caller
// explicitly passes overrideAtc: true, confirming the deliberate choice
// to replace that tenant's own station with the parent's shared feed.
//
// Clearing the link (parentTenantSlug: null) resets active_weather_
// provider back to NULL in the SAME UPDATE - NULL is exactly "no
// explicit admin choice recorded," the same value a brand-new tenant
// already starts with (confirmed: nothing in onboard.ts/cloneTenant.ts
// ever writes this column), so clearing the link cleanly hands the
// tenant back to the normal structural default (functions/api/public/
// weather-default.ts: has_physical_atc -> 'atc', else lat/lon ->
// 'internet', else 'unavailable') rather than leaving a stale 'ingested'
// override behind with nothing to feed it.
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

  const target = await env.DB
    .prepare("SELECT id, active_weather_provider AS activeWeatherProvider FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: number; activeWeatherProvider: string | null }>();
  if (!target) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { parentTenantSlug?: unknown; overrideAtc?: unknown } | null;
  if (!body || !("parentTenantSlug" in body)) {
    return jsonResponse({ error: "Provide parentTenantSlug (a tenant slug, or null to clear the link)" }, 400);
  }

  if (body.parentTenantSlug === null) {
    // See this file's own top comment: clearing the link resets the
    // weather-source override back to NULL (no explicit choice), the
    // same starting point a brand-new tenant already has - not a fixed
    // provider, and not whatever this tenant happened to have before it
    // was linked (that choice may itself have predated the link and had
    // nothing to do with it - restoring it blindly would be guessing).
    await env.DB.prepare("UPDATE tenants SET parent_tenant_id = NULL, active_weather_provider = NULL WHERE id = ?").bind(tenantId).run();
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

  // Guard rail: never silently take away a tenant's own real station.
  if (target.activeWeatherProvider === "atc" && body.overrideAtc !== true) {
    return jsonResponse(
      {
        error:
          "This tenant's weather source is set to its own physical ATC station. Setting a parent also switches the weather source to the parent's shared feed - pass overrideAtc: true to confirm, or clear the weather source first.",
        requiresConfirmation: true,
      },
      409
    );
  }

  await env.DB
    .prepare("UPDATE tenants SET parent_tenant_id = ?, active_weather_provider = 'ingested' WHERE id = ?")
    .bind(parent.id, tenantId)
    .run();

  return jsonResponse(await currentParent(env.DB, tenantId));
};
