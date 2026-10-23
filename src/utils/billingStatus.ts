// What a CUSTOMER reads as their billing "Status". Never shows internal wording:
// our terms say there is no free trial, so the internal 'trial' state is never shown
// as "Trial". Inputs come from GET /api/tenant/billing/status.
//
// Mapping (first match wins):
//   suspended + payment received (Stripe paid)     -> "Payment received - your account will be reactivated shortly"
//   suspended (tenants.active = 0)                 -> "Not active - awaiting activation"
//   Stripe past_due / unpaid                       -> "Payment failed - please update your card"
//   internal past_due                              -> "Payment failed - please update your card"
//   Stripe canceled / internal cancelled           -> "Cancelled"
//   internal pending / Stripe incomplete           -> "Awaiting payment"
//   internal active / Stripe active|trialing       -> "Active"
//   internal comped                                -> "Active"
//   internal trial (live tenant, no paid plan)     -> "Active"   (never "Trial")
//   anything unrecognised                          -> "Active" if the tenant is live, else "Not active - awaiting activation"
export interface BillingStatusInput {
  tenantActive: boolean
  paymentReceived: boolean
  subscriptionStatus: string
  stripeStatus: string | null
}

export const NOT_ACTIVE_LABEL = 'Not active - awaiting activation'

export function customerStatusLabel(input: BillingStatusInput): string {
  const { tenantActive, paymentReceived, subscriptionStatus, stripeStatus } = input
  if (!tenantActive) return paymentReceived ? 'Payment received - your account will be reactivated shortly' : NOT_ACTIVE_LABEL
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid' || subscriptionStatus === 'past_due') return 'Payment failed - please update your card'
  if (stripeStatus === 'canceled' || subscriptionStatus === 'cancelled') return 'Cancelled'
  if (stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired' || subscriptionStatus === 'pending') return 'Awaiting payment'
  return 'Active'
}
