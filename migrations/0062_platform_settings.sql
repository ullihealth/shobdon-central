-- Small, generic platform-wide key/value settings table - first use is
-- the public marketing domain's landing_page_mode flag ('coming_soon' |
-- 'live'), toggled from /developertools (functions/api/platform/
-- landing-mode.ts), read unauthenticated by RootRoute.tsx via functions/
-- api/public/landing-mode.ts for anyone hitting the bare
-- airfieldcentral.com root. Deliberately a real D1 table, not the
-- WEATHER_CACHE KV namespace - that binding's own wrangler.toml comment
-- scopes it to short-TTL third-party API cache data with "no durable/
-- relational value", which this genuinely is (a durable admin setting
-- that must survive indefinitely, not expire). Generic key/value shape
-- (not a single-purpose landing_page_mode table) so a future platform-
-- wide toggle has somewhere to live without another migration.
--
-- Seeded 'coming_soon' by explicit instruction: the real landing page
-- goes out of public view the moment this ships, flipped back to 'live'
-- manually via the toggle when ready - never the other way around by
-- default.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

INSERT INTO platform_settings (key, value, updatedAt) VALUES ('landing_page_mode', 'coming_soon', datetime('now'));
