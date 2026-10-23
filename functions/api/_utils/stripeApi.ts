// Small plain-fetch Stripe REST helpers for the tenant billing routes
// (/api/tenant/billing/*) - same no-SDK posture as stripe/webhook.ts and
// stripe/checkout.ts (see their comments). Secrets only ever come from env
// (STRIPE_SECRET_KEY); nothing here logs or returns a key.
//
// STRIPE_API_BASE_URL is the existing test-only escape hatch (webhook.ts): unset
// in production (-> https://api.stripe.com), pointed at a local stub in tests.

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_API_BASE_URL?: string;
}

export interface StripeFailure {
  error: string;
}

async function stripeRequest<T>(env: StripeEnv, method: "GET" | "POST", path: string, form?: URLSearchParams): Promise<T | StripeFailure> {
  if (!env.STRIPE_SECRET_KEY) return { error: "Stripe is not configured" };
  const base = env.STRIPE_API_BASE_URL || "https://api.stripe.com";
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !body) return { error: body?.error?.message || `Stripe responded ${response.status}` };
    return body;
  } catch {
    return { error: "Could not reach Stripe" };
  }
}

export const isStripeFailure = (value: unknown): value is StripeFailure => !!value && typeof value === "object" && "error" in (value as object) && typeof (value as StripeFailure).error === "string";

export async function createCheckoutSession(
  env: StripeEnv,
  params: { priceId: string; tenantId: number; customerEmail: string; successUrl: string; cancelUrl: string; includesMediaBox: boolean }
): Promise<{ id: string; url: string } | StripeFailure> {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", params.priceId);
  form.set("line_items[0][quantity]", "1");
  // The tenant's own integer id - exactly what webhook.ts's
  // findTenantByClientReferenceId expects, so payment flows through the SAME
  // webhook path as every other checkout (and never touches tenants.active).
  form.set("client_reference_id", String(params.tenantId));
  form.set("customer_email", params.customerEmail);
  form.set("allow_promotion_codes", "true");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  if (params.includesMediaBox) {
    form.set(
      "custom_text[submit][message]",
      "Your card will be saved for your subscription and, under the Media Box loan terms you accepted, for any Schedule 1 charge (max £99, with notice)."
    );
  }
  return stripeRequest(env, "POST", "/v1/checkout/sessions", form);
}

// Stripe Customer Portal (update card, invoices, cancel) - requires the portal
// to be configured once in the Stripe dashboard (test + live separately).
export async function createPortalSession(env: StripeEnv, customerId: string, returnUrl: string): Promise<{ url: string } | StripeFailure> {
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", returnUrl);
  return stripeRequest(env, "POST", "/v1/billing_portal/sessions", form);
}

export interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: { current_period_end?: number; price?: { unit_amount?: number | null; currency?: string; nickname?: string | null } }[] };
}

export function retrieveSubscription(env: StripeEnv, subscriptionId: string) {
  return stripeRequest<StripeSubscription>(env, "GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export interface StripeInvoice {
  id: string;
  number?: string | null;
  status?: string | null;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  created?: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

export function listInvoices(env: StripeEnv, customerId: string, limit = 6) {
  return stripeRequest<{ data: StripeInvoice[] }>(env, "GET", `/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=${limit}`);
}
