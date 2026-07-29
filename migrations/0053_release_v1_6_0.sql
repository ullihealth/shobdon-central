-- Mirrors the real release action already performed against the live
-- shared preview D1 via the actual Developer Updates UI/API (not a
-- migration-authored fiction) - the 3 entries seeded 'reviewed' by
-- 0051, plus two new draft-through-released entries created the same
-- way (for the Developer Updates page itself, and for this same gas-
-- prices-seed/preview-banner work), all reviewed and released together
-- as v1.6.0. Timestamps and ids below are copied verbatim from that
-- real release, not fabricated, so production's history matches what
-- actually happened rather than restating it with a fresh, different
-- released_at.
UPDATE platform_updates
SET status = 'released', version = 'v1.6.0', released_at = '2026-07-29T14:05:12.632Z'
WHERE id IN ('upd_rv_gas_prices', 'upd_rv_preview_infra', 'upd_rv_preview_links');

INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at) VALUES
('b8300800-3541-464c-9717-44c4f84768cc', 'Add Developer Updates page — internal release changelog',
 'New Platform Admin page recording shipped/pending changes: draft entries with title + description, a review step, and grouping reviewed entries under a version number to mark released. Internal only for now — no tenant-facing "what''s new" surface yet, that''s a separate future task.',
 'released', 'v1.6.0', '2026-07-29T13:53:56.965Z', '2026-07-29T14:05:12.632Z'),
('b63a8b7f-0d16-4371-84a3-f4b599682756', 'Seed real Shobdon gas prices and add an unmissable preview banner',
 'Replaced placeholder test gas prices with Shobdon''s real values (Avgas £2.24, UL91 £2.60, Jet A1 £1.55) via migration, so they''re correct the moment this goes live. Also added an amber "PREVIEW — not the live site" banner (naming the actual hostname) and a "[PREVIEW]" browser-tab title prefix on any non-production deployment, so a preview can never be mistaken for the real site again.',
 'released', 'v1.6.0', '2026-07-29T13:54:25.065Z', '2026-07-29T14:05:12.632Z')
ON CONFLICT(id) DO NOTHING;
