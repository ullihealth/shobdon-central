// Public, UNAUTHENTICATED: GET /api/public/activation/:token - Stripe
// groundwork Part C. Validates an activation link and reports enough for
// src/pages/ActivationPage.tsx to decide what to show (log in, accept
// terms, or go straight to checkout) - never requires a session itself
// (a visitor may not be logged in yet), but DOES report whether the
// CURRENTLY logged-in session (if any) is actually a member of the
// token's own tenant, since "must log in as a member of THAT tenant" is
// enforced here too, not just by checkout.ts's own activationToken
// tenant-match check (that one is the real boundary; this is so the
// frontend can show a clear message before the user even tries).
import { getSessionUserId, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { TERMS_VERSION } from "../../_utils/termsVersion";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = params.token;
  if (!token) return jsonResponse({ error: "Missing token" }, 400);

  const link = await env.DB
    .prepare(
      `SELECT al.tenant_id AS tenantId, al.plan AS plan, al.expires_at AS expiresAt, al.used_at AS usedAt,
              al.includes_media_box AS includesMediaBox,
              t.name AS tenantName, t.slug AS tenantSlug, t.stripe_subscription_id AS stripeSubscriptionId,
              t.media_box_consent_version AS mediaBoxConsentVersion
       FROM activation_links al JOIN tenants t ON t.id = al.tenant_id
       WHERE al.token = ?`
    )
    .bind(token)
    .first<{
      tenantId: number;
      plan: string;
      expiresAt: string;
      usedAt: string | null;
      includesMediaBox: number;
      tenantName: string;
      tenantSlug: string;
      stripeSubscriptionId: string | null;
      mediaBoxConsentVersion: string | null;
    }>();

  if (!link) return jsonResponse({ error: "This activation link is not valid" }, 404);
  if (link.usedAt) return jsonResponse({ error: "This activation link has already been used" }, 409);
  if (new Date(link.expiresAt).getTime() < Date.now()) return jsonResponse({ error: "This activation link has expired" }, 410);
  if (link.stripeSubscriptionId) {
    return jsonResponse({ error: `${link.tenantName} already has an active subscription.` }, 409);
  }

  const userId = await getSessionUserId(request, env);
  let loggedIn = false;
  let isMemberOfTenant = false;
  let hasAcceptedCurrentTerms = false;

  if (userId) {
    loggedIn = true;
    const [membership, userRow] = await Promise.all([
      env.DB
        .prepare("SELECT 1 AS found FROM member WHERE userId = ? AND organizationId = (SELECT organization_id FROM tenants WHERE id = ?)")
        .bind(userId, link.tenantId)
        .first<{ found: number }>(),
      env.DB.prepare("SELECT termsAcceptedVersion AS termsAcceptedVersion FROM user WHERE id = ?").bind(userId).first<{ termsAcceptedVersion: string | null }>(),
    ]);
    isMemberOfTenant = !!membership;
    hasAcceptedCurrentTerms = userRow?.termsAcceptedVersion === TERMS_VERSION;
  }

  return jsonResponse({
    tenantName: link.tenantName,
    tenantSlug: link.tenantSlug,
    plan: link.plan,
    loggedIn,
    isMemberOfTenant,
    hasAcceptedCurrentTerms,
    // Media Box consent round - includesMediaBox is this LINK's own
    // flag (set when a platform admin created it); hasMediaBoxConsent
    // mirrors hasAcceptedCurrentTerms's own "matches the current
    // version, not just non-null" check, but reads the TENANT's own
    // consent (media_box_consent_version), not the user's - correct
    // even for a second member who never personally accepted, since
    // consent here belongs to the tenant.
    includesMediaBox: !!link.includesMediaBox,
    hasMediaBoxConsent: link.mediaBoxConsentVersion === TERMS_VERSION,
  });
};
