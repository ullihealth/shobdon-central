// Public, UNAUTHENTICATED paid signup - POST /api/public/signup. Stripe
// groundwork Part B. Deliberately a SEPARATE route from trial-signup.ts,
// not a retrofit of it - the go-ahead is explicit that trial-signup.ts's
// existing behaviour must not change for its existing callers (the
// venue_cafe branch on LandingPage.tsx still uses it, unchanged). This
// route creates a real user/account/member row (trial-signup.ts
// deliberately never does, see that file's own comment) and grants NO
// entitlements at all - dashboard_enabled/mobile_enabled are already 0
// by default on a brand-new tenants row (migration 0106's own "locked
// out until the Pack is actually purchased" default), so "grant nothing
// until Stripe confirms payment" needs no special suppression here, just
// not doing what trial-signup.ts does (entitled=1 + a trial expiry on
// tenant_displays).
//
// Airfield type ONLY, deliberately - see this round's own report. A
// venue_cafe tenant's one product (Media Screen) requires the Pack per
// the existing, unchanged entitlement rule (webhook.ts's
// applyEntitlementForProduct), but a single Stripe subscription can only
// cleanly grant ONE product today (productForLineItems resolves the
// FIRST matching price only, and tenants has a single
// stripe_subscription_id column - a second, separate subscription would
// overwrite it). There is no safe way to sell a brand-new venue_cafe
// tenant "Pack + Media Screen together" through the existing checkout/
// webhook model without changing that deliberate, documented behaviour,
// which this round was told not to do. Flagged in the report, not
// silently worked around - venue_cafe keeps using trial-signup.ts
// exactly as before.
import { cloneTenantTemplate } from "../_utils/cloneTenant";
import { validateSlugCandidate } from "../_utils/tenantSlug";
import { createTenantOrganization } from "../_utils/tenantProvisioning";
import { hashPassword } from "../_utils/passwordHash";
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { TERMS_VERSION } from "../_utils/termsVersion";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const VALID_PLANS = ["pack", "pilotApp"] as const;
type Plan = (typeof VALID_PLANS)[number];

