// Public, UNAUTHENTICATED per-tenant weather-config default - GET
// /api/public/weather-default. Host-resolved tenant, same pattern as
// config.ts. Returns the config a BRAND NEW device (no localStorage
// entry yet) should adopt - not the previous hardcoded 'mock' +
// Shobdon-coordinates constant (weatherConfigStore.ts's own
// DEFAULT_WEATHER_CONFIG), which silently showed Shobdon's weather/
// location on every other tenant's fresh device regardless of where
// they actually are.
//
// Never overrides an ALREADY-configured device - see
// weatherConfigStore.ts's resolveWeatherConfig(), which only calls this
// when nothing is stored yet. This only ever answers "what should a
// blank device start with," which is also what makes the tenant_weather_
// shares check below a complete "auto-switch on share creation, revert
// on removal" mechanism with no extra code anywhere else: an
// unconfigured device re-resolves this on every load, so the very next
// load after a share is created/removed picks up the new answer on its
// own, and an already-configured device (real localStorage entry) never
// calls this at all, so it can never be overridden by a share appearing
// or disappearing.
//
// Weather-share round (Gyroplane Train -> Shobdon investigation):
// confirmed via production data that a share existing in
// tenant_weather_shares never actually reached a real tenant's live
// dashboard, because nothing bridged "a share was configured" to "this
// device's default should be 'ingested'" - the share only ever took
// effect for a device someone had ALREADY manually switched to
// Third-Party Station by hand. Checking it here, ahead of the lat/lon
// branch, closes that gap: a share is a deliberate, more-specific
// platform-admin choice for this tenant's weather than the generic
// own-coordinates internet default, so it wins regardless of whether
// lat/lon also happens to be on file.
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

  const share = await env.DB
    .prepare("SELECT 1 FROM tenant_weather_shares WHERE target_tenant_id = ?")
    .bind(tenant.id)
    .first();
  if (share) {
    // No client-side settings to send along - 'ingested' resolves
    // entirely server-side (functions/api/public/weather-latest.ts
    // redirects to the SOURCE tenant's own reading via this same
    // tenant_weather_shares row), see IngestedWeatherConfigSection.tsx's
    // own comment.
    return jsonResponse({ activeProvider: "ingested" });
  }

  const row = await env.DB.prepare("SELECT lat, lon FROM tenants WHERE id = ?").bind(tenant.id).first<TenantLocationRow>();

  if (row && row.lat !== null && row.lon !== null) {
    return jsonResponse({
      activeProvider: "internet",
      internet: { provider: "open-meteo", latitude: row.lat, longitude: row.lon, refreshIntervalSeconds: 30 },
    });
  }

  // No share and no lat/lon on file - genuinely nothing real to default
  // to (Open-Meteo needs real coordinates). Previously returned 404/null
  // here, which sent the caller (weatherConfigStore.ts's
  // resolveWeatherConfig()) all the way back to DEFAULT_WEATHER_CONFIG -
  // activeProvider 'mock', showing realistic-looking FABRICATED numbers
  // with no visible indication anything was wrong. Confirmed happening
  // for real on a live production tenant's actual dashboard (Gyroplane
  // Train, before its lat/lon was backfilled). "unavailable" here isn't
  // itself a WeatherProviderId - the client maps it to the SAME "fetch
  // failed" degraded state (N/A readouts, "NO LIVE READING" status
  // badge) a configured source's own outage already uses everywhere on
  // the dashboard, rather than a state that reads as a deliberate mock
  // choice. Lat/lon is a required field for every new tenant going
  // forward (onboard.ts/trial-signup.ts), so this branch should only
  // ever be reached by a tenant that predates that requirement and
  // hasn't been backfilled.
  return jsonResponse({ activeProvider: "unavailable" });
};
