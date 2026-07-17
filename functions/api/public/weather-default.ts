// Public, UNAUTHENTICATED per-tenant weather-config default - GET
// /api/public/weather-default. Host-resolved tenant, same pattern as
// config.ts. Returns the config a BRAND NEW device (no localStorage
// entry yet) should adopt: 'internet' (Open-Meteo, no station/vendor
// dependency) using the tenant's OWN lat/lon - not the previous
// hardcoded 'mock' + Shobdon-coordinates constant
// (weatherConfigStore.ts's DEFAULT_WEATHER_CONFIG), which silently
// showed Shobdon's weather/location on every other tenant's fresh
// device regardless of where they actually are.
//
// Never overrides an ALREADY-configured device - see
// weatherConfigStore.ts's resolveWeatherConfig(), which only calls this
// when nothing is stored yet. This only ever answers "what should a
// blank device start with."

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

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

interface TenantLocationRow {
  lat: number | null;
  lon: number | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const row = await env.DB.prepare("SELECT lat, lon FROM tenants WHERE id = ?").bind(tenant.id).first<TenantLocationRow>();

  // No lat/lon on file for this tenant - nothing sensible to default to
  // (Open-Meteo needs real coordinates), so the caller falls back to its
  // own built-in constant rather than getting a wrong/empty location.
  if (!row || row.lat === null || row.lon === null) return jsonResponse(null, 404);

  return jsonResponse({
    activeProvider: "internet",
    internet: { provider: "open-meteo", latitude: row.lat, longitude: row.lon, refreshIntervalSeconds: 30 },
  });
};
