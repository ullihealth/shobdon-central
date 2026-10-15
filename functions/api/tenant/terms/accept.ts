// Any authenticated tenant member: POST /api/tenant/terms/accept
// requireTenant, NOT requireOwner - consent is individual, not an
// owner-only action, matching how a second member added later could
// accept independently too.
//
// Terms-versioning round (migration 0108) - now stamps
// termsAcceptedVersion alongside the existing termsAcceptedAt timestamp.
// A user's stored version is what functions/api/tenant/me.ts's
// hasAcceptedTerms actually checks (not just "is termsAcceptedAt set"),
// so this single write is what both records consent AND clears
// RequireAuth.tsx's mandatory gate for this version.
//
// Stripe groundwork round (migration 0111) - also stamps termsAcceptedIp
// now, same CF-Connecting-IP source functions/api/public/signup.ts uses
// for its own inline terms-acceptance write. Added here (not a second,
// activation-specific endpoint) since this is already the one place
// every terms-(re)acceptance in the app goes through - the mandatory
// onboarding gate AND the new /activate/:token flow (Part C) both call
// this same route.
import { requireTenant, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { TERMS_VERSION } from "../../_utils/termsVersion";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  const ip = request.headers.get("CF-Connecting-IP") || "";

  await env.DB
    .prepare("UPDATE user SET termsAcceptedAt = ?, termsAcceptedVersion = ?, termsAcceptedIp = ? WHERE id = ?")
    .bind(new Date().toISOString(), TERMS_VERSION, ip, result.userId)
    .run();

  return jsonResponse({ ok: true });
};
