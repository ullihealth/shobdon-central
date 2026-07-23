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

import { requireOwner, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const [runwayRows, themeRow, tenantRow, cameraRows] = await Promise.all([
    env.DB
      .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(organizationId)
      .all<RunwayGroupRow>(),
    env.DB.prepare("SELECT tokensJson FROM club_theme WHERE organizationId = ?").bind(organizationId).first<{ tokensJson: string }>(),
    // Same airfieldName field as the public config response - DesignPage.tsx's
    // preview renders the real Header component, which now needs this to
    // avoid falling back to its generic placeholder. logo_r2_key resolved
    // to logoUrl the same way publicConfig.ts does.
    env.DB
      .prepare(
        "SELECT name, logo_r2_key AS logoR2Key, has_physical_atc AS hasPhysicalAtc, brand_display_json AS brandDisplayJson FROM tenants WHERE organization_id = ?"
      )
      .bind(organizationId)
      .first<{ name: string; logoR2Key: string | null; hasPhysicalAtc: number; brandDisplayJson: string | null }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(organizationId)
      .all<CameraSlotRow>(),
  ]);

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
    airfieldName: tenantRow?.name ?? null,
    logoUrl: tenantRow?.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenantRow.logoR2Key}` : null,
    hasPhysicalAtc: !!tenantRow?.hasPhysicalAtc,
    brandDisplay: parseBrandDisplay(tenantRow?.brandDisplayJson),
    cameraSlots: cameraRows.results.map((row) => ({ slot: row.slotNumber, label: row.label, url: row.url })),
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
  } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const now = new Date().toISOString();

  // Writes tenants.name directly - the same column airfieldName already
  // reads (both here and in publicConfig.ts). Self-service branding edit;
  // requireOwner above is the only gate needed, matching every other
  // field this endpoint already writes.
  if (typeof body.airfieldName === "string" && body.airfieldName.trim()) {
    await env.DB
      .prepare("UPDATE tenants SET name = ?, updated_at = ? WHERE organization_id = ?")
      .bind(body.airfieldName.trim(), now, organizationId)
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

  if (Array.isArray(body.runwayGroups)) {
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

  return jsonResponse({ ok: true });
};
