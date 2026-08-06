-- Admin-configurable windsock strength thresholds (knots) per tenant,
-- for the new runway/wind widget prototype (RunwayWindWidget.tsx). Real-
-- world windsock convention: fully extends around 15kt, starts drooping
-- below roughly 6kt - used as the seeded defaults here, not a guess.
-- fullKt: crosswind speed at/above which the windsock is shown fully
-- extended. mediumKt: crosswind speed at/above which it's shown at the
-- medium/drooping angle (below this, it's shown fully drooped).
ALTER TABLE tenants ADD COLUMN windsock_full_kt INTEGER NOT NULL DEFAULT 15;
ALTER TABLE tenants ADD COLUMN windsock_medium_kt INTEGER NOT NULL DEFAULT 6;
