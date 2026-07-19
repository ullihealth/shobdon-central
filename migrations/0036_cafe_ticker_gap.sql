-- Café ticker gap-between-items control (Part B, same round as the
-- Part A stutter fix). Additive only. Defaults to 0 - today's tight,
-- no-extra-spacing look - so nothing changes for a tenant who never
-- visits CAFE MEDIA again after this migration, same posture as every
-- other tickerStyle column added in 0035.
ALTER TABLE cafe_template_settings ADD COLUMN tickerGapPx INTEGER NOT NULL DEFAULT 0;
