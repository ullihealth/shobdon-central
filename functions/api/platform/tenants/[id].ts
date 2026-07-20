// Platform-admin only: PATCH /api/platform/tenants/:id - partial update
// of a single tenant's active/weatherPublic/opsPublic/isInternal/
// storageQuotaBytes columns. requirePlatformAdmin, same reasoning as
// index.ts (org-independent by design - see that helper's own comment
// in tenantAuth.ts) - :id is an explicit path param naming which
// tenant to touch, completely independent of the caller's own resolved
// org or lack thereof.
//
// Same "fetch current row, merge only the fields present in the body,
// write everything back" shape as tenant/public-visibility.ts's PUT -
// reused deliberately so this doesn't invent a second update
// convention. weatherPublic/opsPublic could have delegated to that
// existing route, but it's hard-scoped to requireOwner + the caller's
// own organizationId (by design - a tenant owner must never write
// another tenant's flags), so it cannot be called on an arbitrary
// tenant id. active and storageQuotaBytes never had a route at all
// (raw SQL only, per mediaQuota.ts's and the tenant-pause work's own
// documented queries) - this is the first UI-reachable way to change
// either.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantRow {
  name: string;
  active: number;
  weatherPublic: number;
  opsPublic: number;
  isInternal: number;
  hasPhysicalAtc: number;
  storageQuotaBytes: number;
}

interface PatchBody {
  name?: string;
  active?: boolean;
  weatherPublic?: boolean;
  opsPublic?: boolean;
  isInternal?: boolean;
  hasPhysicalAtc?: boolean;
  storageQuotaBytes?: number;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const fields: (keyof PatchBody)[] = ["name", "active", "weatherPublic", "opsPublic", "isInternal", "hasPhysicalAtc", "storageQuotaBytes"];
  if (!fields.some((field) => body[field] !== undefined)) {
    return jsonResponse({ error: `Provide at least one of: ${fields.join(", ")}` }, 400);
  }
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return jsonResponse({ error: "name must be a non-empty string" }, 400);
  }
  for (const field of ["active", "weatherPublic", "opsPublic", "isInternal", "hasPhysicalAtc"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return jsonResponse({ error: `${field} must be a boolean` }, 400);
    }
  }
  if (body.storageQuotaBytes !== undefined && (!Number.isInteger(body.storageQuotaBytes) || body.storageQuotaBytes <= 0)) {
    return jsonResponse({ error: "storageQuotaBytes must be a positive integer" }, 400);
  }

  const current = await env.DB
    .prepare(
      "SELECT name, active, weather_public AS weatherPublic, ops_public AS opsPublic, is_internal AS isInternal, has_physical_atc AS hasPhysicalAtc, storage_quota_bytes AS storageQuotaBytes FROM tenants WHERE id = ?"
    )
    .bind(tenantId)
    .first<TenantRow>();
  if (!current) return jsonResponse({ error: "Tenant not found" }, 404);

  const next = {
    name: body.name?.trim() ?? current.name,
    active: body.active ?? !!current.active,
    weatherPublic: body.weatherPublic ?? !!current.weatherPublic,
    opsPublic: body.opsPublic ?? !!current.opsPublic,
    isInternal: body.isInternal ?? !!current.isInternal,
    hasPhysicalAtc: body.hasPhysicalAtc ?? !!current.hasPhysicalAtc,
    storageQuotaBytes: body.storageQuotaBytes ?? current.storageQuotaBytes,
  };

  await env.DB
    .prepare(
      `UPDATE tenants SET name = ?, active = ?, weather_public = ?, ops_public = ?, is_internal = ?, has_physical_atc = ?, storage_quota_bytes = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      next.name,
      next.active ? 1 : 0,
      next.weatherPublic ? 1 : 0,
      next.opsPublic ? 1 : 0,
      next.isInternal ? 1 : 0,
      next.hasPhysicalAtc ? 1 : 0,
      next.storageQuotaBytes,
      new Date().toISOString(),
      tenantId
    )
    .run();

  return jsonResponse(next);
};
