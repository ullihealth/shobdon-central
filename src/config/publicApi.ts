// Public, unauthenticated read endpoint for the live dashboard - served
// by functions/api/public/config.ts (a Cloudflare Pages Function on the
// same origin as this SPA, hence a plain relative path - this is a
// native fetch() call, not the BetterAuth client, which specifically
// needs an absolute URL; a relative path works fine here in every
// browser).
//
// No tenant slug embedded in the URL (Stage 3): the server resolves
// which tenant a request belongs to from the browser's own Host header
// (functions/api/_utils/resolveTenantHost.ts), since this is the same
// static JS bundle served to every tenant's subdomain - it can't know
// its own tenant at build time. The old slug-based route
// (functions/api/public/[tenant]/config.ts, e.g. /api/public/shobdon/config)
// still exists unchanged as a rollback path if this ever needs reverting.
export const PUBLIC_CONFIG_URL = `/api/public/config`

// Still single-tenant here: hardcoded to Shobdon's real IANA zone for
// now, becomes a genuine per-tenant value (resolved server-side, same as
// PUBLIC_CONFIG_URL above) once a second airfield (potentially in a
// different zone) onboards.
// A single named constant, not a literal repeated at each call site -
// every clock/timestamp display on the live public dashboard (Header's
// clock, the "Last updated" freshness stamps) must show the AIRFIELD's
// local time, not whatever timezone the viewing device's own system
// clock happens to be set to (a TV with a misconfigured clock, or a
// browser session behind a VPN in another region, would otherwise show
// a plausible-looking but wrong time with no indication anything was
// off).
export const AIRFIELD_TIMEZONE = 'Europe/London'

// Served by functions/api/public/visibility-forecast.ts - deliberately a
// separate route/fetch from PUBLIC_CONFIG_URL above (not bundled into
// that response) so a Met Office outage can only ever affect this one
// card, never the rest of the public dashboard. Same host-based tenant
// resolution as PUBLIC_CONFIG_URL above.
export const VISIBILITY_FORECAST_URL = `/api/public/visibility-forecast`

// Served by functions/api/public/weather-default.ts - the per-tenant
// weather-config default (activeProvider 'internet' + this tenant's own
// lat/lon) a brand-new device with no stored config yet should adopt.
// See weatherConfigStore.ts's resolveWeatherConfig().
export const WEATHER_DEFAULT_URL = `/api/public/weather-default`

// Served by functions/api/public/weather-latest.ts - the latest reading
// written by the generic ingestion endpoint (functions/api/ingest/
// weather.ts), consumed by the 'ingested' weather provider
// (weatherProviders/ingestedProvider.ts). Same host-based tenant
// resolution as PUBLIC_CONFIG_URL above.
export const INGESTED_WEATHER_LATEST_URL = `/api/public/weather-latest`

// Authenticated read/write for the management pages - functions/api/
// tenant/config.ts. Requires a valid BetterAuth session cookie, which a
// same-origin fetch() sends automatically; no extra credential handling
// needed. Resolves its own tenant from the logged-in user's membership,
// so no slug is passed here (unlike the public endpoint above).
export const TENANT_CONFIG_URL = '/api/tenant/config'

// Owner/media-role media-manager endpoints.
export const MEDIA_LIBRARY_URL = '/api/tenant/media-library'
export const MEDIA_LIBRARY_UPLOAD_URL = '/api/tenant/media-library/upload'
export const CAROUSEL_SLOTS_URL = '/api/tenant/carousel'
// Lightweight, flat (no nesting) per-tenant folders for the media
// library - functions/api/tenant/media-folders/*.
export const MEDIA_FOLDERS_URL = '/api/tenant/media-folders'

// Slide composer - see SlideEditor.tsx. Recipe attach is a separate PUT
// from the upload itself (upload.ts stays completely untouched); the
// image proxy is same-origin so an existing library image can be loaded
// into a <canvas> as a background without tainting it (the public R2
// bucket sends no CORS headers).
export const mediaLibraryRecipeUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/recipe`
export const mediaLibraryImageProxyUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/image`
// True in-place update (same id, same r2Key, new bytes) - used by the
// primary "Save Slide" action when editing an existing slide. "Save as
// New" instead uses MEDIA_LIBRARY_UPLOAD_URL above, unchanged.
export const mediaLibraryReplaceUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/replace`

// Owner/atc-role ATC-control endpoint.
export const OPS_PANEL_URL = '/api/tenant/ops-panel'

// Public, unauthenticated cross-tenant listing - functions/api/public/
// tenants.ts. Unlike every other constant above, deliberately NOT
// tenant-scoped in any way (no Host resolution, no slug) - this is the
// "which tenants have opted into weather_public/ops_public" query,
// consumed by GlobalDashboardPage.tsx (/global).
export const PUBLIC_TENANTS_URL = '/api/public/tenants'

// Public, unauthenticated self-serve trial signup - functions/api/
// public/trial-signup.ts. Consumed by LandingPage.tsx's signup form.
// Also cross-tenant by nature (it's how a NEW tenant comes to exist),
// same reasoning as PUBLIC_TENANTS_URL above.
export const TRIAL_SIGNUP_URL = '/api/public/trial-signup'
