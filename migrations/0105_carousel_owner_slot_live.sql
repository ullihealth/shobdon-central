-- Reserved AirfieldCentral Slots "when does a reserved slot play" round.
-- Today a reserved slot (5/8/12, carousel_budget_enabled tenants only)
-- is ALWAYS in the live rotation for 10s regardless of whether real
-- content has been assigned - an empty one shows the "Media Reserved"
-- placeholder for the full 10s instead of being skippable, and a slot
-- whose ownerContentAssigned flag is stale (the assigned file was since
-- deleted, mediaLibraryId no longer resolves) renders as a genuinely
-- blank frame instead. On Shobdon, with all three slots in one of
-- those two states, that's 30s of dead air inside a 60s loop.
--
-- ownerSlotLive is a new, independently-set per-slot flag (platform
-- admin only, via carousel-owner-slots.ts) that decides whether this
-- specific reserved slot is ELIGIBLE to appear in the live rotation at
-- all - but publicConfig.ts and tenant/carousel/index.ts never trust
-- this column (or ownerContentAssigned) alone: a slot only actually
-- plays when Live is on AND it is not Unlocked AND its mediaLibraryId
-- still resolves to a real, existing media_library row right now.
-- Anything else is skipped entirely - no placeholder, no blank frame,
-- 0 seconds.
--
-- DEFAULT 0 both backfills every existing row (including slots 1-4/
-- 6-7/9-11/13+, where it's simply inert) and sets the default for any
-- brand-new carousel_slots row going forward, per the confirmed
-- decision that a new reserved slot starts Live = OFF.
ALTER TABLE carousel_slots ADD COLUMN ownerSlotLive INTEGER NOT NULL DEFAULT 0;

-- Live = ON only where the EXISTING assignment genuinely still resolves
-- to a real file right now (confirmed via a read-only SELECT against
-- production before this migration ran: zero rows anywhere currently
-- meet this - every ownerContentAssigned = 1 row has either a NULL
-- mediaLibraryId or one that no longer exists in media_library). Written
-- generically (not hardcoded to "touches nothing") so this migration
-- stays correct if that ever changes before it's actually applied.
UPDATE carousel_slots
SET ownerSlotLive = 1
WHERE slotNumber IN (5, 8, 12)
  AND ownerContentAssigned = 1
  AND mediaLibraryId IS NOT NULL
  AND mediaLibraryId IN (SELECT id FROM media_library);

-- Stale-assignment cleanup: a reserved slot that CLAIMS content
-- (ownerContentAssigned = 1) but has no file that actually still
-- exists (mediaLibraryId NULL, or pointing at a since-deleted
-- media_library row) gets that claim cleared, so the admin page's own
-- "content assigned" state tells the truth instead of silently
-- disagreeing with what Live/resolution actually says. Confirmed via a
-- read-only SELECT before this migration ran: exactly two rows match
-- production-wide (org_shobdon slot 12, org_megs-cafe-media slot 8) -
-- see the migration report for the full before-state.
UPDATE carousel_slots
SET ownerContentAssigned = 0
WHERE slotNumber IN (5, 8, 12)
  AND ownerContentAssigned = 1
  AND (mediaLibraryId IS NULL OR mediaLibraryId NOT IN (SELECT id FROM media_library));
