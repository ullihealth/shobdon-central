// Platform-admin only: POST /api/platform/tenants/onboard - creates a
// new real-customer tenant cloned from the newcustomer template tenant
// (see functions/api/_utils/cloneTenant.ts) and mints a single-use
// invite link for the developer to copy/send manually - no email-
// sending infrastructure exists yet (a documented, deliberate gap, not
// an oversight).
//
// name/email round: name sets organization.name/tenants.name directly
// (previously always the hardcoded "Your Airfield Name" placeholder,
// never overwritten anywhere in this flow - confirmed by inspection).
// email is validated here and stored on the invite itself (migration
// 0084_tenant_invite_email.sql) - LOCKED, not a suggestion: this is the
// platform admin manually onboarding a real prospect, and this becomes
// that prospect's permanent login identity. functions/api/public/
// onboard/[token]/accept.ts now reads it from the invite row rather
// than trusting whatever email the person opening the link types in.
//
// Onboard-tool venue/café fork round - this developer-only quick-create
// tool previously always produced tenant_type='airfield' with cafe-tv
// off (entitled=0/active=0), correct for its normal airfield-onboarding
// use but wrong for deliberately creating a café-only tenant (e.g. Meg's
// Cafe). Mirrors trial-signup.ts's own public airfield/venue_cafe fork,
// adapted for trusted developer use: tenantType (optional, defaults to
// 'airfield' so this stays a no-op for any other caller), and for
// venue_cafe specifically - the -media slug suffix (same
// validateSlugCandidate() requiredSuffix mechanism trial-signup.ts
// already uses, not a second copy of that rule), cafe-tv created
// entitled=1/active=1 with NO trial expiry (immediate, indefinite access
// - a developer deliberately onboarding a café tenant isn't starting a
// self-serve trial), main created entitled=0/active=0, and an optional
// parentTenantSlug that sets tenants.parent_tenant_id directly at
// creation time (no pending/manual-follow-up state needed here, unlike
// trial-signup.ts's own interested_parent_airfield free-text field -
// this is a trusted developer action, not public self-serve). The
// airfield branch (this file's pre-existing behaviour) is entirely
// unchanged.
//
// Required JSON body { name: string, email: string, slug: string,
// lat: number, lon: number, tenantType?: 'airfield' | 'venue_cafe',
// parentTenantSlug?: string | null } - slug is a human-chosen subdomain
// (wildcard DNS/Worker migration round: any valid subdomain now
// resolves automatically the instant the tenant row exists, no
// Cloudflare API call needed, so this is now a pure data-validation
// feature, not an infra one). Required subdomain round: slug is now
// mandatory - a missing/blank value is rejected with 400 rather than
// falling back to a random tenant-XXXXXXXX placeholder (that old
// behaviour made sense for quick throwaway test-tenant creation, but
// this form also captures a real name/email for genuine prospects, who
// should always get a deliberately-chosen address). Matches
// trial-signup.ts's own public form, which already required this.
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
import { validateSlugCandidate, CAFE_SLUG_SUFFIX } from "../../_utils/tenantSlug";
import { createTenantOrganization } from "../../_utils/tenantProvisioning";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const TEMPLATE_SLUG = "newcustomer";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Required going forward on both onboarding paths (this file and
// trial-signup.ts) - the weather-share investigation round found a real
// production tenant (Gyroplane Train) silently stuck showing fabricated
// mock weather because it had no lat/lon on file at all and nothing
// ever required it. Same range check as functions/api/tenant/config.ts's
// own isValidLat/isValidLon (that file's the tenant-editable version of
// this same pair, duplicated rather than shared per this codebase's
// existing functions/-file-local-helper convention).
function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLon(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

// Same pair trial-signup.ts already validates clubName/contactEmail
// against - duplicated rather than shared, this codebase's existing
// functions/-file-local-helper convention (see isValidLat/isValidLon's
// own comment just above for the same reasoning).
const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const body = (await request.json().catch(() => null)) as
    | {
        name?: unknown;
        email?: unknown;
        slug?: unknown;
        lat?: unknown;
        lon?: unknown;
        tenantType?: unknown;
        parentTenantSlug?: unknown;
      }
    | null;
  const requestedSlug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  // Defaults to 'airfield' when absent - same posture as
  // trial-signup.ts's own signupType coercion, keeps every existing
  // caller of this endpoint (none exist outside PlatformTenantsPage.tsx,
  // but this costs nothing) producing exactly today's behaviour.
  const tenantType = body?.tenantType === "venue_cafe" ? "venue_cafe" : "airfield";

  // Fail before creating anything, same posture as the template-tenant
  // check above - a missing/invalid coordinate must never produce a
  // half-onboarded tenant that then needs a manual D1 backfill (exactly
  // how Gyroplane Train ended up with NULL lat/lon in the first place).
  // Same posture now extended to name/email: a bad email here must
  // never produce a real tenant whose invite link then can't be
  // completed (or worse, silently locks in a typo as someone's
  // permanent login) - checked before anything is created, not
  // discovered later when the invite is opened.
  if (!name || name.length > NAME_MAX_LENGTH) {
    return jsonResponse(
      { error: `${tenantType === "venue_cafe" ? "Venue" : "Airfield"} name is required (max ${NAME_MAX_LENGTH} characters)` },
      400
    );
  }
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return jsonResponse({ error: "A valid email is required" }, 400);
  }
  // Same check accept.ts itself already does at invite-completion time -
  // duplicated here so a typo'd-but-already-registered email fails
  // immediately at creation, not only once the customer tries to open
  // the link and complete it.
  const existingUser = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  if (existingUser) return jsonResponse({ error: "An account already exists with this email" }, 409);

  if (!isValidLat(body?.lat)) return jsonResponse({ error: "lat is required and must be a number between -90 and 90" }, 400);
  if (!isValidLon(body?.lon)) return jsonResponse({ error: "lon is required and must be a number between -180 and 180" }, 400);
  const lat = body!.lat as number;
  const lon = body!.lon as number;

  // Subdomain round: required, no more random tenant-XXXXXXXX fallback -
  // that made sense for quick throwaway test-tenant creation, but this
  // form now also captures a real name/email for genuine prospects
  // (name/email round), and a real prospect should always get a real,
  // deliberately-chosen address, same posture trial-signup.ts's own
  // public self-serve form already takes (see that file's own identical
  // "Please choose a subdomain" check). subdomainConfirmed is therefore
  // always true now - every tenant created here has a human-chosen slug,
  // so OnboardInvitePage.tsx's own subdomain-picker step (which only
  // exists for the now-removed random-fallback case) is never reached
  // via this path anymore either.
  if (!requestedSlug) return jsonResponse({ error: "Please choose a subdomain" }, 400);

  // venue_cafe requires the same -media suffix trial-signup.ts's public
  // form enforces, via the same shared validateSlugCandidate()
  // requiredSuffix param - never a second copy of this rule.
  const requiredSuffix = tenantType === "venue_cafe" ? CAFE_SLUG_SUFFIX : undefined;
  const validation = validateSlugCandidate(requestedSlug, requiredSuffix);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400);

  // Parent Airfield linking (optional) - resolved and validated BEFORE
  // anything is created, same fail-fast posture as every other field on
  // this endpoint. A trusted developer action, so this sets
  // parent_tenant_id directly rather than the public form's own
  // interested_parent_airfield free-text "record intent for manual
  // follow-up" field - see trial-signup.ts's own comment on why that one
  // stays manual. Mirrors functions/api/platform/tenants/[id]/
  // parent-tenant.ts's own lookup-by-slug + validation exactly (that
  // endpoint operates on an already-existing tenant via PUT, so its
  // logic can't be called directly here - duplicated per this codebase's
  // established functions/-file-local-helper convention, see
  // tenantProvisioning.ts's own comment on the same tradeoff).
  const parentTenantSlugRaw = typeof body?.parentTenantSlug === "string" ? body.parentTenantSlug.trim() : "";
  let parentTenantId: number | null = null;
  if (parentTenantSlugRaw) {
    const parentTenant = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(parentTenantSlugRaw).first<{ id: number }>();
    if (!parentTenant) return jsonResponse({ error: "No tenant found with that Parent Airfield slug" }, 404);
    parentTenantId = parentTenant.id;
  }

  // Pre-check so a taken/reserved subdomain surfaces as a clear error
  // BEFORE anything is created, not as a confusing failure partway
  // through - the try/catch inside createTenantOrganization below is the
  // real guarantee against a race, this is just the common-case fast
  // path that avoids ever hitting that catch block in practice.
  const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(requestedSlug).first<{ id: number }>();
  if (existing) return jsonResponse({ error: "That subdomain is already taken" }, 409);

  const slug = requestedSlug;
  const subdomainConfirmed = true;

  // Shared with trial-signup.ts (functions/api/_utils/tenantProvisioning.ts) -
  // only this row-creation step is shared; everything below (template
  // clone, tenant_displays, the invite itself) stays specific to this
  // flow. The pre-check + try/catch race handling that used to live
  // inline here now lives inside that shared function - same behaviour,
  // same "That subdomain was just taken" outcome on a genuine race,
  // just one implementation instead of two.
  const created = await createTenantOrganization(env.DB, { slug, name, lat, lon, subdomainConfirmed, tenantType });
  if (!created.ok) {
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }
  const { organizationId, tenantId } = created;

  await cloneTenantTemplate(env.DB, template.organizationId, organizationId, slug);

  if (tenantType === "venue_cafe") {
    // Mirrors trial-signup.ts's own venue_cafe branch exactly (main OFF,
    // cafe-tv ON) with one deliberate difference: cafe-tv here gets
    // entitled=1/active=1 with NO entitlement_trial_expires_at (both
    // columns default to 1/NULL already - see tenant_displays' own
    // schema - so this is the same "immediate, indefinite access" shape
    // the airfield branch's own 'main' row below already relies on via
    // those same defaults, just spelled out explicitly here for the
    // reader). A developer deliberately onboarding a café tenant through
    // this trusted tool isn't starting a metered self-serve trial - see
    // trial-signup.ts's own CAFE_TRIAL_DAYS comment for why the public
    // path is different.
    await env.DB
      .prepare(`INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active) VALUES (?, 'main', 'Main Dashboard', 'classic', 0, 0)`)
      .bind(tenantId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active) VALUES (?, 'cafe-tv', 'Media Screen', 'cafe-1', 1, 1)`
      )
      .bind(tenantId)
      .run();
  } else {
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
      .bind(tenantId, JSON.stringify({ weather: true, compass: true, media: true, ops: true }))
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
      .bind(tenantId)
      .run();
  }

  if (parentTenantId !== null) {
    await env.DB.prepare("UPDATE tenants SET parent_tenant_id = ? WHERE id = ?").bind(parentTenantId, tenantId).run();
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await env.DB
    .prepare(
      "INSERT INTO tenant_invites (token, tenant_id, organization_id, created_by, expires_at, email) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(token, tenantId, organizationId, result.userId, expiresAt, email)
    .run();

  const origin = new URL(request.url).origin;
  const inviteUrl = `${origin}/onboard/${token}`;

  return jsonResponse({ tenantId, slug, email, inviteUrl, expiresAt });
};
