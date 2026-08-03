-- Reserved Owner Slots & Time Budget (investigation approved this
-- round). Two new per-tenant fields on tenants (same "extend the
-- tenants row directly" pattern storage_quota_bytes, migration 0028,
-- already established - not a new per-tenant settings table, there's
-- no need for one for two scalar values), plus two new per-slot fields
-- on carousel_slots.
--
-- carousel_budget_seconds: the shared time budget (seconds) the 9
-- tenant-controlled slots divide between them - default 150 (2:30).
-- carousel_budget_enabled: the per-tenant feature toggle itself - this
-- round ships a manual admin-only flip (via /platform/tenants), no
-- Stripe/payment wiring - defaults true (1) for future/new tenants per
-- the confirmed decision; existing tenants (Shobdon) need this manually
-- set to 0 via that same toggle after this migration deploys - a
-- deliberate one-time manual action, not hardcoded here, since the
-- toggle UI built this round is the intended mechanism for exactly
-- this, not a one-off migration UPDATE.
ALTER TABLE tenants ADD COLUMN carousel_budget_seconds INTEGER NOT NULL DEFAULT 150;
ALTER TABLE tenants ADD COLUMN carousel_budget_enabled INTEGER NOT NULL DEFAULT 1;

-- Meaningful only for slotNumber 5/8/12, only while the owning tenant's
-- carousel_budget_enabled is true. ownerSlotUnlocked: the manual
-- per-slot escape hatch - true reverts that one specific slot to normal
-- tenant control (a future Stripe-driven lease would eventually flip
-- this automatically; for now it's owner-flipped only, via the new
-- /platform/tenants/:id/carousel-owner-slots route). Defaults 0 (false) -
-- a slot is reserved/owner-controlled the moment the feature is
-- enabled, not opt-in per slot.
--
-- ownerContentAssigned: NOT the same thing as "does this row have a
-- mediaLibraryId" - a tenant who already had real content in what
-- becomes slot 5 keeps that row's mediaType/mediaLibraryId completely
-- untouched when the feature flips on (confirmed decision: silent
-- shadow, no forced migration, no data deletion), which means the raw
-- row alone can't distinguish "the owner's real ad content" from "this
-- tenant's own pre-existing upload, now shadowed" - both would have a
-- perfectly valid mediaLibraryId. Without this column, a tenant's own
-- (private) pre-existing slide would be misread as owner-assigned
-- content and shown to that tenant as if it were a real ad. This is
-- ONLY ever set by the new platform-admin carousel-owner-slots route,
-- never by the tenant's own carousel PUT (which is blocked from writing
-- to a reserved slot at all) - so its value is trustworthy as "did the
-- owner actually put something here."
ALTER TABLE carousel_slots ADD COLUMN ownerSlotUnlocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE carousel_slots ADD COLUMN ownerContentAssigned INTEGER NOT NULL DEFAULT 0;
