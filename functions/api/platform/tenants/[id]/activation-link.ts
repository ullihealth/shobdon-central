// Platform-admin only: POST /api/platform/tenants/:id/activation-link -
// Stripe groundwork Part C. Generates a single-use, expiring token a
// platform admin can send to an EXISTING tenant's own admin, who visits
// /activate/:token to pay for a plan without going through new-tenant
// signup/cloning at all. Tiger Helicopters (id 29) is the motivating
// case, but this is written generically for any existing tenant.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const VALID_PLANS = ["pack", "pilotApp"] as const;
const EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await env.DB
    .prepare("SELECT id, name, stripe_subscription_id AS stripeSubscriptionId FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: number; name: string; stripeSubscriptionId: string | null }>();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  // Refuse up front if this tenant already has a live subscription -
  // the go-ahead's own "activation can't double-subscribe him" check
  // (Step 0c), enforced here too (not just a one-off manual check before
  // building this round) so it holds for every future activation-link
  // creation, not just Tiger's first one.
  if (tenant.stripeSubscriptionId) {
    return jsonResponse({ error: `${tenant.name} already has an active Stripe subscription - activation would create a second one.` }, 409);
  }

  const body = (await request.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = typeof body?.plan === "string" && (VALID_PLANS as readonly string[]).includes(body.plan) ? body.plan : null;
  if (!plan) return jsonResponse({ error: `plan must be one of: ${VALID_PLANS.join(", ")}` }, 400);

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * DAY_MS).toISOString();

  await env.DB
    .prepare("INSERT INTO activation_links (token, tenant_id, plan, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(token, tenantId, plan, expiresAt, result.userId, now)
    .run();

  return jsonResponse({ ok: true, token, expiresAt, activationUrl: `https://airfieldcentral.com/activate/${token}` });
};
