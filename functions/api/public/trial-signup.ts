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
// Venue/café onboarding round - this endpoint now forks on
// body.signupType ('airfield' | 'venue_cafe'), sharing the template
// lookup, contact-email/lat/lon validation, and tenant/org row creation
// (createTenantOrganization) across both, but branching on: the
// name-like field collected (clubName vs venueName), slug suffix
// enforcement (venue_cafe requires -media, via the same
// validateSlugCandidate() check-slug.ts's own live-typing check already
// uses, so the two can never disagree), which tenant_displays rows get
// created active/entitled, and tenant_type written onto the tenants row
// itself. See each branch's own comments below for the specifics.
//
// Deliberately does NOT create a user/account/member row - no password
// was collected (the signup form only asks club name/email/location, by
// design) and this app has no email-sending capability for a password-
// setup-link flow. Creating the real login is a manual follow-up step
// (same process Shobdon's own seed migration used), same as activating
// billing - the confirmation response reflects that honestly rather
// than implying a working login exists yet.
import { cloneTenantTemplate } from "../_utils/cloneTenant";
import { validateSlugCandidate, CAFE_SLUG_SUFFIX } from "../_utils/tenantSlug";
import { createTenantOrganization } from "../_utils/tenantProvisioning";
import { geocodePostcode } from "../_utils/postcodeGeocode";
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
// Venue/café onboarding round: deliberately reused as-is for the
// venue_cafe branch too (no second "newcustomer-cafe" template) - the
// extra aviation-flavoured rows it clones (runway_groups, ops_panel_state)
// are simply never rendered for a venue_cafe tenant (its sidebar has no
// route that reads them), harmless dead data rather than a real problem
// worth a second template for.
const TEMPLATE_SLUG = "newcustomer";

