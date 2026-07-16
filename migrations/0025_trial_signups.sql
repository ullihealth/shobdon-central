-- Records self-serve trial signups from the public landing page
-- (src/pages/LandingPage.tsx / functions/api/public/trial-signup.ts).
--
-- Kept as its own table rather than columns on tenants - contact_email
-- and location_text are one-time signup metadata (what the requester
-- typed before anyone's confirmed real coordinates or set up a real
-- login), not an ongoing property of the tenant itself. Matches this
-- project's existing preference for purpose-specific tables over
-- bolting one-off fields onto a shared row (camera_slots/carousel_slots
-- /club_theme are all separate tables for the same reason).
--
-- Additive only - does not alter tenants or any other existing table.
CREATE TABLE trial_signups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    contact_email   TEXT NOT NULL,
    location_text   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_trial_signups_tenant ON trial_signups(tenant_id);
