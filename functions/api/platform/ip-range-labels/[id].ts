// Platform-admin only: PUT (rename the group) / DELETE /api/platform/ip-range-labels/:id.
// Deleting a range label only stops future/past matching rows picking it up -
// it never touches ip_labels.
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

  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);
  const body = (await request.json().catch(() => null)) as { groupName?: unknown } | null;
  const groupName = typeof body?.groupName === "string" ? body.groupName.trim() : "";
  if (!groupName) return jsonResponse({ error: "groupName is required" }, 400);

  await env.DB.prepare("UPDATE ip_range_labels SET group_name = ? WHERE id = ?").bind(groupName, id).run();
  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);

  await env.DB.prepare("DELETE FROM ip_range_labels WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
};
