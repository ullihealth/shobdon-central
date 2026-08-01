-- Historical backfill for the six real, already-shipped/merged commits
-- since v1.6.0 (migration 0053) - Developer Updates hadn't recorded any
-- of them. One version per commit, same "tonight's individual fixes as
-- later versions" granularity 0051 already established for 1.1.0-1.5.0.
-- ids/timestamps below are copied verbatim from `git log --pretty=
-- format:'%H|%aI|%s'` on main, not invented - created_at = released_at
-- = the real commit timestamp (UTC), since each was verified then
-- shipped directly, same posture those five entries already took.
INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at) VALUES
('a67a8649fc00cccd85e212bdea8184314ec6fb5c', 'Fix weather-share auto-switch and mock-fallback bugs; require lat/lon on new tenants',
 'Gyroplane Train''s shared weather source never actually took effect - auto-switch on share creation only fired if the receiving device''s own config was already blank. Separately, a tenant with no lat/lon on file could silently fall back to fabricated mock data on a live screen. Fixed both, backfilled missing lat/lon for existing tenants, and made lat/lon required going forward on both onboarding paths.',
 'released', 'v1.7.0', '2026-07-31T20:00:50.000Z', '2026-07-31T20:00:50.000Z'),
('6ac53849e1d26c24f9763a90f00e820736fd309d', 'Weather status badge now names the real source tenant',
 'A tenant showing another tenant''s shared weather reading previously saw a generic purple "THIRD-PARTY STATION" badge. Now shows the actual source tenant''s name (e.g. "SHOBDON ATC") with matching green/live styling when the source is a genuine ATC station, purple otherwise - never claims ATC for a reading that isn''t one.',
 'released', 'v1.8.0', '2026-07-31T20:39:18.000Z', '2026-07-31T20:39:18.000Z'),
('1cd71a45f2369173e5c112cba1f5cdf1f595c9d8', 'Parent/sub-tenant inheritance for co-located airfields',
 'New tenants.parent_tenant_id link (replacing the old weather-only tenant_weather_shares table) lets a sub-tenant inherit a parent airfield''s weather station reading, Met Office forecast, NOTAMs, gas prices, and runway/compass/ops-status data, all read-time via one shared resolver - never overwrites the sub-tenant''s own stored data, and reverts cleanly the moment it''s unlinked. Clubhouse notices always stay tenant-local. Admin-configurable via a new "Parent Airfield" picker on /platform/tenants.',
 'released', 'v1.9.0', '2026-07-31T23:38:05.000Z', '2026-07-31T23:38:05.000Z'),
('ddc6f80b5b8aadb787749857e9e39a5538d2cf4b', 'Accept AVIF for tenant logo uploads',
 'Added image/avif to the logo upload allowlist (Screens Design > Branding) - both the accept attribute and the backend validation. Straight passthrough to R2, no image processing in the path, so nothing else needed changing - verified end-to-end with a real AVIF file rendering correctly on the live dashboard.',
 'released', 'v1.10.0', '2026-08-01T06:46:38.000Z', '2026-08-01T06:46:38.000Z'),
('852588c0aa453986a180c0efbf2b8fa383c4743c', 'Logo image sizing + relocate "Last updated" timestamp',
 'The Small/Medium/Large/Extra Large size control (Screens Design > Branding) previously only affected the text-name display - a logo image always rendered at a fixed size regardless of this setting. Now reuses the same control/value for both. Also moved the "Last updated HH:MM" timestamp out from under the logo/name, where it competed for the same vertical space, to sit under the header clock instead - freeing room for a larger logo.',
 'released', 'v1.11.0', '2026-08-01T07:48:44.000Z', '2026-08-01T07:48:44.000Z'),
('2ec462b65550ee68b4b3ca1e65ecadd0c1f05258', 'Real backend persistence for saved colour templates',
 '"Save as template" (Screens Design > Backgrounds > Custom) previously only wrote to the browser''s localStorage - a saved template was invisible outside the one browser it was saved in. Added a real per-tenant design_templates table and owner-gated CRUD endpoints; saving still never applies live, only an explicit "Apply to live screen" does. A one-time prompt offers to import any templates still sitting in a browser''s old localStorage, with each one renameable before confirming.',
 'released', 'v1.12.0', '2026-08-01T11:16:52.000Z', '2026-08-01T11:16:52.000Z');
