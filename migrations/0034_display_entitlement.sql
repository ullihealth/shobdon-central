-- Per-display developer overrides for tenant_displays: Part D's
-- independent force-off (any single display slot, e.g. for support/
-- maintenance) and Part C's café-specific entitlement (paid or active
-- trial). Additive only. Also retires the old 'cafe-tv' template_id in
-- favour of the new CafeTemplate's 'cafe-1' (see TenantDisplayPage.tsx).

-- Part D - independent of both tenants.active (whole-tenant pause) and
-- the entitled column below. Lets a developer disable just 'main' or
-- just 'cafe-tv' for one tenant, the other display staying live.
-- Defaults 1 so every existing display (Shobdon main, Shobdon cafe-tv,
-- Demo main) keeps working exactly as it does today - a pure additive
-- override, not a new default-off gate.
ALTER TABLE tenant_displays ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

-- Part C - whether THIS display is currently entitled (paid or an
-- active trial). The column is generic (same table Part D's `active`
-- lives on) but is only ever CONSULTED for slug='cafe-tv' (see
-- functions/api/public/display.ts) - 'main' rows carry it too but its
-- value there is inert, never read.
--
-- Defaults 1 (entitled). This is what grandfathers every EXISTING row
-- the moment this migration runs, including Shobdon's real cafe-tv
-- display (tenant_displays.id=3, currently in physical/operational use) -
-- SQLite's ALTER TABLE ... ADD COLUMN ... DEFAULT backfills every
-- existing row, not just future inserts. Verified directly post-
-- migration (see session verification notes), not just assumed.
--
-- New tenants must NOT get this for free: both onboard.ts's cafe-tv
-- insert (Part E) and tenant/displays.ts's owner-facing upsert
-- explicitly pass entitled=0 for any newly-created row, overriding this
-- default - the default only exists to safely grandfather what's
-- already live today, never to grant new entitlement implicitly.
ALTER TABLE tenant_displays ADD COLUMN entitled INTEGER NOT NULL DEFAULT 1;

-- Nullable - NULL means "entitled with no expiry" (a paid tenant, or a
-- grandfathered one like Shobdon). A non-null ISO timestamp means "this
-- is a time-limited trial" - evaluated live at read-time (entitled AND
-- now < this timestamp) on every request. No background job flips
-- `entitled` back to 0 when a trial lapses - same "no expiry cron
-- exists anywhere in this app, check live at read-time" discipline
-- tenants.active already follows.
ALTER TABLE tenant_displays ADD COLUMN entitlement_trial_expires_at TEXT;

-- Retire the old café template: the 'cafe-tv' string was both this
-- display's slug (its public /d/cafe-tv URL, unchanged) AND, until now,
-- its template_id (rendered by the old CafeTvTemplate.tsx, removed this
-- change). Repointing template_id to 'cafe-1' - the same registry id
-- DashboardPage.tsx already uses for the new, richer CafeTemplate.tsx -
-- makes both dispatch points (main '/' and named '/d/:slug') share one
-- consistent meaning for that id, and TenantDisplayPage.tsx now
-- dispatches on 'cafe-1' instead of 'cafe-tv'. The display's slug
-- itself is untouched, so /d/cafe-tv keeps resolving exactly as before.
UPDATE tenant_displays SET template_id = 'cafe-1' WHERE template_id = 'cafe-tv';
