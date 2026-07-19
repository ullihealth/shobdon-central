-- Café ticker styling (Phase 2, deliberately deferred when the ticker
-- first shipped) - the CURRENTLY ACTIVE style for a tenant's ticker.
-- Named presets/custom "saved templates" a tenant can pick from live in
-- localStorage (src/services/tickerStyleStore.ts), same pattern as the
-- Dashboard Design colour theme templates - only the resulting active
-- style, once applied, needs to be here, since this is what the public
-- dashboard actually reads via publicConfig.ts. Additive only, matching
-- every other ALTER TABLE in this schema.
--
-- Defaults reproduce today's implicit hard-coded look (see
-- tickerStyleStore.ts's DEFAULT_TICKER_STYLE) exactly, so every existing
-- tenant's ticker renders pixel-identical to before the moment this
-- migration runs - nothing changes until a tenant actually visits
-- CAFE MEDIA and picks a preset or adjusts a control.
ALTER TABLE cafe_template_settings ADD COLUMN tickerBackgroundColor TEXT NOT NULL DEFAULT '#0f172a';
ALTER TABLE cafe_template_settings ADD COLUMN tickerBackgroundOpacity INTEGER NOT NULL DEFAULT 100;
ALTER TABLE cafe_template_settings ADD COLUMN tickerHeightPx INTEGER NOT NULL DEFAULT 64;
ALTER TABLE cafe_template_settings ADD COLUMN tickerFontFamily TEXT NOT NULL DEFAULT 'Inter';
ALTER TABLE cafe_template_settings ADD COLUMN tickerFontSizePx INTEGER NOT NULL DEFAULT 16;
ALTER TABLE cafe_template_settings ADD COLUMN tickerFontColor TEXT NOT NULL DEFAULT '#ffffff';
-- px/second the ticker scrolls at - 0 is a valid, deliberate value
-- (static, no animation), not an unset/placeholder marker.
ALTER TABLE cafe_template_settings ADD COLUMN tickerScrollSpeedPxPerSec INTEGER NOT NULL DEFAULT 80;
