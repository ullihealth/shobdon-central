// Developer-only: GET/PUT /api/tenant/developer-settings.
//
// Currently a single field (reverseCompassNeedle), stored on the shared
// ops_panel_state row but written via this SEPARATE, narrowly-scoped
// endpoint rather than the general /api/tenant/ops-panel PUT - that
// route does a full-replace of every ops-panel field and is reachable
// by owner/admin/atc (via /atc-control), so routing this field through
// it would risk an atc save silently resetting a developer-only
// diagnostic flag it doesn't even know exists. A dedicated single-field
// UPDATE avoids that entirely.
import { requireDeveloper, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT reverseCompassNeedle FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ reverseCompassNeedle: number }>();

  return jsonResponse({ reverseCompassNeedle: !!row?.reverseCompassNeedle });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { reverseCompassNeedle?: boolean } | null;
  if (!body || typeof body.reverseCompassNeedle !== "boolean") {
    return jsonResponse({ error: "reverseCompassNeedle must be a boolean" }, 400);
  }

  // Same upsert shape as club_theme/camera_slots - INSERT with sensible
  // defaults for a tenant that's never touched /atc-control yet (so no
  // ops_panel_state row exists), ON CONFLICT just updates this one
  // field, matching the "own narrow write" scope this endpoint exists
  // for in the first place.
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, reverseCompassNeedle, updatedAt)
       VALUES (?, '', 'left', '', '[]', 1, 5, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET reverseCompassNeedle = excluded.reverseCompassNeedle, updatedAt = excluded.updatedAt`
    )
    .bind(organizationId, body.reverseCompassNeedle ? 1 : 0, now)
    .run();

  return jsonResponse({ ok: true });
};
