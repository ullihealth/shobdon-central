// Platform-admin only: PUT/DELETE /api/platform/cameras/:id.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const VALID_MODES = new Set(["local", "stream", "both"]);

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as
    | {
        siteRelayId?: unknown;
        name?: unknown;
        mode?: unknown;
        rtspAddress?: unknown;
        youtubeVideoId?: unknown;
        pushEnabled?: unknown;
      }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const existing = await env.DB.prepare("SELECT tenant_id AS tenantId FROM cameras WHERE id = ?").bind(params.id).first<{ tenantId: number }>();
  if (!existing) return jsonResponse({ error: "Camera not found" }, 404);

  const siteRelayId = typeof body.siteRelayId === "string" ? body.siteRelayId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "";
  const rtspAddress = typeof body.rtspAddress === "string" && body.rtspAddress.trim() ? body.rtspAddress.trim() : null;
  const youtubeVideoId = typeof body.youtubeVideoId === "string" && body.youtubeVideoId.trim() ? body.youtubeVideoId.trim() : null;
  const pushEnabled = body.pushEnabled === true;

  if (!siteRelayId) return jsonResponse({ error: "siteRelayId is required" }, 400);
  if (!name) return jsonResponse({ error: "name is required" }, 400);
  if (!VALID_MODES.has(mode)) return jsonResponse({ error: "mode must be 'local', 'stream', or 'both'" }, 400);
  if ((mode === "local" || mode === "both") && !rtspAddress) {
    return jsonResponse({ error: "rtspAddress is required for local/both mode" }, 400);
  }
  if ((mode === "stream" || mode === "both") && !youtubeVideoId) {
    return jsonResponse({ error: "youtubeVideoId is required for stream/both mode" }, 400);
  }

  const relay = await env.DB.prepare("SELECT tenant_id AS tenantId FROM site_relays WHERE id = ?").bind(siteRelayId).first<{ tenantId: number }>();
  if (!relay) return jsonResponse({ error: "Unknown siteRelayId" }, 400);
  if (relay.tenantId !== existing.tenantId) {
    return jsonResponse({ error: "siteRelayId does not belong to this camera's tenant" }, 400);
  }

  await env.DB
    .prepare(
      "UPDATE cameras SET site_relay_id = ?, name = ?, mode = ?, rtsp_address = ?, youtube_video_id = ?, push_enabled = ?, updated_at = ? WHERE id = ?"
    )
    .bind(siteRelayId, name, mode, rtspAddress, youtubeVideoId, pushEnabled ? 1 : 0, new Date().toISOString(), params.id)
    .run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  await env.DB.prepare("DELETE FROM cameras WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
};
