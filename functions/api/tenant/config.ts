// Authenticated CRUD for the management pages (/config, /design,
// /runways once cutover happens). GET/PUT /api/tenant/config[?org=slug].
//
// Every request here must pass BOTH checks before touching data:
//   1. is this user logged in at all (getSessionUserId)
//   2. does this user actually belong to the tenant they're targeting
//      (resolveTenantMembership, backed by the member table - not just
//      "is ?org= a real organization")
// Read shape matches functions/api/public/[tenant]/config.ts exactly, so
// the eventual management-page cutover can reuse the same parsing code
// as the public dashboard - this route just additionally requires and
// enforces a session.

import {
  getSessionUserId,
  resolveTenantMembership,
  jsonResponse,
  type D1Database,
} from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface RunwayGroupRow {
  id: string;
  label: string;
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
  label: string;
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

async function requireTenant(request: Request, env: Env) {
  const userId = await getSessionUserId(request);
  if (!userId) return { error: jsonResponse({ error: "Unauthorized" }, 401) } as const;

  const orgSlug = new URL(request.url).searchParams.get("org");
  const membership = await resolveTenantMembership(env.DB, userId, orgSlug);
  if (!membership) return { error: jsonResponse({ error: "Forbidden" }, 403) } as const;

  return { membership } as const;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const [runwayRows, themeRow, cameraRows] = await Promise.all([
    env.DB
      .prepare("SELECT id, label, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(organizationId)
      .all<RunwayGroupRow>(),
    env.DB.prepare("SELECT tokensJson FROM club_theme WHERE organizationId = ?").bind(organizationId).first<{ tokensJson: string }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(organizationId)
      .all<CameraSlotRow>(),
  ]);

  return jsonResponse({
    runwayGroups: runwayRows.results.map((row) => ({
      id: row.id,
      label: row.label,
      headingDegrees: row.headingDegrees,
      twin: !!row.twin,
      stripLengthPx: row.stripLengthPx,
      identifierFontSizePx: row.identifierFontSizePx,
      strips: JSON.parse(row.stripsJson),
    })),
    theme: themeRow ? JSON.parse(themeRow.tokensJson) : null,
    cameraSlots: cameraRows.results.map((row) => ({ slot: row.slotNumber, label: row.label, url: row.url })),
  });
};

// Replace-all semantics per config area included in the body, matching
// the existing client behaviour this replaces (saveClubProfile/theme POST
// always wrote the complete set) - minimises client-side changes at
// cutover time. Only areas present in the body are touched.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as {
    runwayGroups?: RunwayGroupInput[];
    theme?: Record<string, string>;
    cameraSlots?: CameraSlotInput[];
  } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const now = new Date().toISOString();

  if (Array.isArray(body.runwayGroups)) {
    await env.DB.prepare("DELETE FROM runway_groups WHERE organizationId = ?").bind(organizationId).run();
    for (const [index, group] of body.runwayGroups.entries()) {
      await env.DB
        .prepare(
          "INSERT INTO runway_groups (id, organizationId, label, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          group.id,
          organizationId,
          group.label,
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
