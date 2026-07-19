// Public, UNAUTHENTICATED read for a single named tenant display
// (tenant_displays, migration 0027) - GET /api/public/display?slug=<slug>
// -> { slug, name, templateId, panelConfig }. slug defaults to 'main'
// when omitted, matching every tenant's guaranteed seeded row so every
// existing bookmarked/embedded dashboard URL (which never passes a
// slug) is unaffected by this endpoint's existence.
//
// Host-resolved tenant, same as functions/api/public/config.ts - this
// is the same static JS bundle served to every tenant's subdomain, so
// it can't know its own tenant at build time either. Does not return
// the actual weather/ops/theme/carousel data itself (still
// PUBLIC_CONFIG_URL's job, unchanged) - just which template + which
// panels this named display should render.
//
// Migration 0034 gates: a display can be individually force-disabled
// (`active`, Part D - support/maintenance, independent of billing) and,
// for the café display specifically, entitlement-gated (`entitled` +
// optional trial expiry, Part C). Both cases return the exact same 404
// shape as "no display named X" - TenantDisplayPage.tsx already treats
// any non-ok response as "show the clean unavailable state", so this
// deliberately doesn't need a new response shape or a frontend change,
// matching TenantUnavailable's own documented stance of never exposing
// WHICH internal reason produced the unavailable state.

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantDisplayRow {
  slug: string;
  name: string;
  templateId: string;
  panelConfigJson: string | null;
  active: number;
  entitled: number;
  entitlementTrialExpiresAt: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Live, read-time check - no background job flips `entitled` back to 0
// when a trial lapses (same discipline as tenants.active and every
// other gate in this app: check live, don't maintain derived state).
function isCurrentlyEntitled(row: Pick<TenantDisplayRow, "entitled" | "entitlementTrialExpiresAt">): boolean {
  if (!row.entitled) return false;
  if (row.entitlementTrialExpiresAt && new Date(row.entitlementTrialExpiresAt).getTime() <= Date.now()) return false;
  return true;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const slug = new URL(request.url).searchParams.get("slug") || "main";

  const row = await env.DB
    .prepare(
      "SELECT slug, name, template_id AS templateId, panel_config AS panelConfigJson, active, entitled, entitlement_trial_expires_at AS entitlementTrialExpiresAt FROM tenant_displays WHERE tenant_id = ? AND slug = ?"
    )
    .bind(tenant.id, slug)
    .first<TenantDisplayRow>();

  if (!row) return jsonResponse({ error: `No display named '${slug}' for this tenant` }, 404);
  if (!row.active) return jsonResponse({ error: `Display '${slug}' is currently disabled` }, 404);
  if (row.slug === "cafe-tv" && !isCurrentlyEntitled(row)) {
    return jsonResponse({ error: `Display '${slug}' is not entitled` }, 404);
  }

  return jsonResponse({
    slug: row.slug,
    name: row.name,
    templateId: row.templateId,
    panelConfig: row.panelConfigJson ? JSON.parse(row.panelConfigJson) : null,
  });
};
