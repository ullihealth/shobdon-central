-- Café template support: split-pane zone assignment for the existing
-- carousel_slots, plus a new settings row for café-specific toggles
-- (layout mode, ad label, ticker). Additive only.

-- 'both' (default) keeps every existing tenant's slots behaving exactly
-- as they do today in every template that doesn't look at this column
-- (Clubhouse 1/2, the existing cafe-tv named-display template) - zone
-- is only consulted by the new café template's split-pane mode, which
-- filters MediaPanel's carousel to slot.zone === zone || 'both'. Full-
-- 16:9 mode ignores this column entirely (one carousel, everything
-- enabled shows, same as every other template).
ALTER TABLE carousel_slots ADD COLUMN zone TEXT NOT NULL DEFAULT 'both';

-- One row per tenant, same shape as club_theme/ops_panel_state.
-- tickerEnabled defaults OFF (0) - a freshly-selected café template
-- with unconfigured (all-null) ticker slots shouldn't show an empty
-- scrolling bar; the tenant opts in once slots are actually set up.
-- layoutMode defaults 'full' (one carousel zone) - the simpler of the
-- two layouts, and requires no per-slot zone configuration to look
-- correct out of the box. tickerSlotsJson is a 10-element array of
-- {position, type}, type one of 'clock'|'forecast'|'conditions'|
-- 'notice'|null. Deliberately a plain new table, not a reuse of
-- tenant_displays.panel_config (that JSON blob is scoped to the older
-- simple weather/compass/media/ops show/hide booleans, not a fit for
-- this richer settings shape) - and deliberately NOT the ad-slot
-- system itself (a separate, not-yet-built piece) - just the natural
-- future home for it, extensible via ALTER TABLE same as everything
-- else in this schema.
CREATE TABLE IF NOT EXISTS cafe_template_settings (
  organizationId    TEXT PRIMARY KEY,
  layoutMode        TEXT NOT NULL DEFAULT 'full',
  adLabelEnabled    INTEGER NOT NULL DEFAULT 0,
  tickerEnabled     INTEGER NOT NULL DEFAULT 0,
  tickerSlotsJson   TEXT NOT NULL DEFAULT '[]',
  updatedAt         TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
