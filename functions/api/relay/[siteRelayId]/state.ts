// Machine-to-machine, polled by an on-site relay (go2rtc/MediaMTX) -
// GET /api/relay/:siteRelayId/state. Same "device polls out, nothing
// reaches in" shape as the existing PC2 capture pattern
// (worker/src/index.ts), and the same per-tenant API key auth as the
// generic weather ingestion endpoint (functions/api/ingest/weather.ts,
// migration 0029's tenant_api_keys) - reused rather than inventing a
// new relay-specific auth mechanism, since this app's tenant model is
// already one tenant per airfield/site, so a key scoped to one tenant
// is the right granularity for a relay that only ever serves that
// tenant's own cameras.
//
// rtsp_address IS included in this response, unlike the public cameras
// endpoint - the relay genuinely needs it to know which camera to pull
// from, and this route is never reachable without a valid tenant API
// key. The YouTube RTMP ingest URL/stream key are deliberately absent
// from both this response AND the cameras table itself - per the
// original spec, those live only in the relay's own local config,
// matched by this response's camera ids, and never touch D1/Cloudflare.
import { resolveApiKey } from "../../_utils/apiKeys";
import { jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CameraStateRow {
  id: string;
  rtspAddress: string | null;
  pushEnabled: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!rawKey) return jsonResponse({ error: "Missing Authorization: Bearer <api key> header" }, 401);

  const keyLookup = await resolveApiKey(env.DB, rawKey);
  if (!keyLookup) return jsonResponse({ error: "Invalid or revoked API key" }, 401);

  const siteRelayId = params.siteRelayId;
  const relay = await env.DB
    .prepare("SELECT id, tenant_id AS tenantId FROM site_relays WHERE id = ?")
    .bind(siteRelayId)
    .first<{ id: string; tenantId: number }>();
  if (!relay) return jsonResponse({ error: "Unknown site relay" }, 404);

  // The key's own tenant must match this relay's tenant - a key issued
  // for one tenant can never read another tenant's camera RTSP
  // credentials by polling a different site_relay_id, even if it
  // guesses/enumerates a valid one.
  if (relay.tenantId !== keyLookup.tenantId) {
    return jsonResponse({ error: "This API key is not authorized for this site relay" }, 403);
  }

  const rows = await env.DB
    .prepare("SELECT id, rtsp_address AS rtspAddress, push_enabled AS pushEnabled FROM cameras WHERE site_relay_id = ?")
    .bind(siteRelayId)
    .all<CameraStateRow>();

  return jsonResponse({
    siteRelayId,
    cameras: rows.results.map((row) => ({
      id: row.id,
      rtspAddress: row.rtspAddress,
      pushEnabled: !!row.pushEnabled,
    })),
  });
};
