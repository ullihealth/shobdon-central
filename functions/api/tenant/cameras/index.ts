// Authenticated (requireOwner - same gating as the rest of the tenant
// Config page): GET /api/tenant/cameras. Backs CameraSection.tsx - lists
// only the caller's own org's cameras, for self-service editing via
// PATCH /api/tenant/cameras/:id (see that file's own comment). Scoped
// by joining through tenants.organization_id, same pattern as that
// PATCH's own ownership check.
//
// rtsp_address is deliberately NOT selected here at all, let alone
// returned - matching the "never sent to the browser" posture migration
// 0047 established for every other browser-facing route. rtspConfigured
// (a boolean derived server-side) is all a tenant needs to know whether
// a value is already set, same "is something saved" signal a password
// field's placeholder would give without ever re-sending the password.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantCameraRow {
  id: string;
  name: string;
  mode: string;
  youtubeVideoId: string | null;
  rtspConfigured: number;
  pushEnabled: number;
  createdAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.name, c.mode, c.youtube_video_id AS youtubeVideoId,
              (c.rtsp_address IS NOT NULL) AS rtspConfigured, c.push_enabled AS pushEnabled, c.created_at AS createdAt
       FROM cameras c JOIN tenants t ON t.id = c.tenant_id
       WHERE t.organization_id = ?
       ORDER BY c.created_at`
    )
    .bind(organizationId)
    .all<TenantCameraRow>();

  return jsonResponse({
    cameras: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      mode: row.mode,
      youtubeVideoId: row.youtubeVideoId,
      rtspConfigured: !!row.rtspConfigured,
      pushEnabled: !!row.pushEnabled,
      createdAt: row.createdAt,
    })),
  });
};
