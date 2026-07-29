-- Cloudflare-native geolocation on display_visits, going forward only -
-- Cloudflare already resolves every request's approximate location at
-- the edge (request.cf: country, region, city, latitude, longitude) at
-- zero extra cost or external API call, so heartbeat.ts (the only
-- writer of this table) is updated to persist it alongside the
-- existing ip_address/user_agent capture. All nullable, all TEXT
-- (Cloudflare hands back latitude/longitude as strings, not numbers,
-- and this table stores them as-received rather than parsing to REAL -
-- they're display-only fields here, never computed on).
--
-- Deliberately no backfill: rows written before this migration simply
-- have NULL in these columns forever - request.cf was never captured
-- for them and there's no way to recover it after the fact. The
-- frontend (PlatformVisitsPage.tsx) shows an explicit "not available"
-- message for NULL rather than implying every row has geo data.
ALTER TABLE display_visits ADD COLUMN geo_country TEXT;
ALTER TABLE display_visits ADD COLUMN geo_region TEXT;
ALTER TABLE display_visits ADD COLUMN geo_city TEXT;
ALTER TABLE display_visits ADD COLUMN geo_latitude TEXT;
ALTER TABLE display_visits ADD COLUMN geo_longitude TEXT;
