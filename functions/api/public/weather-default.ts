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
// branch, closes that gap: a linked parent is a deliberate, more-
// specific platform-admin choice for this tenant's weather than the
// generic own-coordinates internet default, so it wins regardless of
// whether lat/lon also happens to be on file.
//
// Parent/sub-tenant round: repointed from tenant_weather_shares onto
// tenants.parent_tenant_id (migration 0059) via the shared resolver -
// see that file's own comment for why. Same "check parent first, fall
// through to own lat/lon, then 'unavailable'" shape as before, unchanged
// behaviourally for the one real tenant this already covered (confirmed
// by this round's own before/after test, not assumed from the rename
// alone).
//
// ATC-default round: checked ahead of the lat/lon branch too, for the
// same reason the parent check is - has_physical_atc (migration 0038)
// is a deliberate, more-specific admin fact about THIS tenant's real
// weather source than "does it have coordinates for a generic regional
// forecast." Previously this endpoint never considered 'atc' as an
// option at all, so every brand-new device on Shobdon (the one tenant
// that actually has a real station) defaulted to Internet/Open-Meteo
// exactly like every tenant with no station - not a deliberate choice,
// just never-considered. fetchAtcWeather() (atcProvider.ts) doesn't
// need the requesting device to be anywhere near the station itself -
// it reads from the public capture Worker relay, reachable from any
// device anywhere - so there's no "only default to atc for local
// devices" concern here; the existing ATC-primary/Met-Office-fallback
// auto-switch in WeatherContext.tsx already handles a real probe
// failure gracefully once this default hands it 'atc' to try. No
// per-provider config needs sending along - DEFAULT_WEATHER_CONFIG.atc
// already has sensible defaults, same "no client-side settings" shape
// 'ingested' above already uses.
import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";
import { resolveEffectiveTenantById } from "../_utils/resolveParentTenant";

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
  hasPhysicalAtc: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const effective = await resolveEffectiveTenantById(env.DB, tenant.id);
  if (effective.isInherited) {
    // No client-side settings to send along - 'ingested' resolves
    // entirely server-side (functions/api/public/weather-latest.ts
    // redirects to the parent tenant's own reading via the same
    // parent_tenant_id link), see IngestedWeatherConfigSection.tsx's
    // own comment.
    return jsonResponse({ activeProvider: "ingested" });
  }

  const row = await env.DB
    .prepare("SELECT lat, lon, has_physical_atc AS hasPhysicalAtc FROM tenants WHERE id = ?")
    .bind(tenant.id)
    .first<TenantLocationRow>();

  if (row?.hasPhysicalAtc) {
    return jsonResponse({ activeProvider: "atc" });
  }

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
