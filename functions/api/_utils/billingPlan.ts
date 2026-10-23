// Which plan a tenant's "Activate subscription" button sells, and whether it
// includes the physical Media Box (which needs the Schedule 1 consent first).
// Plan ids / env price vars mirror src/config/pricing.ts (display copy) and
// stripe/checkout.ts (the same small mapping is deliberately duplicated rather
// than imported across the functions/src boundary).
import type { D1Database } from "./tenantAuth";

export type BillingPlan = "pack" | "pilotApp";
export const PLANS_WITH_MEDIA_BOX: readonly BillingPlan[] = ["pack"];

export function priceIdForPlan(plan: BillingPlan, env: { STRIPE_PRICE_PACK?: string; STRIPE_PRICE_PILOT_APP?: string }): string | undefined {
  return plan === "pack" ? env.STRIPE_PRICE_PACK : env.STRIPE_PRICE_PILOT_APP;
}

// 1. The plan of the most recent activation link a developer issued for this
//    tenant (an explicit choice), else
// 2. 'pack' if the tenant has the Reception Dashboard enabled (dashboard_enabled),
//    else 'pilotApp'.
export async function resolveTenantPlan(db: D1Database, tenantId: number, dashboardEnabled: boolean): Promise<BillingPlan> {
  const link = await db
    .prepare("SELECT plan FROM activation_links WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(tenantId)
    .first<{ plan: string }>()
    .catch(() => null);
  if (link?.plan === "pack" || link?.plan === "pilotApp") return link.plan;
  return dashboardEnabled ? "pack" : "pilotApp";
}
