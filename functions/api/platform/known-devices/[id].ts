// Platform-admin only: PATCH /api/platform/known-devices/:id - retires a
// known device (active=0) without deleting the row, so the historical
// decision stays on record for audit purposes. A retired IP is still
// excluded from re-suggestion only while active=1 elsewhere is false for
// it too - see suggestions.ts's own query, which only excludes IPs with
// active=1, so a retired IP legitimately reappears as a fresh suggestion
// if it's seen again later (see migration 0056's own comment on why).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);

  await env.DB.prepare("UPDATE tenant_known_devices SET active = 0 WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
};
