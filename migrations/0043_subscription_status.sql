-- Manually-maintained subscription/account status, ahead of real Stripe
-- integration (which doesn't exist yet) - a placeholder Jeff can use by
-- hand today, structured so it's a natural fit to wire up to real
-- billing webhook events later rather than throwaway. Distinct from the
-- existing tenants.active (pause/resume - a hard on/off switch for
-- whether the tenant's public dashboard even resolves) and
-- tenant_displays.entitled (the café add-on gate, per-display) - neither
-- of those represents "which stage of the customer lifecycle is this
-- tenant in," which is what this is for.
--
-- 'trial' default - matches every existing tenant's actual current
-- state (none of them have ever been marked as a paying customer
-- anywhere), so this is a true zero-behavior-change default, not a
-- guess. 'comped' (not 'active') is the right label for accounts that
-- will never actually pay (Shobdon/demo/newcustomer/internal test
-- tenants) - keeps them out of "cancelled" (which reads as churn) and
-- out of "active" (which would misleadingly claim they're a paying
-- customer once Stripe reporting exists).
ALTER TABLE tenants ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN subscription_notes TEXT NOT NULL DEFAULT '';

-- Append-only log, not a JSON column on tenants (unlike club_theme's
-- saved_swatches_json) - that pattern fits a small, bounded, always-
-- fully-overwritten set (at most a handful of swatches); this instead
-- grows one row per status change across a tenant's entire lifetime,
-- exactly the same "keeps growing, needs its own rows to query/sort/
-- prune" shape display_visits (migration 0041) already established in
-- this codebase for the same reason. A write to tenants.subscription_
-- status/subscription_notes always appends one row here in the same
-- request (see functions/api/platform/tenants/[id].ts) - the same shape
-- a Stripe webhook handler would eventually populate (checkout.session.
-- completed -> 'active', invoice.payment_failed -> 'past_due', etc.),
-- so this is forward-compatible scaffolding, not throwaway.
--
-- changed_by_user_id has no FK/NOT NULL - a future webhook-driven insert
-- won't have a real platform-admin user id to attribute the change to
-- (it'll want something like 'stripe-webhook' instead), so this stays a
-- plain nullable TEXT rather than a hard reference to `user`.
CREATE TABLE subscription_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  changed_by_user_id TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscription_history_tenant_time ON subscription_history(tenant_id, changed_at);
