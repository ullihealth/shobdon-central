-- Per-tenant configurability for the standalone QR/phone-mockup rotation
-- slide (RightInfoPanel.tsx) - Step 1 of the rollout scoped in this
-- session's investigation. This slide's content (target URL, phone
-- mockup image, caption) is currently a hardcoded Shobdon-only constant
-- (PILOT_APP_URL) gated by a stopgap tenantSlug === 'shobdon' check
-- (commit acef934, itself a fix for a live cross-tenant content leak -
-- the slide was rendering on every tenant before that). This migration
-- only adds the schema/backend fields; RightInfoPanel.tsx's own
-- rendering/gating logic is deliberately untouched in this step (see
-- that stopgap comment - it stays load-bearing until a later step reads
-- these new columns instead).
--
-- qr_slide_enabled - standalone boolean, DEFAULT 0. Deliberately not
-- bundled with any other concept (e.g. a future countdown/expiry field
-- can sit alongside it later without restructuring this one) - same
-- "one flag, one meaning" posture as carousel_budget_enabled/
-- mobile_enabled elsewhere on this table.
ALTER TABLE tenants ADD COLUMN qr_slide_enabled INTEGER NOT NULL DEFAULT 0;

-- qr_target_url / qr_caption_text - free text, DEFAULT '', no format
-- validation (same posture as afiso_frequency - migration 0070's own
-- comment covers why validating a strict pattern risks rejecting a
-- real value more than it protects anything).
ALTER TABLE tenants ADD COLUMN qr_target_url TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN qr_caption_text TEXT NOT NULL DEFAULT '';

-- qr_mockup_r2_key - nullable, no default, mirroring tenants.logo_r2_key
-- exactly (also nullable, no default) - NULL is the genuine "nothing
-- uploaded yet" state, distinct from an empty string.
ALTER TABLE tenants ADD COLUMN qr_mockup_r2_key TEXT;

-- Shobdon backfill, same migration - re-enables and backfills Shobdon's
-- real values in one step so Shobdon does not regress the moment a
-- later step switches RightInfoPanel.tsx over to reading these columns
-- instead of the hardcoded slug check. Deliberately NOT a blanket
-- backfill-everyone-true default - migration 0071/0072
-- (mobile_enabled) already tried exactly that ("backfill every existing
-- tenant to true for convenience") and reversed it one migration later
-- ("mobile access is opt-in per tenant... not something every tenant
-- starts with") - every other tenant stays at this column's own
-- DEFAULT 0/'' until a developer explicitly configures and enables it
-- via the Platform Tenants dev UI (a later step, not this one).
-- qr_target_url pulled directly from RightInfoPanel.tsx's existing
-- PILOT_APP_URL constant, not re-guessed.
UPDATE tenants
SET qr_slide_enabled = 1,
    qr_target_url = 'https://shobdon.airfieldcentral.com/pilot',
    qr_caption_text = 'SCAN FOR SHOBDON PILOT APP'
WHERE slug = 'shobdon';
