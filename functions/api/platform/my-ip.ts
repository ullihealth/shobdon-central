// Platform-admin only: GET /api/platform/my-ip - returns the calling
// request's IP exactly as Cloudflare's edge sees it (CF-Connecting-IP),
// the SAME header functions/api/public/heartbeat.ts reads when writing
// display_visits.ip_address - so the Visit Log's "This is my device"
// button is guaranteed to detect the exact value that gets logged,
// rather than a third-party "what's my IP" service that could disagree
// (different vantage point, a proxy in between, etc.). Backs
// PlatformVisitsPage.tsx.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  return jsonResponse({ ip: request.headers.get("CF-Connecting-IP") });
};
