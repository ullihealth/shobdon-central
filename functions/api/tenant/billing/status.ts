// GET /api/tenant/billing/status - owner/admin. Backs the Billing page and the
// "subscription not active" page: plan, status, next payment date and recent
// invoices (read live from Stripe when the tenant has a Stripe customer).
// Still works for a SUSPENDED tenant (allow-listed in tenantAuth.ts) - the whole
// point is letting them see and settle billing. A Stripe failure never fails the
// request: it returns what the database knows plus stripeError: true.
import { requireTenant, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { loadBillingContext } from "../../_utils/billingContext";
import { isStripeFailure, listInvoices, retrieveSubscription, type StripeEnv } from "../../_utils/stripeApi";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;
interface Env extends StripeEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Owner / admin of the tenant, OR a developer / platform admin (read-only: they may
  // VIEW any tenant's billing but never act as the tenant - checkout.ts and portal.ts
  // refuse developers).
  const auth = await requireTenant(request, env);
  if ("error" in auth) return auth.error;
  const userRow = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(auth.userId).first<{ developer: number }>();
  const isDeveloper = !!userRow?.developer;
  if (!isDeveloper && !["owner", "admin"].includes(auth.membership.role)) {
    return jsonResponse({ error: "Role must be one of: owner, admin" }, 403);
  }
  const ctx = await loadBillingContext(env.DB, auth.membership.organizationId, auth.userId);
  if (!ctx) return jsonResponse({ error: "Tenant not found" }, 404);

  let nextPaymentDate: string | null = null;
  let stripeStatus: string | null = null;
  let cancelAtPeriodEnd = false;
  let amount: { value: number; currency: string } | null = null;
  let invoices: { id: string; number: string | null; status: string | null; amountPaid: number; currency: string; created: string | null; hostedUrl: string | null; pdfUrl: string | null }[] = [];
  let stripeError = false;

  if (ctx.stripeSubscriptionId) {
    const sub = await retrieveSubscription(env, ctx.stripeSubscriptionId);
    if (isStripeFailure(sub)) {
      stripeError = true;
    } else {
      stripeStatus = sub.status;
      cancelAtPeriodEnd = !!sub.cancel_at_period_end;
      const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
      nextPaymentDate = end ? new Date(end * 1000).toISOString() : null;
      const price = sub.items?.data?.[0]?.price;
      if (price?.unit_amount != null) amount = { value: price.unit_amount / 100, currency: (price.currency ?? "gbp").toUpperCase() };
    }
  }
  if (ctx.stripeCustomerId) {
    const list = await listInvoices(env, ctx.stripeCustomerId);
    if (isStripeFailure(list)) stripeError = true;
    else
      invoices = list.data.map((inv) => ({
        id: inv.id,
        number: inv.number ?? null,
        status: inv.status ?? null,
        amountPaid: (inv.amount_paid ?? 0) / 100,
        currency: (inv.currency ?? "gbp").toUpperCase(),
        created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        hostedUrl: inv.hosted_invoice_url ?? null,
        pdfUrl: inv.invoice_pdf ?? null,
      }));
  }

  return jsonResponse({
    tenantName: ctx.name,
    plan: ctx.plan,
    subscriptionStatus: ctx.subscriptionStatus,
    stripeStatus,
    cancelAtPeriodEnd,
    amount,
    nextPaymentDate,
    invoices,
    hasStripeCustomer: !!ctx.stripeCustomerId,
    hasStripeSubscription: !!ctx.stripeSubscriptionId,
    tenantActive: ctx.active,
    paymentReceived: ctx.paymentReceived,
    includesMediaBox: ctx.includesMediaBox,
    hasMediaBoxConsent: ctx.hasMediaBoxConsent,
    hasAcceptedTerms: ctx.hasAcceptedTerms,
    stripeError,
    isDeveloper,
  });
};
