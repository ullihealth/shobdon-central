// Authenticated CRUD for the management pages (/config, /design,
// /runways). GET/PUT /api/tenant/config[?org=slug].
//
// Owner-gated (requireOwner, not just requireTenant/membership): /config,
// /design, and /runways are now owner-only pages (client-side gate in
// RequireAuth.tsx), and the underlying write API needs to enforce the
// same restriction server-side - a client-side-only gate would be
// trivially bypassable by any authenticated admin/atc member hitting
// this endpoint directly with their own valid session cookie. Read shape
// matches functions/api/public/[tenant]/config.ts exactly.

import { requireOwner, jsonResponse, syncOrganizationIdentity, type D1Database } from "../_utils/tenantAuth";
import { buildPublicConfigData } from "../_utils/publicConfig";
import { resolveTenantSlug, triggerTenantRefresh } from "../_utils/refreshDisplays";
import { geocodePostcode } from "../_utils/postcodeGeocode";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
  // "Refresh displays" round - this endpoint is shared by SIX different
  // callers (DesignPage, CafeMediaPage, ConfigPage, RunwaysPage,
  // AirfieldLocationSection, WeatherSourceSelector - all PUT here), only
  // two of which (Design's theme save, Runways' runwayGroups save)
  // previously fired their own client-side fetch(REFRESH_TRIGGER_URL).
  // The PUT handler below gates the server-side trigger on those exact
  // same two fields (body.theme / body.runwayGroups) so this stays
  // scoped to precisely those two save flows, not a blanket "refresh on
  // any /api/tenant/config write" that would newly affect the other four
  // callers, which never triggered a refresh before. See
  // _utils/refreshDisplays.ts's own comment for the CAPTURE_KEY shape.
  CAPTURE_KEY?: string;
}

interface RunwayGroupRow {
  id: string;
  endAIdentifier: string;
  endBIdentifier: string;
  headingDegrees: number;
  twin: number;
  stripLengthPx: number;
  identifierFontSizePx: number;
  stripsJson: string;
  sortOrder: number;
}

interface CameraSlotRow {
  slotNumber: number;
  label: string;
  url: string;
}

interface RunwayGroupInput {
  id: string;
  endAIdentifier: string;
  endBIdentifier: string;
  headingDegrees: number;
  twin: boolean;
  stripLengthPx: number;
  identifierFontSizePx: number;
  strips: unknown;
}

interface CameraSlotInput {
  slot: number;
  label: string;
  url: string;
}

// Migration 0039 - see publicConfig.ts's own copy of this same shape/
// helper for the full reasoning (independent logo/name display
// settings for Header.tsx vs VenueCornerBadge.tsx). Duplicated, not
// imported - this repo's established functions/src boundary convention.
interface BrandDisplaySettings {
  showLogo: boolean;
  showName: boolean;
  nameFontSize: "sm" | "md" | "lg" | "xl";
}

interface BrandDisplayConfig {
  main: BrandDisplaySettings;
  cafe: BrandDisplaySettings;
}

const DEFAULT_BRAND_DISPLAY: BrandDisplayConfig = {
  main: { showLogo: true, showName: true, nameFontSize: "md" },
  cafe: { showLogo: true, showName: true, nameFontSize: "md" },
};

function parseBrandDisplay(json: string | null | undefined): BrandDisplayConfig {
  if (!json) return DEFAULT_BRAND_DISPLAY;
  try {
    const parsed = JSON.parse(json);
    return {
      main: { ...DEFAULT_BRAND_DISPLAY.main, ...(parsed?.main ?? {}) },
      cafe: { ...DEFAULT_BRAND_DISPLAY.cafe, ...(parsed?.cafe ?? {}) },
    };
  } catch {
    return DEFAULT_BRAND_DISPLAY;
  }
}

const VALID_FONT_SIZES = new Set(["sm", "md", "lg", "xl"]);

function isValidBrandDisplaySettings(value: unknown): value is BrandDisplaySettings {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.showLogo === "boolean" && typeof v.showName === "boolean" && typeof v.nameFontSize === "string" && VALID_FONT_SIZES.has(v.nameFontSize);
}