function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLon(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

interface RequestBody {
  businessName?: unknown;
  contactName?: unknown;
  email?: unknown;
  password?: unknown;
  slug?: unknown;
  lat?: unknown;
  lon?: unknown;
  parentTenantSlug?: unknown;
  plan?: unknown;
  termsAccepted?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const template = await env.DB
    .prepare("SELECT organization_id AS organizationId FROM tenants WHERE slug = ?")
    .bind("newcustomer")
    .first<{ organizationId: string | null }>();
  if (!template || !template.organizationId) {
    return jsonResponse({ error: "Signup is temporarily unavailable - please contact support@airfieldcentral.com" }, 500);
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  if (!businessName || businessName.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: `Business/airfield name is required (max ${NAME_MAX_LENGTH} characters)` }, 400);
  }

  const contactName = typeof body.contactName === "string" ? body.contactName.trim() : "";
  if (!contactName || contactName.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: "Contact name is required" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return jsonResponse({ error: "A valid email is required" }, 400);
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }

  if (body.termsAccepted !== true) {
    return jsonResponse({ error: "You must agree to the Customer Terms and Privacy Policy to continue" }, 400);
  }

  const plan = typeof body.plan === "string" && (VALID_PLANS as readonly string[]).includes(body.plan) ? (body.plan as Plan) : null;
  if (!plan) {
    return jsonResponse({ error: `plan must be one of: ${VALID_PLANS.join(", ")}` }, 400);
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!slug) return jsonResponse({ error: "Please choose a subdomain" }, 400);
  const slugValidation = validateSlugCandidate(slug);
  if (!slugValidation.valid) return jsonResponse({ error: slugValidation.error }, 400);

  // Reject a duplicate email BEFORE creating any tenant/org row - a
  // clean, fast failure rather than an orphaned tenant for an account
  // that can never be logged into (email is the real identity; the
  // tenant itself would be harmless-but-wasted clutter).
  const existingUser = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  if (existingUser) return jsonResponse({ error: "An account already exists with this email - please sign in instead" }, 409);

  // Decision #12 - Parent Airfield linking, exact same lookup/validation/
  // lat-lon-inheritance shape as functions/api/platform/tenants/onboard.ts
  // (duplicated per this codebase's established functions/-file-local-
  // helper convention, see tenantProvisioning.ts's own comment on the
  // same tradeoff - that endpoint's own logic can't be called directly
  // from here).
  const parentTenantSlugRaw = typeof body.parentTenantSlug === "string" ? body.parentTenantSlug.trim() : "";
  let parentTenantId: number | null = null;
  let parentLat: number | null = null;
  let parentLon: number | null = null;
  if (parentTenantSlugRaw) {
    const parentTenant = await env.DB
      .prepare("SELECT id, lat, lon FROM tenants WHERE slug = ?")
      .bind(parentTenantSlugRaw)
      .first<{ id: number; lat: number | null; lon: number | null }>();
    if (!parentTenant) return jsonResponse({ error: "No tenant found with that Parent Airfield slug" }, 404);
    parentTenantId = parentTenant.id;
    parentLat = parentTenant.lat;
    parentLon = parentTenant.lon;
  }

  const latProvided = body.lat !== null && body.lat !== undefined;
  const lonProvided = body.lon !== null && body.lon !== undefined;

  let lat: number;
  if (latProvided) {
    if (!isValidLat(body.lat)) return jsonResponse({ error: "lat must be a number between -90 and 90" }, 400);
    lat = body.lat as number;
  } else if (parentTenantId !== null && isValidLat(parentLat)) {
    lat = parentLat;
  } else {
    return jsonResponse({ error: "lat is required and must be a number between -90 and 90 (or choose a Parent Airfield)" }, 400);
  }

  let lon: number;
  if (lonProvided) {
    if (!isValidLon(body.lon)) return jsonResponse({ error: "lon must be a number between -180 and 180" }, 400);
    lon = body.lon as number;
  } else if (parentTenantId !== null && isValidLon(parentLon)) {
    lon = parentLon;
  } else {
    return jsonResponse({ error: "lon is required and must be a number between -180 and 180 (or choose a Parent Airfield)" }, 400);
  }

  const created = await createTenantOrganization(env.DB, {
    slug,
    name: businessName,
    lat,
    lon,
    subdomainConfirmed: true,
    tenantType: "airfield",
  });
  if (!created.ok) {
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }
  const { organizationId, tenantId, subdomain } = created;

  // Same starter data every onboarding path clones (cloneTenant.ts's own
  // generic column-copy, not a hand-picked list) - the go-ahead's own
  // instruction to reuse this path. Never touches dashboard_enabled/
  // mobile_enabled (those live on the tenants row itself, already 0 by
  // default - see this file's own top comment) and never touches
  // entitlement_trial_expires_at (that's set explicitly below, or rather
  // NOT set at all - see the tenant_displays inserts below).
  await cloneTenantTemplate(env.DB, template.organizationId, organizationId, slug);

  if (parentTenantId !== null) {
    await env.DB
      .prepare("UPDATE tenants SET parent_tenant_id = ?, active_weather_provider = 'ingested' WHERE id = ?")
      .bind(parentTenantId, tenantId)
      .run();
  }

  // Paid signup - NO trial. Both display rows created OFF/unentitled
  // (entitled=0, active=0, no entitlement_trial_expires_at) - unlike
  // trial-signup.ts's airfield branch, which turns main ON with a 14-day
  // trial expiry. Entitlement only ever flips on via the Stripe webhook
  // (checkout.session.completed -> applyEntitlementForProduct), once
  // payment genuinely succeeds.
  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, panel_config, entitled, active) VALUES (?, 'main', 'Main Dashboard', 'classic', ?, 0, 0)`
    )
    .bind(tenantId, JSON.stringify({ weather: true, compass: true, media: true, ops: true }))
    .run();
  await env.DB
    .prepare(`INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active) VALUES (?, 'cafe-tv', 'Clubhouse Cafe TV', 'cafe-1', 0, 0)`)
    .bind(tenantId)
    .run();

  // Real user/account/member row - exact same pattern functions/api/
  // public/onboard/[token]/accept.ts already uses for invite-based
  // onboarding (same hashPassword helper, same providerId/accountId
  // convention), role 'owner' since this person is setting up their own
  // brand-new tenant. termsAcceptedAt/Version/Ip all written directly on
  // this same INSERT, next to each other on the one existing mechanism
  // this app already uses for terms tracking (user.termsAcceptedAt/
  // termsAcceptedVersion, read by OnboardingTermsPage.tsx's mandatory
  // gate and tenant/me.ts) rather than splitting IP off into
  // trial_signups, which is a trial-specific lead record this (paid,
  // non-trial) flow deliberately does not write to - see this file's
  // own top comment and the go-ahead's Part F, which sources "new
  // signup" from subscription_history/webhook data, not trial_signups.
  // IP is CF-Connecting-IP, the same header every Cloudflare Pages
  // Function request carries, never trusted from the request body.
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const ip = request.headers.get("CF-Connecting-IP") || "";

  await env.DB
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, developer, termsAcceptedAt, termsAcceptedVersion, termsAcceptedIp)
       VALUES (?, ?, ?, 0, NULL, ?, ?, 0, ?, ?, ?)`
    )
    .bind(userId, contactName, email, now, now, now, TERMS_VERSION, ip)
    .run();

  await env.DB
    .prepare("INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now)
    .run();

  await env.DB
    .prepare("INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, 'owner', ?)")
    .bind(crypto.randomUUID(), organizationId, userId, now)
    .run();

  return jsonResponse({ ok: true, slug, subdomain, tenantId, plan });
};
