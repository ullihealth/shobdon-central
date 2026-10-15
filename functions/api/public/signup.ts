// Public, UNAUTHENTICATED paid signup - POST /api/public/signup. Stripe
// groundwork Part B. Deliberately a SEPARATE route from trial-signup.ts,
// not a retrofit of it - the go-ahead is explicit that trial-signup.ts's
// existing behaviour must not change for its existing callers. (Landing-
// page signup round: trial-signup.ts's own venue_cafe branch no longer
// has a landing-page entry point - airfield/clubhouse is the only self-
// serve path now - but the endpoint itself is untouched, same signature,
// same behaviour, for any other caller.) This route creates a real
// user/account/member row (trial-signup.ts
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
import { getEligibleParentTenants } from "../_utils/eligibleParents";

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

interface RequestBody {
  businessName?: unknown;
  contactName?: unknown;
  email?: unknown;
  password?: unknown;
  slug?: unknown;
  parentTenantId?: unknown;
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

  // Decision #12 - Parent Airfield linking. Landing-page signup round:
  // the form now submits a parentTenantId (number) chosen from a
  // dropdown, not a free-typed slug - this validates it against the
  // exact same eligible-parent set functions/api/public/parent-
  // airfields.ts lists (getEligibleParentTenants, shared helper so the
  // two can never drift apart), rejecting any id that isn't a genuine,
  // eligible parent (including a syntactically-valid id for a real but
  // ineligible tenant - demo/newcustomer/etc. - not just a nonexistent
  // one). No parent chosen is valid too (parentTenantId omitted/null) -
  // lat/lon are simply left null in that case, see below.
  const parentTenantIdRaw = body.parentTenantId;
  let parentTenantId: number | null = null;
  let lat: number | null = null;
  let lon: number | null = null;
  if (parentTenantIdRaw !== null && parentTenantIdRaw !== undefined) {
    if (typeof parentTenantIdRaw !== "number" || !Number.isInteger(parentTenantIdRaw)) {
      return jsonResponse({ error: "parentTenantId must be a whole number" }, 400);
    }
    const eligible = await getEligibleParentTenants(env.DB);
    const parentTenant = eligible.find((tenant) => tenant.id === parentTenantIdRaw);
    if (!parentTenant) return jsonResponse({ error: "That Parent Airfield is not available to link to" }, 400);
    parentTenantId = parentTenant.id;
    lat = parentTenant.lat;
    lon = parentTenant.lon;
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

  // Abandoned-checkout round - explicit 'pending' status (NOT the
  // column's own 'trial' default every pre-existing/comped tenant
  // already has - migration 0043's own comment) is what lets
  // RequireAuth.tsx's new gate distinguish "a brand-new paid signup
  // that hasn't finished Stripe Checkout yet" from every other tenant
  // in the system, with zero risk of an existing tenant ever matching
  // it - nothing else in this codebase writes 'pending' anywhere.
  // subscription_notes (existing free-text column, otherwise untouched
  // by this flow) holds the chosen plan id ('pack'/'pilotApp') so the
  // "Complete your subscription" screen knows what to show/buy without
  // a new column - safe to reuse here specifically because a 'pending'
  // tenant is, by construction, one this exact route just created, so
  // nothing else could have already put different content there.
  // webhook.ts's own setSubscriptionStatus already flips this to
  // 'active' on a successful checkout.session.completed - no change
  // needed there at all.
  await env.DB.prepare("UPDATE tenants SET subscription_status = 'pending', subscription_notes = ? WHERE id = ?").bind(plan, tenantId).run();

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
