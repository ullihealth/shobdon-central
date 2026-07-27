// Platform-admin only: POST /api/platform/tenants/onboard - creates a
// new real-customer tenant cloned from the newcustomer template tenant
// (see functions/api/_utils/cloneTenant.ts) and mints a single-use
// invite link for the developer to copy/send manually - no email-
// sending infrastructure exists yet (a documented, deliberate gap, not
// an oversight).
//
// Optional JSON body { slug?: string } - a human-chosen subdomain
// (wildcard DNS/Worker migration round: any valid subdomain now
// resolves automatically the instant the tenant row exists, no
// Cloudflare API call needed, so this is now a pure data-validation
// feature, not an infra one). Omitted/empty body -> unchanged random-
// slug behaviour (tenant-XXXXXXXX), same as before this round - this
// keeps the existing one-click flow working exactly as it did.
//
// Format/reserved-word validation lives in ../../_utils/tenantSlug.ts,
// shared with check-slug.ts (this form's live-as-you-type check) and
// trial-signup.ts's own reserved list. That's advisory only, for fast
// form feedback - the real atomic uniqueness guarantee is tenants.slug's
// (and organization.slug's) own SQL-level UNIQUE constraint (migration
// 0022_tenant_schema.sql, already existed, no new migration needed),
// enforced below via a try/catch around the actual INSERTs so a genuine
// race between two concurrent requests can never create two tenants
// with the same slug, only ever one plus a clear error on the other.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { cloneTenantTemplate } from "../../_utils/cloneTenant";
import { validateSlugCandidate } from "../../_utils/tenantSlug";

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

  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const requestedSlug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";

  let slug: string | null = null;
  // Subdomain-picker round: distinguishes "a human deliberately chose
  // this" from "onboard.ts's own random fallback" (migration
  // 0046_tenant_subdomain_confirmed.sql) - the customer-facing
  // /onboard/:token completion flow uses this to decide whether it
  // still needs to ask, rather than pattern-matching randomSlug()'s own
  // output format (fragile - breaks silently if that format ever
  // changes).
  const subdomainConfirmed = !!requestedSlug;

  if (requestedSlug) {
    const validation = validateSlugCandidate(requestedSlug);
    if (!validation.valid) return jsonResponse({ error: validation.error }, 400);

    // Pre-check so a taken/reserved subdomain surfaces as a clear error
    // BEFORE anything is created, not as a confusing failure partway
    // through - the try/catch around the actual INSERTs below is the
    // real guarantee against a race, this is just the common-case fast
    // path that avoids ever hitting that catch block in practice.
    const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(requestedSlug).first<{ id: number }>();
    if (existing) return jsonResponse({ error: "That subdomain is already taken" }, 409);

    slug = requestedSlug;
  } else {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = randomSlug();
      const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(candidate).first<{ id: number }>();
      if (!existing) {
        slug = candidate;
        break;
      }
    }
    if (!slug) return jsonResponse({ error: "Could not generate a unique tenant address - please try again" }, 500);
  }

  const now = new Date().toISOString();
  const organizationId = `org_${slug}`;
  const subdomain = `${slug}.airfieldcentral.com`;
  const placeholderName = "Your Airfield Name";

  try {
    await env.DB
      .prepare("INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)")
      .bind(organizationId, placeholderName, slug, now)
      .run();
  } catch {
    // organization.slug is UNIQUE (migration 0002_organization_plugin.sql) -
    // only reachable via a genuine race with another request choosing
    // the exact same slug between the pre-check above and this INSERT.
    // The random-slug path effectively never hits this (8 random chars,
    // astronomically unlikely to collide); a human-chosen slug is the
    // realistic case this exists for.
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }

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

  try {
    await env.DB
      .prepare(
        `INSERT INTO tenants (slug, name, subdomain, organization_id, icao_code, lat, lon, weather_public, ops_public, active, is_internal, logo_r2_key, brand_display_json, subdomain_confirmed)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 1, 0, NULL, ?, ?)`
      )
      .bind(slug, placeholderName, subdomain, organizationId, defaultBrandDisplay, subdomainConfirmed ? 1 : 0)
      .run();
  } catch {
    // tenants.slug/subdomain are both UNIQUE (migration
    // 0022_tenant_schema.sql) - same race window as the organization
    // INSERT above, now on the second of the two UNIQUE columns this
    // flow touches. The organization row created just above is now
    // orphaned - harmless and invisible to any tenant-facing surface,
    // same accepted tradeoff trial-signup.ts's own identical race
    // handling already documents, not worth a rollback mechanism for
    // this rare a case.
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }

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

  // active=0 alongside entitled=0 (Tom Galloway/Gyroplane Train round) -
  // entitled alone already keeps the public /d/cafe-tv route 404ing
  // (functions/api/public/display.ts's isCurrentlyEntitled check), but
  // Jeff wants café fully off, not merely unentitled, until he
  // deliberately turns it on via Platform Tenants - active is migration
  // 0034's own independent developer force-off flag (Part D), completely
  // separate from entitled (Part C), and defaults to 1 on the table
  // itself (grandfathering pre-existing rows), so it must be forced
  // here explicitly, same reasoning as entitled just above.
  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active)
       VALUES (?, 'cafe-tv', 'Clubhouse Cafe TV', 'cafe-1', 0, 0)`
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
