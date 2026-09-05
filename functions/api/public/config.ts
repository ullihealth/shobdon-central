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
import { sunriseSunsetAt } from "../_utils/solarPosition";

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

  const response = await buildPublicConfigResponse(organizationId, env);

  // Sunrise/sunset ticker option - computed server-side from the
  // tenant's own lat/lon (same source publicVisibilityForecast.ts's
  // isDaytimeAt already reads for day/night icon selection) and only
  // the two derived UTC instants are added to the response - raw lat/
  // lon is never sent to the client, same convention every other
  // lat/lon-dependent value in this API already follows. A tenant with
  // no lat/lon on file (shouldn't exist per migration 0061, but not
  // guaranteed for very old rows) gets null rather than a broken
  // calculation - the ticker segment itself falls back to empty text
  // for that case, same graceful-degradation posture as every other
  // optional ticker segment in CafeTicker.tsx.
  const body = (await response.json()) as Record<string, unknown>;
  const tenantLocation = await env.DB.prepare("SELECT lat, lon FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ lat: number | null; lon: number | null }>();
  body.sunriseSunsetTimes =
    tenantLocation?.lat != null && tenantLocation?.lon != null ? sunriseSunsetAt(Date.now(), tenantLocation.lat, tenantLocation.lon) : null;

  return jsonResponse(body);
};
