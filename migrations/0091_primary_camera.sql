-- Pilot camera view round - a tenant needs a real, explicit "which
-- camera is the pilot-facing one" concept, distinct from and not
-- inferred from either camera table's own contents. Two nullable
-- columns, exactly one set (or both NULL for "none chosen yet") -
-- mirrors carousel_slots' own existing cameraSlotNumber/cameraId pair
-- exactly (see CarouselSlotEditor.tsx's CameraOption interface, whose
-- own comment already documents "exactly one of these two is set" for
-- this identical two-mechanism problem), so this reuses an established
-- pattern in this codebase rather than inventing a new one.
--
-- primary_camera_slot_number resolves against camera_slots via
-- (tenants.organization_id = camera_slots.organizationId AND
-- camera_slots.slotNumber = tenants.primary_camera_slot_number) - the
-- same join shape already used everywhere else camera_slots is read
-- (publicConfig.ts). primary_camera_id is a real FK to cameras(id),
-- ON DELETE SET NULL - deleting a camera via /platform/cameras must
-- never leave a dangling primary reference; it silently reverts to
-- "none chosen" instead, same fail-safe posture as parent_tenant_id's
-- own ON DELETE SET NULL (migration 0059).
ALTER TABLE tenants ADD COLUMN primary_camera_slot_number INTEGER;
ALTER TABLE tenants ADD COLUMN primary_camera_id TEXT REFERENCES cameras(id) ON DELETE SET NULL;

-- Backfill: every tenant today has at most one REAL camera across both
-- mechanisms combined (confirmed via production inspection before
-- writing this) - for any tenant where that's true, auto-mark it
-- primary rather than leaving a real, useful default unset. A tenant
-- with zero or 2+ candidates is left NULL (needs an explicit admin
-- choice via the new picker UI) - never guessed.
--
-- camera_slots url != '' filters out the empty-string placeholder rows
-- every tenant's template seeds (e.g. Shobdon's own "Runway camera"/
-- "Clubhouse camera" slots 2/3) - those aren't real cameras, just
-- unconfigured slots, and must not count as a second candidate that
-- would otherwise block the backfill from choosing the real one.
UPDATE tenants
SET primary_camera_slot_number = (
  SELECT cs.slotNumber FROM camera_slots cs
  WHERE cs.organizationId = tenants.organization_id AND cs.url != ''
)
WHERE (
    SELECT COUNT(*) FROM camera_slots cs
    WHERE cs.organizationId = tenants.organization_id AND cs.url != ''
  ) = 1
  AND (SELECT COUNT(*) FROM cameras c WHERE c.tenant_id = tenants.id) = 0;

UPDATE tenants
SET primary_camera_id = (
  SELECT c.id FROM cameras c WHERE c.tenant_id = tenants.id
)
WHERE (SELECT COUNT(*) FROM cameras c WHERE c.tenant_id = tenants.id) = 1
  AND (
    SELECT COUNT(*) FROM camera_slots cs
    WHERE cs.organizationId = tenants.organization_id AND cs.url != ''
  ) = 0;
