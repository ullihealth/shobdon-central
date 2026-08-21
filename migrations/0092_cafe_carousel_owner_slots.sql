-- Café Reserved Owner Slots round. Mirrors migration 0064's
-- carousel_slots.ownerSlotUnlocked/ownerContentAssigned columns onto
-- cafe_carousel_slots (same names/types/defaults, deliberately) - the
-- café screen's carousel had no locking concept at all until now
-- (confirmed via investigation: migration 0064's mechanism was built
-- carousel_slots-only). Slots 5/8/12 are the reserved positions, same
-- fixed list as the dashboard's own RESERVED_SLOT_NUMBERS.
--
-- Deliberately NOT bringing over carousel_budget_enabled/
-- carousel_budget_seconds (the dashboard's Time Budget feature) - this
-- round is pure slot reservation only, no tenant-facing time-budget
-- concept for café. isReserved for café is therefore unconditional
-- (RESERVED_SLOT_NUMBERS + !ownerSlotUnlocked, no separate enable
-- toggle to check) - see functions/api/tenant/cafe-carousel/index.ts.
ALTER TABLE cafe_carousel_slots ADD COLUMN ownerSlotUnlocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cafe_carousel_slots ADD COLUMN ownerContentAssigned INTEGER NOT NULL DEFAULT 0;
