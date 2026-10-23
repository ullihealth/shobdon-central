// POST /api/tenant/billing/portal - owner/admin. Opens the Stripe Customer Portal
// (update card, invoices, manage/cancel) for THIS tenant's own Stripe customer.
// 404 {code: "no_customer"} when the tenant has no Stripe customer yet (the page
// then offers "Activate subscription" instead). Needs the portal configured once
// in the Stripe dashboard (see README "Billing").
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { loadBillingContext } from "../../_utils/billingContext";
import { createPortalSession, isStripeFailure, type StripeEnv } from "../../_utils/stripeApi";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;
interface Env extends StripeEnv {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if ("error" in auth) return auth.error;
  // Developers / platform admins can VIEW a tenant's billing (status.ts) but must never
  // act as the tenant: no checkout and no billing portal.
  const dev = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(auth.userId).first<{ developer: number }>();
  if (dev?.developer) return jsonResponse({ error: "Developers cannot open the billing portal on behalf of a tenant.", code: "developer_read_only" }, 403);
  const ctx = await loadBillingContext(env.DB, auth.membership.organizationId, auth.userId);
  if (!ctx) return jsonResponse({ error: "Tenant not found" }, 404);
  if (!ctx.stripeCustomerId) return jsonResponse({ error: "No billing account yet.", code: "no_customer" }, 404);

  const session = await createPortalSession(env, ctx.stripeCustomerId, `${new URL(request.url).origin}/billing`);
  if (isStripeFailure(session)) return jsonResponse({ error: session.error }, 502);
  return jsonResponse({ ok: true, portalUrl: session.url });
};
