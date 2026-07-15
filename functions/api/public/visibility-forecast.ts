// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard -
// Stage 3's host-based replacement for functions/api/public/[tenant]/
// visibility-forecast.ts. Resolves organizationId from the request's own
// Host header (via resolveOrganizationIdFromHost) instead of a URL path
// segment, same reasoning as functions/api/public/config.ts.
//
// GET /api/public/visibility-forecast -> Met Office hourly-ahead
// visibility forecast, categorised. Same response shape as the old
// route - see functions/api/_utils/publicVisibilityForecast.ts, which
// both routes share.

import { buildVisibilityForecastResponse, jsonResponse, type PublicVisibilityForecastEnv } from "../_utils/publicVisibilityForecast";
import { resolveOrganizationIdFromHost } from "../_utils/resolveTenantHost";

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env extends PublicVisibilityForecastEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const organizationId = await resolveOrganizationIdFromHost(host, env.DB);
  if (!organizationId) return jsonResponse({ error: "Unknown tenant host" }, 404);

  return buildVisibilityForecastResponse(organizationId, env);
};
