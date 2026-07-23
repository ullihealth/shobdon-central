// Platform-admin only: POST /api/platform/tenants/onboard - one click,
// no form input. Creates a new real-customer tenant cloned from the
// newcustomer template tenant (see functions/api/_utils/cloneTenant.ts)
// and mints a single-use invite link for the developer to copy/send
// manually - no email-sending infrastructure exists yet (a documented,
// deliberate gap, not an oversight).
//
// The slug is a random opaque string, not derived from a business name -
// unlike trial-signup.ts's flow, the real business name isn't known at
// this point (the invitee sets it themselves during the branding step),
// and the slug isn't customer-facing anywhere in this pipeline (the
// whole flow runs path-based on the existing app domain, not the new
// tenant's own subdomain - see the plan's own note on why no Cloudflare
// custom-domain work is needed for onboarding itself).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { cloneTenantTemplate } from "../../_utils/cloneTenant";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const TEMPLATE_SLUG = "newcustomer";
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_SLUG_ATTEMPTS = 20;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function randomSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const byte of bytes) suffix += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  return `tenant-${suffix}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const template = await env.DB
    .prepare("SELECT id, organization_id AS organizationId FROM tenants WHERE slug = ?")
    .bind(TEMPLATE_SLUG)
    .first<{ id: number; organizationId: string | null }>();
  if (!template || !template.organizationId) {
    return jsonResponse({ error: "Template tenant 'newcustomer' is missing or has no linked organization" }, 500);
  }

  let slug: string | null = null;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = randomSlug();
    const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(candidate).first<{ id: number }>();
    if (!existing) {
      slug = candidate;
      break;
    }
  }
  if (!slug) return jsonResponse({ error: "Could not generate a unique tenant address - please try again" }, 500);

  const now = new Date().toISOString();
  const organizationId = `org_${slug}`;
  const subdomain = `${slug}.airfieldcentral.com`;
  const placeholderName = "Your Airfield Name";

  await env.DB
    .prepare("INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)")
    .bind(organizationId, placeholderName, slug, now)
    .run();

  // brand_display_json explicit here, not left to the column's own
  // DEFAULT (both showLogo/showName true) - same reasoning as
  // trial-signup.ts's own tenant INSERT: a brand-new tenant hasn't
  // uploaded a logo yet, so name-text-only is the sane starting point,
  // and the two are now mutually exclusive in the Branding tab UI
  // anyway (DesignPage.tsx) rather than independently checkable.
  const defaultBrandDisplay = JSON.stringify({
    main: { showLogo: false, showName: true, nameFontSize: "md" },
    cafe: { showLogo: false, showName: true, nameFontSize: "md" },
  });

  await env.DB
    .prepare(
      `INSERT INTO tenants (slug, name, subdomain, organization_id, icao_code, lat, lon, weather_public, ops_public, active, is_internal, logo_r2_key, brand_display_json)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 1, 0, NULL, ?)`
    )
    .bind(slug, placeholderName, subdomain, organizationId, defaultBrandDisplay)
    .run();

  await cloneTenantTemplate(env.DB, template.organizationId, organizationId, slug);

  const tenantRow = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (!tenantRow) return jsonResponse({ error: "Failed to provision the new tenant" }, 500);

  // tenant_displays (migration 0027) was never actually auto-created by
  // any onboarding path before this - confirmed by inspection, not
  // assumed (publicConfig.ts/DashboardPage.tsx's "missing row defaults
  // to classic" fallback just made that gap invisible). Both rows are
  // explicit here now: 'main' with the same panel_config shape migration
  // 0027's own one-time seed used, and 'cafe-tv' pointed at the new
  // CafeTemplate ('cafe-1', migration 0034) but starting entitled=0 -
  // a brand-new signup must never get free café access. created_at/
  // updated_at are left to the table's own DEFAULT (datetime('now')).
  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, panel_config)
       VALUES (?, 'main', 'Main Dashboard', 'classic', ?)`
    )
    .bind(tenantRow.id, JSON.stringify({ weather: true, compass: true, media: true, ops: true }))
    .run();

  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled)
       VALUES (?, 'cafe-tv', 'Clubhouse Cafe TV', 'cafe-1', 0)`
    )
    .bind(tenantRow.id)
    .run();

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await env.DB
    .prepare(
      "INSERT INTO tenant_invites (token, tenant_id, organization_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(token, tenantRow.id, organizationId, result.userId, expiresAt)
    .run();

  const origin = new URL(request.url).origin;
  const inviteUrl = `${origin}/onboard/${token}`;

  return jsonResponse({ tenantId: tenantRow.id, slug, inviteUrl, expiresAt });
};
