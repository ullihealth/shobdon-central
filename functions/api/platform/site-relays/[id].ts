// Platform-admin only: PUT/DELETE /api/platform/site-relays/:id.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { label?: unknown; localBaseUrl?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const localBaseUrl = typeof body.localBaseUrl === "string" ? body.localBaseUrl.trim() : "";
  if (!label) return jsonResponse({ error: "label is required" }, 400);
  if (!localBaseUrl) return jsonResponse({ error: "localBaseUrl is required" }, 400);

  await env.DB
    .prepare("UPDATE site_relays SET label = ?, local_base_url = ?, updated_at = ? WHERE id = ?")
    .bind(label, localBaseUrl, new Date().toISOString(), params.id)
    .run();

  return jsonResponse({ ok: true });
};

// Cameras reference site_relays via a plain REFERENCES FK with no ON
// DELETE clause - D1/SQLite doesn't enforce FK constraints by default
// unless PRAGMA foreign_keys=ON is set per-connection (it isn't here,
// matching every other table in this schema), so this checks for
// dependent cameras explicitly rather than relying on the database to
// reject the delete - an orphaned camera.site_relay_id would otherwise
// silently break the relay poll endpoint for that camera.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const dependentCamera = await env.DB.prepare("SELECT id FROM cameras WHERE site_relay_id = ?").bind(params.id).first<{ id: string }>();
  if (dependentCamera) {
    return jsonResponse({ error: "Cannot delete a site relay with cameras still assigned to it" }, 409);
  }

  await env.DB.prepare("DELETE FROM site_relays WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
};
