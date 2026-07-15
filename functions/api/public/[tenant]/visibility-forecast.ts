// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard.
// GET /api/public/:tenant/visibility-forecast -> Met Office hourly-ahead
// visibility forecast, categorised.
//
// The actual fetch/cache/response logic lives in functions/api/_utils/
// publicVisibilityForecast.ts, shared with functions/api/public/
// visibility-forecast.ts (Stage 3's new host-based route). This file's
// only remaining job is resolving organizationId from the :tenant URL
// path segment (organization.slug), same as always - kept working
// unchanged as a zero-risk rollback path for the frontend cutover to the
// host-based route, not because anything still requires it.

import { buildVisibilityForecastResponse, jsonResponse, type PublicVisibilityForecastEnv } from "../../_utils/publicVisibilityForecast";

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
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env extends PublicVisibilityForecastEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const slug = params.tenant;
  if (!slug) return jsonResponse({ error: "Missing tenant" }, 400);

  const org = await env.DB.prepare("SELECT id FROM organization WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (!org) return jsonResponse({ error: "Unknown tenant" }, 404);

  return buildVisibilityForecastResponse(org.id, env);
};
