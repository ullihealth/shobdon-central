// Developer-only: PATCH /api/tenant/feature-requests/:id - changes an
// entry's status. Deliberately a separate route from index.ts's GET/POST
// (owner/admin-reachable) - status is the one field only the developer
// role may touch, same "narrowly-scoped dedicated endpoint" shape as
// tenant/developer-settings/index.ts's own reasoning for why a single
// sensitive field gets its own route rather than folding into a general
// PUT/PATCH every role can reach.
import { requireDeveloper, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const STATUSES = ["idea", "planned", "built", "parked"] as const;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;

  const id = params.id;
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = typeof body?.status === "string" ? body.status : "";

  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return jsonResponse({ error: `status must be one of: ${STATUSES.join(", ")}` }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM feature_requests WHERE id = ?").bind(id).first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Feature request not found" }, 404);

  const now = new Date().toISOString();
  await env.DB
    .prepare("UPDATE feature_requests SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, id)
    .run();

  return jsonResponse({ id, status, updatedAt: now });
};
