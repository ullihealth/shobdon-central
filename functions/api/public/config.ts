// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard -
// Stage 3's host-based replacement for functions/api/public/[tenant]/
// config.ts. Resolves organizationId from the request's own Host header
// (via resolveOrganizationIdFromHost) instead of a URL path segment, so
// the same frontend build works correctly on any tenant's subdomain
// without needing to know its own tenant slug at build time.
//
// GET /api/public/config -> { runwayGroups, theme, cameraSlots, carouselSlots, opsPanel }
// Same response shape as the old route - see functions/api/_utils/
// publicConfig.ts, which both routes share.

import { buildPublicConfigResponse, jsonResponse, type D1Database } from "../_utils/publicConfig";
import { resolveOrganizationIdFromHost } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const organizationId = await resolveOrganizationIdFromHost(host, env.DB);
  if (!organizationId) return jsonResponse({ error: "Unknown tenant host" }, 404);

  return buildPublicConfigResponse(organizationId, env);
};
