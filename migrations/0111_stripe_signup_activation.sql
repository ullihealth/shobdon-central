-- Stripe groundwork Part B/C (paid signup + existing-tenant activation).
--
-- user.termsAcceptedIp sits alongside the existing termsAcceptedAt/
-- termsAcceptedVersion columns (migration 0108) - the go-ahead's own
-- requirement to record IP at the moment Terms are accepted, on the
-- same existing mechanism this app already uses for terms tracking
-- (OnboardingTermsPage.tsx's mandatory gate, tenant/me.ts's
-- hasAcceptedTerms), not a new table. NULL-default, nullable: every
-- existing user accepted Terms before this column existed and has no IP
-- on file for that - NULL correctly reads as "not recorded" rather than
-- a fabricated value.
ALTER TABLE user ADD COLUMN termsAcceptedIp TEXT;

-- activation_links (Part C) - single-use, expiring tokens a platform
-- admin generates from /platform/tenants for an EXISTING tenant (Tiger,
-- id 29, is the motivating case) to pay for a plan without going through
-- new-tenant signup/cloning. plan is the chosen Stripe price's plan id
-- ('pack'/'pilotApp' - same two values functions/api/public/signup.ts
-- accepts, Media Screen excluded for the same reason - see that file's
-- own comment). usedAt is set the moment a Checkout Session is actually
-- created from this token (not merely viewed) - see functions/api/stripe/
-- checkout.ts's own comment on why "used" means "session created", not
-- "payment completed" (the webhook is the only thing that ever grants
-- entitlement; this table is purely about preventing the LINK itself
-- from being replayed to start a second checkout).
CREATE TABLE activation_links (
  token TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  plan TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_activation_links_tenant ON activation_links(tenant_id);
