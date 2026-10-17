// Any authenticated tenant member: POST /api/tenant/media-box-consent/accept
// Media Box loan consent round - a SEPARATE, explicit acceptance of
// Customer Terms Schedule 1 (the Media Box loan + up-to-£99-per-incident
// card-charge authority), distinct from general Customer Terms
// acceptance (functions/api/tenant/terms/accept.ts, user.
// termsAcceptedAt/Version/Ip). Why separate: the general Terms checkbox
// already mentions Schedule 1 in passing, but the card-charge authority
// it grants is a more significant commitment than ordinary ToS
// acceptance, so it gets its own dedicated opt-in and its own audit
// trail - not folded into the existing endpoint above.
//
// Stored on TENANTS, not user (unlike termsAccepted*) - go-ahead's own
// instruction: the Media Box is tenant-level equipment, and consent
// should travel with the tenant regardless of which individual member
// happened to give it. requireTenant (not requireOwner) - same
// reasoning as terms/accept.ts: any member acting on the tenant's
// behalf can give this consent, not just the owner.
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

  const tenantRow = await env.DB
    .prepare("SELECT id FROM tenants WHERE organization_id = ?")
    .bind(result.membership.organizationId)
    .first<{ id: number }>();
  if (!tenantRow) return jsonResponse({ error: "Tenant not found" }, 404);

  const ip = request.headers.get("CF-Connecting-IP") || "";

  await env.DB
    .prepare("UPDATE tenants SET media_box_consent_at = ?, media_box_consent_version = ?, media_box_consent_ip = ? WHERE id = ?")
    .bind(new Date().toISOString(), TERMS_VERSION, ip, tenantRow.id)
    .run();

  return jsonResponse({ ok: true });
};
