// Public, unauthenticated: POST /api/public/onboard/:token/subdomain
// Body: { slug }
//
// Subdomain-picker round: lets the customer completing /onboard/:token
// choose their own subdomain, for a tenant that doesn't have a
// deliberately-chosen one yet (t.subdomain_confirmed = 0 - still
// onboard.ts's own random tenant-XXXXXXXX placeholder). Re-validates
// the token with the exact same rules [token].ts's GET and this file's
// own sibling accept.ts already use (found/not used/not expired) -
// token possession IS the authorization here, same as accept.ts, no
// session exists yet at this point in the flow and none is needed. Not
// rate-limited separately, unlike ../../check-slug.ts's fully open
// public version - a 32-random-byte invite token isn't brute-forceable,
// and anyone who legitimately has one can only ever affect their own
// tenant's own row.
//
// Deliberately does NOT create/touch any session or account - this
// runs BEFORE accept.ts, while the invite is still unused. Sets
// subdomain_confirmed = 1 so OnboardInvitePage.tsx never asks again on
// a later visit to this same link (e.g. after the redirect this
// triggers on the correct host, or a refresh).
import { jsonResponse, syncOrganizationIdentity, type D1Database } from "../../../_utils/tenantAuth";
import { validateSlugCandidate } from "../../../_utils/tenantSlug";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface InviteRow {
  tenantId: number;
  expiresAt: string;
  usedAt: string | null;
  organizationId: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = params.token;
  if (!token) return jsonResponse({ error: "Missing invite token" }, 400);

  const invite = await env.DB
    .prepare(
      `SELECT ti.tenant_id AS tenantId, ti.expires_at AS expiresAt, ti.used_at AS usedAt, t.organization_id AS organizationId
       FROM tenant_invites ti JOIN tenants t ON t.id = ti.tenant_id
       WHERE ti.token = ?`
    )
    .bind(token)
    .first<InviteRow>();

  if (!invite) return jsonResponse({ error: "This invite link is not valid" }, 404);
  if (invite.usedAt) return jsonResponse({ error: "This invite link has already been used" }, 409);
  if (new Date(invite.expiresAt).getTime() < Date.now()) return jsonResponse({ error: "This invite link has expired" }, 410);

  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!slug) return jsonResponse({ error: "Please choose a subdomain" }, 400);

  const validation = validateSlugCandidate(slug);
  if (!validation.valid) return jsonResponse({ error: validation.error }, 400);

  // Pre-check so a taken/reserved subdomain surfaces as a clear error
  // before attempting the update - same reasoning as onboard.ts/
  // trial-signup.ts's own pre-checks. The try/catch below is the real
  // guarantee against a race.
  const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (existing) return jsonResponse({ error: "That subdomain is already taken" }, 409);

  const subdomain = `${slug}.airfieldcentral.com`;

  try {
    await env.DB
      .prepare("UPDATE tenants SET slug = ?, subdomain = ?, subdomain_confirmed = 1 WHERE id = ?")
      .bind(slug, subdomain, invite.tenantId)
      .run();
    await syncOrganizationIdentity(env.DB, invite.organizationId, { slug });
  } catch {
    // tenants.slug/subdomain are both UNIQUE (migration
    // 0022_tenant_schema.sql) - only reachable via a genuine race with
    // another request choosing the exact same slug between the
    // pre-check above and this UPDATE.
    return jsonResponse({ error: "That subdomain was just taken - please try a different one" }, 409);
  }

  return jsonResponse({ ok: true, slug, subdomain });
};