const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 200;
const LOCATION_MAX_LENGTH = 200;
// Venue/café onboarding round - trial_signups.interested_parent_airfield
// (migration 0090), same bound as the other free-text fields on this
// table, no format validation (same posture as location_text - a human
// typed this for another human to read during manual review, not for
// any code to parse).
const INTERESTED_AIRFIELD_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Venue/café onboarding round - trial lengths for the tenant_displays
// rows this endpoint now creates (previously created none at all for
// either branch - a confirmed, pre-existing gap, fixed here for both).
// MAIN_TRIAL_DAYS=14 matches LandingPage.tsx's own existing marketing
// copy ("14-day free trial on the dashboard") verbatim - that promise
// was never actually wired into the entitlement mechanism before now
// (onboard.ts's own invite-link flow, a different, more manual context,
// leaves entitlement_trial_expires_at NULL/unlimited on its own main
// row - this endpoint's self-serve flow is the one that specifically
// promises a bounded trial on this exact page, so it's the one that
// must honour it). CAFE_TRIAL_DAYS=7 is this round's own new call for
// the venue_cafe branch's cafe-tv row - no prior art existed for it
// anywhere in the codebase (confirmed via investigation: entitlement_
// trial_expires_at has never been auto-computed anywhere before this,
// only ever hand-set by a developer via /platform/tenants).
const MAIN_TRIAL_DAYS = 14;
const CAFE_TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function trialExpiryIso(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

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

interface RequestBody {
  signupType?: unknown;
  // Airfield branch
  clubName?: unknown;
  location?: unknown;
  lat?: unknown;
  lon?: unknown;
  // Venue/café branch - postcode replaces lat/lon (migration-free round:
  // a café owner has no reason to know their own coordinates, unlike the
  // airfield branch's audience) - geocoded server-side via
  // geocodePostcode(), never trusts a client-supplied lat/lon for this
  // branch.
  venueName?: unknown;
  postcode?: unknown;
  interestedParentAirfield?: unknown;
  // Shared
  contactEmail?: unknown;
  slug?: unknown;
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

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  // Defaults to 'airfield' when absent - matches tenants.tenant_type's
  // own column default (migration 0090), and means a signupType-unaware
  // caller (none exist post-deploy, but this costs nothing) keeps
  // getting today's only behaviour rather than a hard 400.
  const signupType = body.signupType === "venue_cafe" ? "venue_cafe" : "airfield";

  const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
  if (!contactEmail || contactEmail.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(contactEmail)) {
    return jsonResponse({ error: "A valid contact email is required" }, 400);
  }
  // lat/lon validation moved into each branch below - venue_cafe derives
  // them from a postcode (geocodePostcode) instead of accepting raw
  // client-supplied coordinates.

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!slug) {
    return jsonResponse({ error: "Please choose a subdomain" }, 400);
  }

  if (signupType === "venue_cafe") {
    const venueName = typeof body.venueName === "string" ? body.venueName.trim() : "";
    if (!venueName || venueName.length > NAME_MAX_LENGTH) {
      return jsonResponse({ error: `Venue name is required (max ${NAME_MAX_LENGTH} characters)` }, 400);
    }

    // Server-side enforcement of the -media suffix - the same
    // validateSlugCandidate() call check-slug.ts's own live-typing
    // check already makes with the identical requiredSuffix, so a slug
    // that check ever showed as "available" can't be rejected here.
    const slugValidation = validateSlugCandidate(slug, CAFE_SLUG_SUFFIX);
    if (!slugValidation.valid) {
      return jsonResponse({ error: slugValidation.error }, 400);
    }

    const interestedParentAirfieldRaw = typeof body.interestedParentAirfield === "string" ? body.interestedParentAirfield.trim() : "";
    if (interestedParentAirfieldRaw.length > INTERESTED_AIRFIELD_MAX_LENGTH) {
      return jsonResponse({ error: `That's a bit long (max ${INTERESTED_AIRFIELD_MAX_LENGTH} characters)` }, 400);
    }
    const interestedParentAirfield = interestedParentAirfieldRaw || null;

    // Authoritative geocode - the ONE gate this branch trusts for
    // lat/lon, never a client-supplied value (there isn't one to trust;
    // the client only ever sends the raw postcode string). A failed
    // geocode is a validation failure (400), never a silent fallback to
    // missing/null coordinates - see this round's own brief for why.
    const postcodeRaw = typeof body.postcode === "string" ? body.postcode : "";
    const geocode = await geocodePostcode(postcodeRaw);
    if (!geocode.valid || typeof geocode.lat !== "number" || typeof geocode.lon !== "number") {
      return jsonResponse({ error: geocode.error ?? "Postcode not found" }, 400);
    }

    const created = await createTenantOrganization(env.DB, {
      slug,
      name: venueName,
      lat: geocode.lat,
      lon: geocode.lon,
      subdomainConfirmed: true,
      tenantType: "venue_cafe",
    });
    if (!created.ok) {
      return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
    }
    const { organizationId, tenantId, subdomain } = created;

    // Same starter data every onboarding path clones - see this file's
    // own top comment on why no second template exists for this branch.
    await cloneTenantTemplate(env.DB, template.organizationId, organizationId, slug);

    // main OFF, explicitly - NOT simply omitted. Investigation confirmed
    // publicConfig.ts's own missing-row fallback treats an ABSENT main
    // row as mainDisplayActive=true (a deliberate resilience default for
    // "tenant hasn't touched Dashboard Layout yet", not "this tenant has
    // no Reception Dashboard product at all") - for a venue_cafe tenant
    // that would wrongly leave '/' rendering the aviation dashboard.
    // panel_config omitted (nullable, no default) - same as onboard.ts's
    // own cafe-tv-off row, meaningless config for a display that will
    // never render.
    await env.DB
      .prepare(`INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active) VALUES (?, 'main', 'Main Dashboard', 'classic', 0, 0)`)
      .bind(tenantId)
      .run();

    // cafe-tv ON - this tenant's entire product. 7-day trial
    // (CAFE_TRIAL_DAYS), unlike the airfield branch's cafe-tv row (which
    // stays fully off, protecting an add-on nobody's paid for) - here
    // it's the opposite: the core product must work immediately, with a
    // real, bounded trial rather than either "off" or "free forever".
    await env.DB
      .prepare(
        `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active, entitlement_trial_expires_at)
         VALUES (?, 'cafe-tv', 'Media Screen', 'cafe-1', 1, 1, ?)`
      )
      .bind(tenantId, trialExpiryIso(CAFE_TRIAL_DAYS))
      .run();

    // location_text is NOT NULL, but the venue_cafe branch collects no
    // separate free-text location field of its own - venueName + the
    // geocoded, canonically-formatted postcode ("Goodwood Clubhouse
    // Cafe, HR6 9HB") reads more usefully for manual review than either
    // alone, now that a real postcode exists (previously synthesized
    // from venueName only, before this round added postcode collection).
    await env.DB
      .prepare("INSERT INTO trial_signups (tenant_id, contact_email, location_text, interested_parent_airfield) VALUES (?, ?, ?, ?)")
      .bind(tenantId, contactEmail, `${venueName}, ${geocode.postcode}`, interestedParentAirfield)
      .run();

    return jsonResponse({ ok: true, slug, subdomain });
  }

  // Airfield branch - unchanged field set/validation from before this
  // round (still raw lat/lon, not postcode - that swap is venue_cafe-
  // only, see this branch's own field list in the top comment), just
  // now also creating tenant_displays rows (the confirmed gap) and
  // writing tenant_type='airfield' explicitly.
  const clubName = typeof body.clubName === "string" ? body.clubName.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";

  if (!clubName || clubName.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: `Club/airfield name is required (max ${NAME_MAX_LENGTH} characters)` }, 400);
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
  const created = await createTenantOrganization(env.DB, {
    slug,
    name: clubName,
    lat: body.lat,
    lon: body.lon,
    subdomainConfirmed: true,
    tenantType: "airfield",
  });
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

  // main ON, with a real 14-day trial expiry (MAIN_TRIAL_DAYS - see that
  // constant's own comment for why this endpoint specifically must set
  // one, unlike onboard.ts's invite-link flow). cafe-tv OFF (entitled=0,
  // active=0) - unchanged posture from onboard.ts's own equivalent row:
  // a brand-new signup must never get free café access.
  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, panel_config, entitled, active, entitlement_trial_expires_at)
       VALUES (?, 'main', 'Main Dashboard', 'classic', ?, 1, 1, ?)`
    )
    .bind(tenantId, JSON.stringify({ weather: true, compass: true, media: true, ops: true }), trialExpiryIso(MAIN_TRIAL_DAYS))
    .run();
  await env.DB
    .prepare(`INSERT INTO tenant_displays (tenant_id, slug, name, template_id, entitled, active) VALUES (?, 'cafe-tv', 'Clubhouse Cafe TV', 'cafe-1', 0, 0)`)
    .bind(tenantId)
    .run();

  await env.DB
    .prepare("INSERT INTO trial_signups (tenant_id, contact_email, location_text) VALUES (?, ?, ?)")
    .bind(tenantId, contactEmail, location)
    .run();

  return jsonResponse({ ok: true, slug, subdomain });
};
