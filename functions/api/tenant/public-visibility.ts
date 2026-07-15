// Owner-only: GET/PUT /api/tenant/public-visibility - Stage 4's minimal
// toggle mechanism for tenants.weather_public / tenants.ops_public (the
// flags functions/api/public/tenants.ts reads to decide what a cross-
// tenant public listing may show). Deliberately no page/UI wired to this
// yet - a single admin at a single club can call this directly (curl or
// devtools fetch with their session cookie); build a real settings-page
// toggle if/when a second club's own owner actually needs to self-serve
// it, not before.
//
// requireOwner, not requireTenant/requireRoles with a wider role list -
// this is a privacy-affecting setting (whether ANY of this tenant's
// weather/ops data becomes visible outside their own dashboard), same
// gating tier as /config.
//
// tenants has no direct session/membership concept of its own - this is
// the first authenticated route to actually use the tenants.
// organization_id link added in 0024_link_tenants_to_organization.sql,
// resolving the caller's own tenant row via their organizationId.

import { requireOwner, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantVisibilityRow {
  weatherPublic: number;
  opsPublic: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const tenant = await env.DB
    .prepare("SELECT weather_public AS weatherPublic, ops_public AS opsPublic FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<TenantVisibilityRow>();
  if (!tenant) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  return jsonResponse({ weatherPublic: !!tenant.weatherPublic, opsPublic: !!tenant.opsPublic });
};

// Partial update - only touches whichever of weatherPublic/opsPublic is
// present in the body, same "only areas present in the body are
// touched" semantics as tenant/config.ts's PUT. Requires at least one of
// the two, so an empty {} body (a likely mistake, not a valid "change
// nothing" request) is rejected rather than silently doing nothing.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { weatherPublic?: boolean; opsPublic?: boolean } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);
  if (body.weatherPublic === undefined && body.opsPublic === undefined) {
    return jsonResponse({ error: "Provide at least one of weatherPublic, opsPublic" }, 400);
  }
  if (body.weatherPublic !== undefined && typeof body.weatherPublic !== "boolean") {
    return jsonResponse({ error: "weatherPublic must be a boolean" }, 400);
  }
  if (body.opsPublic !== undefined && typeof body.opsPublic !== "boolean") {
    return jsonResponse({ error: "opsPublic must be a boolean" }, 400);
  }

  const tenant = await env.DB
    .prepare("SELECT weather_public AS weatherPublic, ops_public AS opsPublic FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<TenantVisibilityRow>();
  if (!tenant) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  const nextWeatherPublic = body.weatherPublic ?? !!tenant.weatherPublic;
  const nextOpsPublic = body.opsPublic ?? !!tenant.opsPublic;

  await env.DB
    .prepare("UPDATE tenants SET weather_public = ?, ops_public = ?, updated_at = ? WHERE organization_id = ?")
    .bind(nextWeatherPublic ? 1 : 0, nextOpsPublic ? 1 : 0, new Date().toISOString(), organizationId)
    .run();

  return jsonResponse({ weatherPublic: nextWeatherPublic, opsPublic: nextOpsPublic });
};
