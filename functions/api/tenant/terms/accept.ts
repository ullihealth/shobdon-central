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

  await env.DB
    .prepare("UPDATE user SET termsAcceptedAt = ?, termsAcceptedVersion = ? WHERE id = ?")
    .bind(new Date().toISOString(), TERMS_VERSION, result.userId)
    .run();

  return jsonResponse({ ok: true });
};
