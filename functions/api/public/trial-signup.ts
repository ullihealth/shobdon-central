// Public, UNAUTHENTICATED self-serve trial signup - POST /api/public/
// trial-signup. Creates a real organization + tenants row (genuine
// provisioning, not a fake lead-capture form), clones the same
// newcustomer-template starter data (theme/runways/cameras/ops-panel/
// carousel slots) functions/api/platform/tenants/onboard.ts's
// invite-link flow already uses, plus a trial_signups row recording
// what the requester actually typed, for manual follow-up.
//
// Subdomain round: the customer now chooses their own subdomain
// up front (required, live-checked via ../public/check-slug.ts as
// they type - src/pages/LandingPage.tsx) rather than one being derived
// from the club name and silently auto-uniquified with a trailing
// "-2"/"-3" on collision. Jeff's own reasoning: a self-serve customer
// choosing their address up front avoids ever having to tell them
// afterward "actually, please switch to this new URL instead" - there's
// no admin relationship here to smooth that over the way there is for
// onboard.ts's invite-link flow. Format/reserved-word validation lives
// in ../_utils/tenantSlug.ts, shared with onboard.ts and both check-slug
// endpoints; slugify()/findAvailableSlug() (this file's own prior
// auto-derivation) are gone - there's nothing left to derive, the
// customer's own choice is the slug, full stop.
//
// Deliberately does NOT create a user/account/member row - no password
// was collected (the signup form only asks club name/email/location, by
// design) and this app has no email-sending capability for a password-
// setup-link flow. Creating the real login is a manual follow-up step
// (same process Shobdon's own seed migration used), same as activating
// billing - the confirmation response reflects that honestly rather
// than implying a working login exists yet.
import { cloneTenantTemplate } from "../_utils/cloneTenant";
import { validateSlugCandidate } from "../_utils/tenantSlug";
import { createTenantOrganization } from "../_utils/tenantProvisioning";
// Imported (not a separate hand-rolled local type, unlike this endpoint's
// pre-existing convention) because cloneTenantTemplate below is typed
// against this exact D1Database shape - passing env.DB through to it
// needs to structurally satisfy that, not a narrower local subset.
import type { D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Same template tenant onboard.ts's invite-link flow clones from - see
// cloneTenantTemplate's own comment for why the clone itself reads the
// source org's rows generically rather than hardcoding a column list.
const TEMPLATE_SLUG = "newcustomer";

const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 200;
const LOCATION_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Required going forward - see onboard.ts's own copy of this same pair
// for the full reasoning (the weather-share investigation round found a
// real tenant, created before this requirement existed, silently stuck
// on fabricated mock weather with no lat/lon on file at all). The
// existing free-text `location` field above is kept as-is (a human-
// readable note for Jeff's own manual follow-up, per this file's own
// top comment) - it was never wired to weather despite its own
// "for weather lookup" label on the form, which is exactly the gap
// these two real fields close.
function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLon(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Fail before creating anything if the template tenant itself is
  // missing/misconfigured - same check onboard.ts's invite-link flow
  // does first, for the same reason (don't provision a real org/tenants
  // row only to then be unable to clone its starter data).
  const template = await env.DB
    .prepare("SELECT organization_id AS organizationId FROM tenants WHERE slug = ?")
    .bind(TEMPLATE_SLUG)
    .first<{ organizationId: string | null }>();
  if (!template || !template.organizationId) {
    return jsonResponse(
      { error: "Signup is temporarily unavailable - please contact support@airfieldcentral.com" },
      500
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { clubName?: unknown; contactEmail?: unknown; location?: unknown; slug?: unknown; lat?: unknown; lon?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const clubName = typeof body.clubName === "string" ? body.clubName.trim() : "";
  const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";

  if (!clubName || clubName.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: `Club/airfield name is required (max ${NAME_MAX_LENGTH} characters)` }, 400);
  }
  if (!contactEmail || contactEmail.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(contactEmail)) {
    return jsonResponse({ error: "A valid contact email is required" }, 400);
  }
  if (!location || location.length > LOCATION_MAX_LENGTH) {
    return jsonResponse({ error: `Location is required (max ${LOCATION_MAX_LENGTH} characters)` }, 400);
  }
  if (!isValidLat(body.lat)) {
    return jsonResponse({ error: "A valid latitude (-90 to 90) is required" }, 400);
  }
  if (!isValidLon(body.lon)) {
    return jsonResponse({ error: "A valid longitude (-180 to 180) is required" }, 400);
  }
  if (!slug) {
    return jsonResponse({ error: "Please choose a subdomain" }, 400);
  }
  const slugValidation = validateSlugCandidate(slug);
  if (!slugValidation.valid) {
    return jsonResponse({ error: slugValidation.error }, 400);
  }

  // Shared with onboard.ts (functions/api/_utils/tenantProvisioning.ts) -
  // only this row-creation step is shared; everything below (template
  // clone, the trial_signups record) stays specific to this flow -
  // deliberately does NOT create a user/account/member row, see this
  // file's own top comment for why. subdomainConfirmed always true here
  // (unlike onboard.ts's optional random-fallback slug) - this form's
  // own subdomain field is required, always a human's deliberate choice.
  const created = await createTenantOrganization(env.DB, { slug, name: clubName, lat: body.lat, lon: body.lon, subdomainConfirmed: true });
  if (!created.ok) {
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }
  const { organizationId, tenantId, subdomain } = created;

  // Same starter data (theme/runways/cameras/ops-panel/carousel slots)
  // onboard.ts's invite-link flow clones - a self-serve signup used to
  // land on a genuinely bare dashboard with none of this until someone
  // noticed and fixed it by hand. Confirmed via production data that no
  // real signup has hit this gap yet (see this file's own top comment).
  await cloneTenantTemplate(env.DB, template.organizationId, organizationId, slug);

  await env.DB
    .prepare("INSERT INTO trial_signups (tenant_id, contact_email, location_text) VALUES (?, ?, ?)")
    .bind(tenantId, contactEmail, location)
    .run();

  return jsonResponse({ ok: true, slug, subdomain });
};
