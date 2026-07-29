-- One-time historical backfill so Developer Updates isn't empty on
-- first use. Sourced from two places, not invented:
--
-- v1.0.0 (six entries below) - condensed from
-- "MD FILES/Shobdon-Central-Engineering-Changelog.md", which covers
-- everything through commit 66594c0 (2026-07-27T22:18:36Z UTC, "Enable
-- automatic Worker deploy on push to main" - the doc's own last dated
-- entry). Bundled as one version since the doc itself groups many
-- distinct commits under a handful of thematic headings, not a strict
-- one-entry-per-commit log - this migration keeps that same grouping
-- rather than inventing finer-grained history the doc doesn't actually
-- assert.
--
-- v1.1.0-v1.5.0 - one entry per commit actually merged to main after
-- that point (git log main, real commit subjects/timestamps, not
-- summarized/grouped - "tonight's individual fixes as later versions"
-- per instruction).
--
-- The Gas Prices feature and the three preview-deployment infra fixes
-- are deliberately NOT included here as 'released' - they're real,
-- built, and verified, but still sitting on feature/gas-prices awaiting
-- review, not actually merged/live on main. Marking them 'released'
-- would be recording history that hasn't happened yet. They're seeded
-- as 'reviewed' (done, verified, awaiting merge) with no version, which
-- is accurate as of this migration's own authoring - added instead via
-- this feature's own API once it exists, not hardcoded into a
-- deployed-on-main migration file that predates them.
INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at) VALUES
('upd_00_dashboard_series', 'Responsive dashboard series: viewport-scaling bug fixes',
 'Five-commit series fixing content-driven auto-height clipping/collapse in LeftInfoPanel/RightInfoPanel, compass sizing tied to viewport height instead of its own flex cell, a CSS grid gap/overflow bug, Cloud Base chart aspect-ratio mismatches (fixed via ResizeObserver), and Weather Summary label/timezone fixes. Verified across a standard resolution matrix plus stress tests.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),
('upd_00_webcam_persist', 'Webcam carousel persistence + appearance editing',
 'Fixed the clubhouse webcam requiring Play every rotation by mounting all carousel slots simultaneously (CSS visibility toggle, not destroy/recreate) - the iframe now survives rotation. Also enabled zoom/pan/rotate/brightness/banner editing for webcam slots, previously image/MP4 only.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),
('upd_00_pc2_setup', 'PC2 self-serve setup + CAPTURE_KEY security fix',
 'Added a self-serve PC2/Weather Capture Setup section to /config (script download, auto-start installer, printable PDF), replacing manual live walkthroughs. Fixed a security gap where CAPTURE_KEY was exposed in plain copy-pasteable URLs - capture-log/refresh controls now route through authenticated server-side proxies.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),
('upd_00_weather_ingest', 'Multi-tenant weather ingestion + API keys',
 'Built the ''ingested'' weather provider plus a public read endpoint - previously no provider wrote to D1 at all. Backfilled missing tenant lat/lon. Added per-tenant storage quota tracking, a tenant pause/resume toggle (reusing the active column), and the first version of /platform/tenants.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),
('upd_00_workers_migration', 'Pages to Workers migration (code complete, cutover paused)',
 'Full functions/api/ tree compiled cleanly into a Workers-compatible script (airfield-central), bound to the same D1/R2/KV resources. Caught the missing single-page-application fallback setting before it caused 404s. Full regression sweep passed on a preview URL; domain cutover itself paused.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),
('upd_00_onboarding_ci', 'Onboarding UI polish, wildcard-Worker precedence fix, and Worker-deploy CI',
 'Polished onboarding UI (larger text, confirm-password field, full-width terms page). Discovered and fixed the root cause of stale content on all four tenant subdomains: a wildcard Workers Route intercepts every subdomain including Shobdon''s, and the standalone Worker hadn''t been redeployed - fixed by redeploying directly, then added and enabled a GitHub Actions workflow to auto-deploy the Worker on every push to main.',
 'released', '1.0.0', '2026-07-27T22:18:36.000Z', '2026-07-27T22:18:36.000Z'),

('upd_11_runway_card', 'Combine Ops Panel''s Runway Status and Circuit Direction into one card',
 'Merged two separate Ops Panel cards into one "Runway In Use" card per ATC feedback, showing both values side by side - still two independent fields under the hood.',
 'released', '1.1.0', '2026-07-28T09:16:30.000Z', '2026-07-28T09:16:30.000Z'),
('upd_12_notam_feed', 'Add automated NOTAM feed and per-tenant airfield location settings',
 'First pass at an automated NOTAM feed plus the per-tenant lat/lon/ICAO settings needed to geographically filter it.',
 'released', '1.2.0', '2026-07-28T11:27:25.000Z', '2026-07-28T11:27:25.000Z'),
('upd_13_notaminfo', 'Wire NOTAMinfo as the active NOTAM provider, with geographic filtering',
 'Replaced the untested FAA API adapter with a real, working NOTAMinfo RSS feed, filtered by Q-line geography so only relevant NOTAMs surface per tenant.',
 'released', '1.3.0', '2026-07-28T13:55:54.000Z', '2026-07-28T13:55:54.000Z'),
('upd_14_cameras_model', 'Add tenant cameras: RTSP/relay/YouTube-push data model, platform admin UI, viewer panel',
 'New site_relays + cameras tables, platform admin CRUD, relay-polling API authenticated via tenant API keys, and a viewer-facing CameraPanel component - the RTSP/local-relay/YouTube-push architecture.',
 'released', '1.4.0', '2026-07-28T17:19:15.000Z', '2026-07-28T17:19:15.000Z'),
('upd_15_cameras_wired', 'Wire the new cameras table into the existing Webcams dropdown and carousel renderer',
 'Any camera in the new cameras table now appears in the Webcams dropdown alongside the legacy camera_slots entries, and renders in a carousel slot the same way - both dashboard and cafe carousels, both admin editors.',
 'released', '1.5.0', '2026-07-28T17:50:01.000Z', '2026-07-28T17:50:01.000Z'),

('upd_rv_gas_prices', 'Add dedicated Gas Prices system, separate from Safety Notices/NOTAMs',
 'New gas_prices table (3 fixed slots + shared currency), a Dashboard Manager container, a compact tile row above a now-shrinkable Ops Panel, and an additive "Include Gas Prices" toggle in the cafe ticker. Also fixed a pre-existing bug where a ticker slot''s chosen notice was silently dropped before reaching the live dashboard.',
 'reviewed', NULL, '2026-07-29T00:00:00.000Z', NULL),
('upd_rv_preview_infra', 'Enable Cloudflare Pages preview deployments with isolated data',
 'Fixed sign-in on every preview deployment (auth host allowlist had no wildcard for Pages'' per-branch preview subdomains) and gave preview its own dedicated D1 database via wrangler.toml''s [env.preview], instead of silently falling back to production''s real data.',
 'reviewed', NULL, '2026-07-29T00:00:00.000Z', NULL),
('upd_rv_preview_links', 'Make preview-vs-production dashboard links environment-aware',
 'Dashboard Manager''s Main Dashboard open icon and Your Displays'' Copy/Open URLs hardcoded a jump to the production subdomain regardless of which environment was being viewed - now derived from the current origin, so preview links stay on preview.',
 'reviewed', NULL, '2026-07-29T00:00:00.000Z', NULL);