// Migration 0040 - up to 5 reusable brand colours, admin-only (never
// exposed via publicConfig.ts - see that migration's own comment for
// the full reasoning). Parse failure/missing column falls back to an
// empty palette rather than breaking the whole GET response.
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MAX_SAVED_SWATCHES = 5;

function parseSavedSwatches(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && HEX_COLOR_PATTERN.test(v)).slice(0, MAX_SAVED_SWATCHES) : [];
  } catch {
    return [];
  }
}

function isValidSavedSwatches(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_SAVED_SWATCHES && value.every((v) => typeof v === "string" && HEX_COLOR_PATTERN.test(v));
}

// Airfield location (icaoCode/lat/lon) - unlike every other field on this
// route, invalid input here is REJECTED with a 400 rather than silently
// skipped. This data now feeds the weather providers' own tenant-location
// lookup (weather-metoffice.ts/weather-default.ts) and the automated NOTAM
// endpoint (functions/api/public/notams.ts), not just display - a bad
// coordinate silently accepted would quietly break both for this tenant.
const ICAO_PATTERN = /^[A-Za-z]{4}$/;

function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLon(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

// Postcode-based location entry round. UK postcode is now the PRIMARY
// way an admin sets an EXISTING tenant's location (AirfieldLocationSection.tsx)
// - reuses the exact same geocodePostcode() (_utils/postcodeGeocode.ts)
// the venue_cafe self-serve signup branch already established
// (trial-signup.ts/check-postcode.ts), not a second implementation, so
// there's only ever one place that talks to postcodes.io. That existing
// helper returns { valid, lat?, lon?, postcode?, error? } - resolved
// lat/lon go into the same columns everything downstream already reads
// (notams.ts, weather-metoffice.ts, weather-default.ts), plus the new
// postcode column (migration 0099, which that older round never added -
// it only ever persisted a free-text venueName+postcode blob into
// trial_signups.location_text, nothing structured on tenants itself).
// Raw lat/lon stays as a manual override (the block below this one) for
// the rare non-UK tenant or a postcode-lookup failure.

// Windsock strength thresholds (knots) - a sanity ceiling (100kt), not a
// real aviation limit, purely to reject obvious typos/garbage rather than
// silently accepting them; no floor beyond "positive", since an admin
// setting an unusually low threshold for their own airfield's windsock is
// a legitimate real-world choice, not something this endpoint should
// second-guess.
function isValidWindsockKt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

// Same union as WeatherProviderId (src/types/weatherConfig.ts) - not
// imported directly (this repo's established functions/src boundary
// convention, same as BrandDisplaySettings above), just kept in sync by
// hand since the set of providers changes rarely.
const VALID_WEATHER_PROVIDER_IDS = new Set(["atc", "internet", "ingested", "mock"]);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const [runwayRows, themeRow, tenantRow, cameraRows, publicConfigData] = await Promise.all([
    env.DB
      .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(organizationId)
      .all<RunwayGroupRow>(),
    env.DB
      .prepare("SELECT tokensJson, saved_swatches_json AS savedSwatchesJson FROM club_theme WHERE organizationId = ?")
      .bind(organizationId)
      .first<{ tokensJson: string; savedSwatchesJson: string | null }>(),
    // Same airfieldName field as the public config response - DesignPage.tsx's
    // preview renders the real Header component, which now needs this to
    // avoid falling back to its generic placeholder. logo_r2_key resolved
    // to logoUrl the same way publicConfig.ts does. icao_code/lat/lon added
    // for ConfigPage.tsx's Airfield Location section - the same columns
    // weather-metoffice.ts/weather-default.ts already read server-side for
    // this tenant's own weather lookup, now finally editable instead of
    // only ever hand-inserted directly into D1.
    env.DB
      .prepare(
        // slug/parentSlug added for internetProviderDisplayName below -
        // same derivation as publicConfig.ts's own copy (see that
        // file's comment for the full "why"); internet_provider_
        // display_name (migration 0083) is no longer read, left inert.
        "SELECT name, logo_r2_key AS logoR2Key, has_physical_atc AS hasPhysicalAtc, brand_display_json AS brandDisplayJson, icao_code AS icaoCode, lat, lon, postcode, windsock_band2_kt AS windsockBand2Kt, windsock_band3_kt AS windsockBand3Kt, windsock_band4_kt AS windsockBand4Kt, windsock_band5_kt AS windsockBand5Kt, active_weather_provider AS activeWeatherProvider, overscan_safe_margin_enabled AS overscanSafeMarginEnabled, overscan_safe_margin_percent AS overscanSafeMarginPercent, tenants.slug AS slug, (SELECT p.slug FROM tenants p WHERE p.id = tenants.parent_tenant_id) AS parentSlug FROM tenants WHERE organization_id = ?"
      )
      .bind(organizationId)
      .first<{
        name: string;
        logoR2Key: string | null;
        hasPhysicalAtc: number;
        brandDisplayJson: string | null;
        icaoCode: string | null;
        lat: number | null;
        lon: number | null;
        postcode: string | null;
        windsockBand2Kt: number;
        windsockBand3Kt: number;
        windsockBand4Kt: number;
        windsockBand5Kt: number;
        activeWeatherProvider: string | null;
        overscanSafeMarginEnabled: number;
        overscanSafeMarginPercent: number;
        slug: string;
        parentSlug: string | null;
      }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(organizationId)
      .all<CameraSlotRow>(),
    // carouselSlots/cafeCarouselSlots/opsPanel - reuses the exact same
    // query/mapping logic the public (Host-resolved) config route uses,
    // just resolved via THIS request's own session/org-switcher instead
    // of the browser's current Host header. Added this round so
    // DesignPage.tsx/CafeMediaPage.tsx's MediaPanel previews can stop
    // self-fetching the Host-resolved public endpoint (see MediaPanel's
    // own `data` prop) - an admin viewing a DIFFERENT tenant's preview
    // than whatever subdomain they happen to be on was silently seeing
    // that OTHER tenant's real carousel/ops-panel content, not the one
    // their session was actually switched to. Some overlap with the
    // queries above (runwayGroups/theme/tenant/cameraSlots get
    // re-fetched inside this call too) - accepted as a cheap, indexed,
    // one-extra-round-trip cost rather than further splitting
    // buildPublicConfigData just to avoid it.
    buildPublicConfigData(organizationId, env),
  ]);

  // Internet-weather (Open-Meteo) display name - same derivation as
  // publicConfig.ts's own copy (see that file's comment for the full
  // "why"). "Open-Meteo" is never shown to any tenant.
  const isShobdonRelated = tenantRow?.slug === "shobdon" || tenantRow?.parentSlug === "shobdon";
  const internetProviderDisplayName = isShobdonRelated ? "Met-Office SAWS" : "Met-Office";

  return jsonResponse({
    runwayGroups: runwayRows.results.map((row) => ({
      id: row.id,
      endAIdentifier: row.endAIdentifier,
      endBIdentifier: row.endBIdentifier,
      headingDegrees: row.headingDegrees,
      twin: !!row.twin,
      stripLengthPx: row.stripLengthPx,
      identifierFontSizePx: row.identifierFontSizePx,
      strips: JSON.parse(row.stripsJson),
    })),
    theme: themeRow ? JSON.parse(themeRow.tokensJson) : null,
    savedSwatches: parseSavedSwatches(themeRow?.savedSwatchesJson),
    airfieldName: tenantRow?.name ?? null,
    logoUrl: tenantRow?.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenantRow.logoR2Key}` : null,
    hasPhysicalAtc: !!tenantRow?.hasPhysicalAtc,
    brandDisplay: parseBrandDisplay(tenantRow?.brandDisplayJson),
    icaoCode: tenantRow?.icaoCode ?? null,
    lat: tenantRow?.lat ?? null,
    lon: tenantRow?.lon ?? null,
    postcode: tenantRow?.postcode ?? null,
    // Runway/Wind widget - 5-tier windsock (migration 0079), same
    // real-world-convention fallback defaults as publicConfig.ts's own
    // copy. bandNKt = crosswind speed (kt) at/above which windsock-N.png
    // shows instead of windsock-(N-1).png.
    windsock: {
      band2Kt: tenantRow?.windsockBand2Kt ?? 3,
      band3Kt: tenantRow?.windsockBand3Kt ?? 7,
      band4Kt: tenantRow?.windsockBand4Kt ?? 11,
      band5Kt: tenantRow?.windsockBand5Kt ?? 15,
    },
    // Shared weather-provider selection (migration 0082) - null means no
    // admin choice has ever been recorded server-side yet, same "not
    // set" meaning ConfigPage.tsx/weatherConfigStore.ts already give a
    // null/missing value everywhere else on this endpoint.
    activeWeatherProvider: tenantRow?.activeWeatherProvider ?? null,
    internetProviderDisplayName,
    // Overscan safe-margin (migration 0101) - see OverscanSafeFrame.tsx's
    // own comment for the full "why". percent defaults to 4 at the DB
    // layer (a brand-new tenant that's never touched this reads 4, not
    // some other arbitrary number, the moment they first turn it on).
    overscanSafeMarginEnabled: !!tenantRow?.overscanSafeMarginEnabled,
    overscanSafeMarginPercent: tenantRow?.overscanSafeMarginPercent ?? 4,
    cameraSlots: cameraRows.results.map((row) => ({ slot: row.slotNumber, label: row.label, url: row.url })),
    cameras: publicConfigData.cameras,
    carouselSlots: publicConfigData.carouselSlots,
    cafeCarouselSlots: publicConfigData.cafeCarouselSlots,
    opsPanel: publicConfigData.opsPanel,
    gasPrices: publicConfigData.gasPrices,
  });
};

// Replace-all semantics per config area included in the body, matching
// the existing client behaviour this replaces (saveClubProfile/theme POST
// always wrote the complete set) - minimises client-side changes at
// cutover time. Only areas present in the body are touched.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as {
    runwayGroups?: RunwayGroupInput[];
    theme?: Record<string, string>;
    cameraSlots?: CameraSlotInput[];
    airfieldName?: string;
    brandDisplay?: { main?: unknown; cafe?: unknown };
    savedSwatches?: unknown;
    icaoCode?: unknown;
    lat?: unknown;
    lon?: unknown;
    postcode?: unknown;
    windsock?: { band2Kt?: unknown; band3Kt?: unknown; band4Kt?: unknown; band5Kt?: unknown };
    activeWeatherProvider?: unknown;
    overscanSafeMarginEnabled?: unknown;
    overscanSafeMarginPercent?: unknown;
  } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const now = new Date().toISOString();

  // Writes tenants.name directly - the same column airfieldName already
  // reads (both here and in publicConfig.ts). Self-service branding edit;
  // requireOwner above is the only gate needed, matching every other
  // field this endpoint already writes.
  if (typeof body.airfieldName === "string" && body.airfieldName.trim()) {
    const airfieldName = body.airfieldName.trim();
    await env.DB
      .prepare("UPDATE tenants SET name = ?, updated_at = ? WHERE organization_id = ?")
      .bind(airfieldName, now, organizationId)
      .run();
    // Keep organization.name in sync with the rename above - see
    // syncOrganizationIdentity's own comment for why this is required
    // on every write to tenants.name, not just this one.
    await syncOrganizationIdentity(env.DB, organizationId, { name: airfieldName });
  }

  // icaoCode: optional - "" or null clears it, anything else must be
  // exactly 4 alphabetic characters, uppercased on save (ICAO codes are
  // conventionally upper case; normalising here means the frontend never
  // needs to worry about the casing a tenant happens to type).
  if (body.icaoCode !== undefined) {
    if (body.icaoCode === null || body.icaoCode === "") {
      await env.DB
        .prepare("UPDATE tenants SET icao_code = NULL, updated_at = ? WHERE organization_id = ?")
        .bind(now, organizationId)
        .run();
    } else if (typeof body.icaoCode === "string" && ICAO_PATTERN.test(body.icaoCode.trim())) {
      await env.DB
        .prepare("UPDATE tenants SET icao_code = ?, updated_at = ? WHERE organization_id = ?")
        .bind(body.icaoCode.trim().toUpperCase(), now, organizationId)
        .run();
    } else {
      return jsonResponse({ error: "icaoCode must be exactly 4 alphabetic characters" }, 400);
    }
  }

  // postcode: the primary location-entry path (AirfieldLocationSection.tsx's
  // "Locate" action) - resolved server-side via postcodes.io, writing
  // BOTH the raw postcode and the resolved lat/lon in one request. "" or
  // null clears the postcode only (same "independent field" precedent as
  // icaoCode above) - it deliberately does NOT also clear lat/lon, since
  // an admin might clear a mistyped postcode while keeping the
  // coordinates it had already resolved to, or might be about to set
  // lat/lon manually via the advanced override instead. Runs before the
  // lat/lon block below so an explicit lat/lon in the SAME request (not
  // expected from the UI - postcode and manual override are separate
  // actions - but not rejected either) always wins as the more specific,
  // more recently-stated instruction.
  let resolvedLocation: { lat: number; lon: number; postcode: string } | null = null;
  if (body.postcode !== undefined) {
    if (body.postcode === null || body.postcode === "") {
      await env.DB
        .prepare("UPDATE tenants SET postcode = NULL, updated_at = ? WHERE organization_id = ?")
        .bind(now, organizationId)
        .run();
    } else if (typeof body.postcode === "string") {
      const geocoded = await geocodePostcode(body.postcode);
      if (!geocoded.valid || typeof geocoded.lat !== "number" || typeof geocoded.lon !== "number" || !geocoded.postcode) {
        return jsonResponse({ error: geocoded.error ?? "Postcode not found" }, 400);
      }
      await env.DB
        .prepare("UPDATE tenants SET postcode = ?, lat = ?, lon = ?, updated_at = ? WHERE organization_id = ?")
        .bind(geocoded.postcode, geocoded.lat, geocoded.lon, now, organizationId)
        .run();
      resolvedLocation = { lat: geocoded.lat, lon: geocoded.lon, postcode: geocoded.postcode };
    } else {
      return jsonResponse({ error: "postcode must be a string" }, 400);
    }
  }

  // lat/lon: a pair - either both present and valid, or neither touched.
  // A lone lat or lon is meaningless, so it's rejected rather than
  // half-written (the client form always sends both together anyway).
  if (body.lat !== undefined || body.lon !== undefined) {
    if (!isValidLat(body.lat)) {
      return jsonResponse({ error: "lat must be a number between -90 and 90" }, 400);
    }
    if (!isValidLon(body.lon)) {
      return jsonResponse({ error: "lon must be a number between -180 and 180" }, 400);
    }
    await env.DB
      .prepare("UPDATE tenants SET lat = ?, lon = ?, updated_at = ? WHERE organization_id = ?")
      .bind(body.lat, body.lon, now, organizationId)
      .run();
  }

  // Same "all or nothing" posture as lat/lon above - a partial set of
  // thresholds is meaningless without the rest to compare against.
  // Monotonic-ordering check (band2 < band3 < band4 < band5) added on
  // top of the existing per-value range check - not part of the old
  // 2-threshold system (nothing to be out of order with just one pair),
  // but with 4 values a simple typo could otherwise silently put them
  // out of sequence and make determineWindsockTier's cascade pick the
  // wrong tier without ever erroring.
  if (body.windsock !== undefined) {
    const { band2Kt, band3Kt, band4Kt, band5Kt } = body.windsock ?? {};
    if (!isValidWindsockKt(band2Kt)) {
      return jsonResponse({ error: "windsock.band2Kt must be a number between 0 and 100" }, 400);
    }
    if (!isValidWindsockKt(band3Kt)) {
      return jsonResponse({ error: "windsock.band3Kt must be a number between 0 and 100" }, 400);
    }
    if (!isValidWindsockKt(band4Kt)) {
      return jsonResponse({ error: "windsock.band4Kt must be a number between 0 and 100" }, 400);
    }
    if (!isValidWindsockKt(band5Kt)) {
      return jsonResponse({ error: "windsock.band5Kt must be a number between 0 and 100" }, 400);
    }
    if (!(band2Kt < band3Kt && band3Kt < band4Kt && band4Kt < band5Kt)) {
      return jsonResponse({ error: "windsock bands must be strictly increasing: band2Kt < band3Kt < band4Kt < band5Kt" }, 400);
    }
    await env.DB
      .prepare("UPDATE tenants SET windsock_band2_kt = ?, windsock_band3_kt = ?, windsock_band4_kt = ?, windsock_band5_kt = ?, updated_at = ? WHERE organization_id = ?")
      .bind(band2Kt, band3Kt, band4Kt, band5Kt, now, organizationId)
      .run();
  }

  // Shared weather-provider selection (migration 0082) - the server-side
  // fix for the localStorage-only selection that never left the device
  // that made it. null explicitly clears back to "no admin choice
  // recorded" (falls back to weather-default.ts's own structural
  // derivation, same as before this column existed) - anything else must
  // be one of the real provider ids.
  if (body.activeWeatherProvider !== undefined) {
    if (body.activeWeatherProvider === null) {
      await env.DB
        .prepare("UPDATE tenants SET active_weather_provider = NULL, updated_at = ? WHERE organization_id = ?")
        .bind(now, organizationId)
        .run();
    } else if (typeof body.activeWeatherProvider === "string" && VALID_WEATHER_PROVIDER_IDS.has(body.activeWeatherProvider)) {
      await env.DB
        .prepare("UPDATE tenants SET active_weather_provider = ?, updated_at = ? WHERE organization_id = ?")
        .bind(body.activeWeatherProvider, now, organizationId)
        .run();
    } else {
      return jsonResponse({ error: "activeWeatherProvider must be one of atc, internet, ingested, mock, or null" }, 400);
    }
  }

  // Overscan safe-margin (migration 0101, OverscanSafeFrame.tsx) - self-
  // service, Screens Design's own "Displays" tab. Independent booleans/
  // fields (not an "all or nothing" pair like lat/lon above) - a tenant
  // can toggle the feature off without also having to resend a valid
  // percent, and can adjust the percent while leaving it enabled.
  if (body.overscanSafeMarginEnabled !== undefined) {
    if (typeof body.overscanSafeMarginEnabled !== "boolean") {
      return jsonResponse({ error: "overscanSafeMarginEnabled must be a boolean" }, 400);
    }
    await env.DB
      .prepare("UPDATE tenants SET overscan_safe_margin_enabled = ?, updated_at = ? WHERE organization_id = ?")
      .bind(body.overscanSafeMarginEnabled ? 1 : 0, now, organizationId)
      .run();
  }
  if (body.overscanSafeMarginPercent !== undefined) {
    if (typeof body.overscanSafeMarginPercent !== "number" || body.overscanSafeMarginPercent < 2 || body.overscanSafeMarginPercent > 25) {
      return jsonResponse({ error: "overscanSafeMarginPercent must be a number between 2 and 25" }, 400);
    }
    await env.DB
      .prepare("UPDATE tenants SET overscan_safe_margin_percent = ?, updated_at = ? WHERE organization_id = ?")
      .bind(body.overscanSafeMarginPercent, now, organizationId)
      .run();
  }

  // Both main and cafe must be present and valid - a partial/malformed
  // object is rejected rather than silently merged with defaults, since
  // this would otherwise let a client accidentally reset the other
  // page's settings back to defaults by omission.
  if (body.brandDisplay && isValidBrandDisplaySettings(body.brandDisplay.main) && isValidBrandDisplaySettings(body.brandDisplay.cafe)) {
    await env.DB
      .prepare("UPDATE tenants SET brand_display_json = ?, updated_at = ? WHERE organization_id = ?")
      .bind(JSON.stringify({ main: body.brandDisplay.main, cafe: body.brandDisplay.cafe }), now, organizationId)
      .run();
  }

  // Plain UPDATE, not an upsert - club_theme always has a row for a real
  // tenant by this point (every onboarding path clones/seeds one, see
  // migration 0040's own comment), same assumption brandDisplay's write
  // above already relies on for tenants. Deliberately independent of the
  // theme write below - saving a swatch must never require also having
  // an in-progress theme edit pending.
  if (isValidSavedSwatches(body.savedSwatches)) {
    await env.DB
      .prepare("UPDATE club_theme SET saved_swatches_json = ?, updatedAt = ? WHERE organizationId = ?")
      .bind(JSON.stringify(body.savedSwatches), now, organizationId)
      .run();
  }

  // "Refresh displays" round - set by the runwayGroups/theme blocks
  // below (RunwaysPage.tsx's and DesignPage.tsx's own saves,
  // respectively - the only two of this endpoint's six callers that
  // ever triggered a refresh), consumed once near this handler's own
  // return so sending both fields in one request (nothing does today)
  // can't double-trigger.
  let shouldTriggerRefresh = false;

  if (Array.isArray(body.runwayGroups)) {
    shouldTriggerRefresh = true;
    await env.DB.prepare("DELETE FROM runway_groups WHERE organizationId = ?").bind(organizationId).run();
    for (const [index, group] of body.runwayGroups.entries()) {
      await env.DB
        .prepare(
          // label is still written (as `endA/endB`) purely to satisfy the
          // column's existing NOT NULL constraint - nothing reads it
          // anymore (see migration 0015). Not worth an ALTER TABLE DROP
          // COLUMN / table-recreate for an inert column.
          "INSERT INTO runway_groups (id, organizationId, label, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          group.id,
          organizationId,
          `${group.endAIdentifier}/${group.endBIdentifier}`,
          group.endAIdentifier,
          group.endBIdentifier,
          group.headingDegrees,
          group.twin ? 1 : 0,
          group.stripLengthPx,
          group.identifierFontSizePx,
          JSON.stringify(group.strips),
          index,
          now
        )
        .run();
    }
  }

  if (body.theme && typeof body.theme === "object") {
    shouldTriggerRefresh = true;
    await env.DB
      .prepare(
        "INSERT INTO club_theme (organizationId, tokensJson, updatedAt) VALUES (?, ?, ?) ON CONFLICT(organizationId) DO UPDATE SET tokensJson = excluded.tokensJson, updatedAt = excluded.updatedAt"
      )
      .bind(organizationId, JSON.stringify(body.theme), now)
      .run();
  }

  if (Array.isArray(body.cameraSlots)) {
    for (const slot of body.cameraSlots) {
      if (slot.slot < 1 || slot.slot > 3) continue;
      await env.DB
        .prepare(
          "INSERT INTO camera_slots (organizationId, slotNumber, label, url, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(organizationId, slotNumber) DO UPDATE SET label = excluded.label, url = excluded.url, updatedAt = excluded.updatedAt"
        )
        .bind(organizationId, slot.slot, slot.label, slot.url, now)
        .run();
    }
  }

  // Refreshes this SAME tenant's own live displays, never any other
  // tenant's - see refreshDisplays.ts's own comment. Awaited (Pages
  // Functions have no ctx.waitUntil in this codebase's own hand-rolled
  // PagesFunction type - an unawaited promise risks being dropped once
  // this function returns), but triggerTenantRefresh swallows its own
  // errors and is timeout-bounded, so a slow/failed Worker call adds a
  // small bounded amount of latency here, never fails this response.
  if (shouldTriggerRefresh) {
    const tenantSlug = await resolveTenantSlug(env.DB, organizationId);
    if (tenantSlug) {
      await triggerTenantRefresh(env, tenantSlug);
    }
  }

  // resolvedLocation only present when this same request just geocoded a
  // postcode - lets AirfieldLocationSection.tsx show "Located near: X"
  // immediately without a second round trip back to GET.
  return jsonResponse({ ok: true, ...(resolvedLocation ? { resolvedLocation } : {}) });
};
