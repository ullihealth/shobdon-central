// Platform-admin only: GET/POST /api/platform/cameras. Backs
// PlatformCamerasPage.tsx - camera setup (RTSP credentials, relay
// assignment) is physical on-site work done by the platform admin on a
// tenant's behalf, not self-service (see migration 0047's own comment
// and the Decisions log entry for this feature for the fuller reasoning).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CameraRow {
  id: string;
  tenantId: number;
  siteRelayId: string;
  name: string;
  mode: string;
  rtspAddress: string | null;
  youtubeVideoId: string | null;
  pushEnabled: number;
  createdAt: string;
}

const VALID_MODES = new Set(["local", "stream", "both"]);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  // rtsp_address IS included here - this route is platform-admin-only
  // (never reachable by an ordinary tenant session or the public
  // dashboard), so there's no boundary being crossed by returning it,
  // unlike the relay-poll and public endpoints, which deliberately
  // never include it (public) or gate it behind relay auth (relay poll).
  const rows = await env.DB
    .prepare(
      "SELECT id, tenant_id AS tenantId, site_relay_id AS siteRelayId, name, mode, rtsp_address AS rtspAddress, youtube_video_id AS youtubeVideoId, push_enabled AS pushEnabled, created_at AS createdAt FROM cameras ORDER BY created_at DESC"
    )
    .all<CameraRow>();

  return jsonResponse({ cameras: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as
    | {
        tenantId?: unknown;
        siteRelayId?: unknown;
        name?: unknown;
        mode?: unknown;
        rtspAddress?: unknown;
        youtubeVideoId?: unknown;
        pushEnabled?: unknown;
      }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const tenantId = typeof body.tenantId === "number" ? body.tenantId : Number(body.tenantId);
  const siteRelayId = typeof body.siteRelayId === "string" ? body.siteRelayId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "";
  const rtspAddress = typeof body.rtspAddress === "string" && body.rtspAddress.trim() ? body.rtspAddress.trim() : null;
  const youtubeVideoId = typeof body.youtubeVideoId === "string" && body.youtubeVideoId.trim() ? body.youtubeVideoId.trim() : null;
  const pushEnabled = body.pushEnabled === true;

  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "tenantId is required" }, 400);
  if (!siteRelayId) return jsonResponse({ error: "siteRelayId is required" }, 400);
  if (!name) return jsonResponse({ error: "name is required" }, 400);
  if (!VALID_MODES.has(mode)) return jsonResponse({ error: "mode must be 'local', 'stream', or 'both'" }, 400);
  if ((mode === "local" || mode === "both") && !rtspAddress) {
    return jsonResponse({ error: "rtspAddress is required for local/both mode" }, 400);
  }
  if ((mode === "stream" || mode === "both") && !youtubeVideoId) {
    return jsonResponse({ error: "youtubeVideoId is required for stream/both mode" }, 400);
  }

  const relay = await env.DB.prepare("SELECT id, tenant_id AS tenantId FROM site_relays WHERE id = ?").bind(siteRelayId).first<{ id: string; tenantId: number }>();
  if (!relay) return jsonResponse({ error: "Unknown siteRelayId" }, 400);
  if (relay.tenantId !== tenantId) {
    return jsonResponse({ error: "siteRelayId does not belong to the selected tenant" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      "INSERT INTO cameras (id, tenant_id, site_relay_id, name, mode, rtsp_address, youtube_video_id, push_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, tenantId, siteRelayId, name, mode, rtspAddress, youtubeVideoId, pushEnabled ? 1 : 0, now, now)
    .run();

  return jsonResponse({ ok: true, id });
};
