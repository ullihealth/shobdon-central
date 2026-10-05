-- Stripe groundwork (Airfield Pack round, Phase B1) - test-mode only so
-- far, no live keys/webhook wired up yet. Two tenant columns to remember
-- which Stripe customer/subscription a tenant is tied to (populated by
-- functions/api/stripe/webhook.ts's checkout.session.completed handler,
-- matched via client_reference_id - see that file's own comment for why
-- this is the only match path, deliberately never by email), plus a
-- small idempotency ledger so a Stripe retry of the same event (Stripe
-- itself can and does redeliver) is a safe no-op rather than double-
-- applying an entitlement change or appending a duplicate
-- subscription_history row.
--
-- Nullable, no DEFAULT needed beyond NULL - every existing tenant
-- (Shobdon/demo/newcustomer/the comped list) has no Stripe relationship
-- at all and should simply show NULL here, not an empty string (which
-- would misleadingly look like "we looked and there's nothing" instead
-- of "never checked"). True zero-behavior-change: nothing reads these
-- columns anywhere yet except the new webhook route itself.
ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id TEXT;

-- One row per tenant is enough for a straight 1:1 lookup, but a
-- customer can in principle share a subscription id across
-- re-subscribes etc.; a UNIQUE index (not a second implicit scan) keeps
-- "find the tenant for this subscription/customer" cheap without
-- forcing either column to be NOT NULL (a tenant may have a customer id
-- before it has a subscription id, e.g. mid-checkout).
CREATE UNIQUE INDEX idx_tenants_stripe_customer_id ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tenants_stripe_subscription_id ON tenants(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Idempotency ledger - event.id is the Stripe event's own id (e.g.
-- "evt_..."), globally unique per Stripe account, used directly as the
-- primary key so a second delivery of the same event is a plain INSERT
-- OR IGNORE no-op (see the webhook route) rather than needing a
-- SELECT-then-INSERT race. type/received_at are kept purely for
-- diagnosability (what did we last see, and when) - nothing reads them
-- back programmatically today.
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
