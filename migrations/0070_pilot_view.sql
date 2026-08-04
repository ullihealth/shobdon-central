-- Pilot View (/pilot) - a new mobile-first, single-column, read-only
-- per-tenant screen. Reuses almost all existing data (weather/NOTAMs/
-- fuel/notices already flow through the public config endpoint), but
-- needs two genuinely new pieces of per-tenant data that don't exist
-- anywhere else in this app.
--
-- afiso_open/afiso_frequency: no live AFISO data source exists anywhere
-- (confirmed - not derivable from anything already captured) - this is
-- a manual, platform-admin-set pair of fields, same posture as the
-- other scalar tenant settings already on this table (has_physical_atc,
-- carousel_budget_*). afiso_frequency stays free text deliberately -
-- airfields format frequencies inconsistently (122.250 vs 122.25 vs
-- with an "A/G" suffix) and validating against a strict pattern risks
-- rejecting a real value.
ALTER TABLE tenants ADD COLUMN afiso_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN afiso_frequency TEXT NOT NULL DEFAULT '';

-- The Pilot View's own sticky ticker content, configured independently
-- of the café template's own ticker (cafe_template_settings.tickerSlotsJson)
-- - different audience/page, must be independently configurable, not
-- shared config. Reuses CafeTicker.tsx's existing TickerSlot JSON shape
-- verbatim ({position, type, enabled, noticeId, textMode, manualText}) -
-- no new vocabulary, so that component is reusable completely unmodified
-- as the renderer here. Defaulted in application code
-- (functions/api/platform/tenants/[id]/pilot-view.ts's own
-- defaultTickerSlots(), mirroring cafe-settings/index.ts's own
-- defaultSettings() convention), not baked into this column default -
-- same "SQL default is inert, the route's own default fn is
-- authoritative" reasoning that file already documents.
ALTER TABLE tenants ADD COLUMN pilot_ticker_slots_json TEXT NOT NULL DEFAULT '[]';
