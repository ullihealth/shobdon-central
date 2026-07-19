// Platform-admin only: PATCH /api/platform/tenants/:id/displays/:displayId
// - partial update of a single tenant_displays row's active/entitled/
// entitlementTrialExpiresAt (migration 0034). Same requirePlatformAdmin
// gate and fetch-current-merge-write-back shape as the sibling
// ../[id].ts PATCH route - :displayId is scoped to belong to :id's
// tenant (checked below), so a platform admin can't accidentally target
// another tenant's display by guessing an id.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface DisplayRow {
  active: number;
  entitled: number;
  entitlementTrialExpiresAt: string | null;
}

interface PatchBody {
  active?: boolean;
  entitled?: boolean;
  // Explicit null clears the expiry (permanent entitlement, no trial
  // window); undefined leaves whatever's already stored untouched -
  // same "only touch fields present in the body" convention as every
  // other PATCH route in this app.
  entitlementTrialExpiresAt?: string | null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  const displayId = Number(params.displayId);
  if (!Number.isInteger(tenantId) || !Number.isInteger(displayId)) {
    return jsonResponse({ error: "Invalid tenant or display id" }, 400);
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const fields: (keyof PatchBody)[] = ["active", "entitled", "entitlementTrialExpiresAt"];
  if (!fields.some((field) => body[field] !== undefined)) {
    return jsonResponse({ error: `Provide at least one of: ${fields.join(", ")}` }, 400);
  }
  for (const field of ["active", "entitled"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return jsonResponse({ error: `${field} must be a boolean` }, 400);
    }
  }
  if (body.entitlementTrialExpiresAt !== undefined && body.entitlementTrialExpiresAt !== null) {
    if (typeof body.entitlementTrialExpiresAt !== "string" || Number.isNaN(Date.parse(body.entitlementTrialExpiresAt))) {
      return jsonResponse({ error: "entitlementTrialExpiresAt must be an ISO date string or null" }, 400);
    }
  }

  const current = await env.DB
    .prepare(
      "SELECT active, entitled, entitlement_trial_expires_at AS entitlementTrialExpiresAt FROM tenant_displays WHERE id = ? AND tenant_id = ?"
    )
    .bind(displayId, tenantId)
    .first<DisplayRow>();
  if (!current) return jsonResponse({ error: "Display not found for this tenant" }, 404);

  const next = {
    active: body.active ?? !!current.active,
    entitled: body.entitled ?? !!current.entitled,
    entitlementTrialExpiresAt:
      body.entitlementTrialExpiresAt !== undefined ? body.entitlementTrialExpiresAt : current.entitlementTrialExpiresAt,
  };

  await env.DB
    .prepare(
      `UPDATE tenant_displays SET active = ?, entitled = ?, entitlement_trial_expires_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .bind(next.active ? 1 : 0, next.entitled ? 1 : 0, next.entitlementTrialExpiresAt, new Date().toISOString(), displayId, tenantId)
    .run();

  return jsonResponse(next);
};
