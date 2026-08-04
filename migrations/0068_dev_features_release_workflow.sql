-- Consolidates the old /platform/updates draft->reviewed->released
-- workflow onto dev_features (investigation round approved this shape).
-- platform_updates stops being a place rows are ever created directly -
-- going forward its only writer is release.ts, at the moment of an
-- actual release, INSERTing one new row per dev_features entry being
-- released (see that file's own comment for the full new shape).
--
-- eligible_for_release: the tick box - developer-settable any time
-- before completion, read once at the moment "Complete" is clicked to
-- decide whether the entry lands in the REVIEWED tab (awaiting release)
-- or the DEV LOG tab (done, private, never released).
ALTER TABLE dev_features ADD COLUMN eligible_for_release INTEGER NOT NULL DEFAULT 0;

-- Set only by release.ts, at the moment this entry is actually released
-- - points at the platform_updates row that release created for it.
-- Doubles as the REVIEWED-tab exit condition (an entry with this set has
-- shipped, so it no longer belongs in "awaiting release" regardless of
-- eligible_for_release/completed_at) and as the hook for a future
-- "Released as vX.Y.Z" display, without a JOIN-only derivation.
ALTER TABLE dev_features ADD COLUMN released_update_id TEXT NULL REFERENCES platform_updates(id);

-- The old status column (idea/planned/built/parked) is retired from
-- driving any workflow logic as of this round - completed_at (already
-- existed) plus the two columns above fully replace what 'built' used
-- to mean, and idea/planned/parked have no equivalent in the new
-- ALL/REVIEWED/DEV LOG model at all (investigation's own flagged
-- question - confirmed dropped, no replacement). Left in place rather
-- than DROP COLUMN - SQLite implements that as a full table rebuild,
-- unnecessary risk for a column nothing will read or write from this
-- point on. Existing values are simply dead data now.
