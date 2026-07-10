// Owner-only member revocation: DELETE /api/tenant/members/:id.
// Deleting the member row is the entire revocation mechanism - no
// separate "disabled" flag needed. tenantAuth.ts's requireTenant/
// requireOwner already require a live member row on every request to
// functions/api/tenant/*, so this takes effect immediately on that
// member's very next request.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const memberId = params.id;
  if (!memberId) return jsonResponse({ error: "Missing member id" }, 400);

  // Scoped to the requesting owner's own organizationId - an id from a
  // different tenant simply won't match and the WHERE clause below finds
  // nothing to delete, rather than trusting the id alone.
  const target = await env.DB
    .prepare("SELECT role FROM member WHERE id = ? AND organizationId = ?")
    .bind(memberId, organizationId)
    .first<{ role: string }>();

  if (!target) return jsonResponse({ error: "Member not found" }, 404);
  // Owner removal isn't in scope here - this endpoint is for revoking
  // admin/atc access an owner granted, not for an owner to (possibly
  // accidentally) remove themselves or another owner.
  if (target.role === "owner") return jsonResponse({ error: "Cannot remove an owner via this endpoint" }, 400);

  await env.DB.prepare("DELETE FROM member WHERE id = ? AND organizationId = ?").bind(memberId, organizationId).run();

  return jsonResponse({ ok: true });
};
