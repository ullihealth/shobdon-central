// Authenticated (requireOwner - matches config.ts's own admin-action
// posture): PATCH /api/tenant/cameras/:id. Deliberately narrow - flips
// push_enabled only, nothing else about a camera's setup (RTSP address,
// relay assignment, mode) is editable from here. This is the "go live
// remotely" action a tenant's own owner triggers from their dashboard;
// full camera CRUD (creating/reassigning/deleting cameras) stays
// platform-admin-only (functions/api/platform/cameras/), since that's
// physical on-site setup work, not something a tenant configures
// themselves.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { pushEnabled?: unknown } | null;
  if (!body || typeof body.pushEnabled !== "boolean") {
    return jsonResponse({ error: "pushEnabled (boolean) is required" }, 400);
  }

  // Explicit ownership check before the write, rather than folding it
  // into the UPDATE's WHERE clause and inspecting affected-row count -
  // this codebase's minimal D1Database type (tenantAuth.ts) only
  // exposes run() -> { success }, not a row-count, so this is both the
  // type-safe option and gives a clean 404 for "not yours"/"doesn't
  // exist" without needing to distinguish the two.
  const owned = await env.DB
    .prepare("SELECT c.id FROM cameras c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ? AND t.organization_id = ?")
    .bind(params.id, organizationId)
    .first<{ id: string }>();
  if (!owned) return jsonResponse({ error: "Camera not found" }, 404);

  await env.DB
    .prepare("UPDATE cameras SET push_enabled = ?, updated_at = ? WHERE id = ?")
    .bind(body.pushEnabled ? 1 : 0, new Date().toISOString(), params.id)
    .run();

  return jsonResponse({ ok: true });
};
