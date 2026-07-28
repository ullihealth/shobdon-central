// Public, UNAUTHENTICATED - GET /api/public/cameras. Host-resolved
// tenant, same pattern as weather-metoffice.ts/config.ts. Backs
// CameraPanel.tsx, the viewer-facing dashboard tile grid.
//
// Deliberately excludes rtsp_address entirely - that only ever goes to
// the relay poll endpoint (functions/api/relay/[siteRelayId]/state.ts),
// which requires a tenant API key. This route returns only what a
// browser actually needs to embed a feed: youtubeVideoId for stream
// mode, and the owning site relay's localBaseUrl for local mode (the
// relay's own address on the tenant's LAN - only reachable by a viewer
// actually on that network, which is exactly local mode's assumption).
//
// localStreamUrl assumes go2rtc's own built-in stream page
// (<localBaseUrl>/stream.html?src=<camera id>) - the camera's id is
// also its go2rtc stream name by convention, matched by whoever
// configures the relay. If MediaMTX is used instead, this URL scheme
// needs adjusting (MediaMTX doesn't ship the same built-in HLS/WebRTC
// player page) - noted here since the original spec left the relay
// choice open ("go2rtc or MediaMTX, my choice").
import { resolveTenantFromHost } from "../_utils/resolveTenantHost";
// Wider D1Database (adds .all(), needed for the multi-row query below) -
// structurally compatible with resolveTenantHost.ts's own narrower type,
// so it satisfies resolveTenantFromHost's parameter without any cast.
import { type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface PublicCameraRow {
  id: string;
  name: string;
  mode: string;
  youtubeVideoId: string | null;
  localBaseUrl: string | null;
  pushEnabled: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  // pushEnabled IS safe to expose here (unlike rtsp_address) - it's just
  // a boolean describing current state, needed so CameraPanel.tsx's
  // "go live remotely" toggle reflects reality rather than always
  // starting unchecked regardless of what the relay is actually doing.
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.name, c.mode, c.youtube_video_id AS youtubeVideoId, r.local_base_url AS localBaseUrl, c.push_enabled AS pushEnabled
       FROM cameras c JOIN site_relays r ON r.id = c.site_relay_id
       WHERE c.tenant_id = ?
       ORDER BY c.created_at`
    )
    .bind(tenant.id)
    .all<PublicCameraRow>();

  return jsonResponse({
    cameras: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      mode: row.mode,
      youtubeVideoId: row.youtubeVideoId,
      localStreamUrl: row.localBaseUrl ? `${row.localBaseUrl}/stream.html?src=${encodeURIComponent(row.id)}` : null,
      pushEnabled: !!row.pushEnabled,
    })),
  });
};
