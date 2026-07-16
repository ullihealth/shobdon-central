// Public, UNAUTHENTICATED self-serve trial signup - POST /api/public/
// trial-signup. Creates a real organization + tenants row (genuine
// provisioning, not a fake lead-capture form) plus a trial_signups row
// recording what the requester actually typed, for manual follow-up.
//
// Deliberately does NOT create a user/account/member row - no password
// was collected (the signup form only asks club name/email/location, by
// design) and this app has no email-sending capability for a password-
// setup-link flow. Creating the real login is a manual follow-up step
// (same process Shobdon's own seed migration used), same as activating
// billing - the confirmation response reflects that honestly rather
// than implying a working login exists yet.
//
// Known, accepted gap: no rate-limiting/abuse protection on this
// endpoint yet. Fine before this page gets real marketing traffic -
// flagged as a follow-up task, not solved here.

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      run: () => Promise<{ success: boolean }>;
    };
  };
};

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

// Anything that would collide with an existing or plausible future route
// path (functions/api/public/*, src/App.tsx's routes) or is otherwise
// not a real club's own identity.
const RESERVED_SLUGS = new Set([
  "www", "api", "global", "admin", "app", "login", "checklist", "account",
  "config", "design", "runways", "members", "media-manager", "atc-control",
  "developertools", "static", "assets", "signup", "trial", "shobdon",
]);

const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 200;
const LOCATION_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SLUG_ATTEMPTS = 20;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Tries the plain slugified name first, then -2, -3... - collisions are
// expected to be rare (distinct club names), not the common case, so
// this only ever does extra work when it's actually needed.
async function findAvailableSlug(base: string, db: D1Database): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const existing = await db.prepare("SELECT id FROM tenants WHERE slug = ?").bind(candidate).first();
    if (!existing) return candidate;
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as
    | { clubName?: unknown; contactEmail?: unknown; location?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const clubName = typeof body.clubName === "string" ? body.clubName.trim() : "";
  const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";

  if (!clubName || clubName.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: `Club/airfield name is required (max ${NAME_MAX_LENGTH} characters)` }, 400);
  }
  if (!contactEmail || contactEmail.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(contactEmail)) {
    return jsonResponse({ error: "A valid contact email is required" }, 400);
  }
  if (!location || location.length > LOCATION_MAX_LENGTH) {
    return jsonResponse({ error: `Location is required (max ${LOCATION_MAX_LENGTH} characters)` }, 400);
  }

  const baseSlug = slugify(clubName);
  if (!baseSlug) {
    return jsonResponse({ error: "Club/airfield name must contain at least one letter or number" }, 400);
  }

  const slug = await findAvailableSlug(baseSlug, env.DB);
  if (!slug) {
    return jsonResponse(
      { error: "Could not generate a unique address for this name - please contact support@airfieldcentral.com" },
      409
    );
  }

  const now = new Date().toISOString();
  const organizationId = `org_${slug}`;
  const subdomain = `${slug}.airfieldcentral.com`;

  await env.DB
    .prepare("INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)")
    .bind(organizationId, clubName, slug, now)
    .run();

  try {
    await env.DB
      .prepare(
        "INSERT INTO tenants (slug, name, subdomain, organization_id, weather_public, ops_public, active) VALUES (?, ?, ?, ?, 0, 0, 1)"
      )
      .bind(slug, clubName, subdomain, organizationId)
      .run();
  } catch {
    // Slug was taken between the check above and this insert (race) -
    // the organization row above is now orphaned (harmless, invisible
    // to any tenant-facing surface, not worth a rollback mechanism for
    // this rare a case) - ask the requester to just try again.
    return jsonResponse({ error: "That address was just taken - please try submitting again" }, 409);
  }

  const tenantRow = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (!tenantRow) {
    return jsonResponse(
      { error: "Something went wrong provisioning your account - please contact support@airfieldcentral.com" },
      500
    );
  }

  await env.DB
    .prepare("INSERT INTO trial_signups (tenant_id, contact_email, location_text) VALUES (?, ?, ?)")
    .bind(tenantRow.id, contactEmail, location)
    .run();

  return jsonResponse({ ok: true, slug, subdomain });
};
