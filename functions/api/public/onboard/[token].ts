// Public, unauthenticated: GET /api/public/onboard/:token - validates an
// invite token before OnboardInvitePage.tsx renders either the new
// subdomain-picker step or the account-setup form, so an expired/used/
// bogus link shows a clear message instead of a broken form with no
// path forward.
//
// subdomain added to the response (cross-subdomain session round) - the
// invite link itself is deliberately path-based/host-agnostic (onboard.ts's
// own comment), but OnboardInvitePage.tsx needs this value to redirect
// onto the tenant's own subdomain BEFORE creating the account there, so
// the resulting session cookie is scoped to the host the new admin will
// actually be using next, not the generic app domain the link happened
// to be opened from.
//
// subdomainConfirmed added (subdomain-picker round) - migration
// 0046_tenant_subdomain_confirmed.sql. false means this is still
// onboard.ts's own random tenant-XXXXXXXX placeholder and
// OnboardInvitePage.tsx must show the new required picker step before
// anything else; true means a human already chose it (platform admin
// at creation, or a prior visit to the picker) and that step is skipped
// entirely.
import { jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface InviteRow {
  expiresAt: string;
  usedAt: string | null;
  tenantName: string;
  subdomain: string;
  subdomainConfirmed: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = params.token;
  if (!token) return jsonResponse({ valid: false, reason: "not_found" });

  const invite = await env.DB
    .prepare(
      `SELECT ti.expires_at AS expiresAt, ti.used_at AS usedAt, t.name AS tenantName, t.subdomain AS subdomain, t.subdomain_confirmed AS subdomainConfirmed
       FROM tenant_invites ti
       JOIN tenants t ON t.id = ti.tenant_id
       WHERE ti.token = ?`
    )
    .bind(token)
    .first<InviteRow>();

  if (!invite) return jsonResponse({ valid: false, reason: "not_found" });
  if (invite.usedAt) return jsonResponse({ valid: false, reason: "used" });
  if (new Date(invite.expiresAt).getTime() < Date.now()) return jsonResponse({ valid: false, reason: "expired" });

  return jsonResponse({
    valid: true,
    tenantName: invite.tenantName,
    subdomain: invite.subdomain,
    subdomainConfirmed: !!invite.subdomainConfirmed,
  });
};
