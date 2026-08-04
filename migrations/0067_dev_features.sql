-- Developer Features page (/platform/dev-features) - a private,
-- developer-only workspace that mirrors every /features (feature_requests)
-- entry read-through, plus lets the developer add entries with no public
-- origin at all. Investigation round approved this shape; see that
-- report for the full reasoning behind each design choice referenced
-- below.
--
-- dev_feature_folders: simple flat folder list - one-to-one membership
-- (dev_features.folder_id below), not many-to-many. This is a single
-- developer's own organizational tool, not a shared multi-user tagging
-- system, so "each entry lives in at most one folder" is the direct
-- match for "create folders, tick to assign" - a junction table would
-- add real complexity (multi-select UI, ambiguous sort-order semantics)
-- for a need that was never asked for.
CREATE TABLE IF NOT EXISTS dev_feature_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- linked_feature_request_id NULL = developer-private entry (title/
-- description stored directly on THIS row). NOT NULL = a live
-- read-through mirror of a feature_requests row - title/description are
-- deliberately NULL-able and left unset for linked rows; the API layer
-- joins against feature_requests for those two fields at read time
-- rather than snapshotting them here, so a tenant's original submission
-- (if it's ever made editable - it isn't, today) is always reflected
-- live, with no separate sync step that could drift.
--
-- status is this table's OWN lifecycle - independent of, and never
-- written by, feature_requests.status (the public-facing one). The only
-- write in the other direction is the one-way release.ts write-back
-- described below, and that targets feature_requests directly, never
-- this column.
--
-- completed_at: set once, the first time status transitions to 'built' -
-- not required for the dedupe guard (functions/api/platform/dev-features/
-- [id].ts's own PATCH handler compares current vs. next status directly,
-- no extra column needed for that), but kept as a plain audit/sort field
-- for "when did this actually finish."
CREATE TABLE IF NOT EXISTS dev_features (
  id TEXT PRIMARY KEY,
  linked_feature_request_id TEXT NULL REFERENCES feature_requests(id),
  title TEXT NULL,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'idea', -- 'idea' | 'planned' | 'built' | 'parked'
  notes TEXT NULL,
  folder_id TEXT NULL REFERENCES dev_feature_folders(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_features_folder ON dev_features(folder_id);
CREATE INDEX IF NOT EXISTS idx_dev_features_linked ON dev_features(linked_feature_request_id);

-- Traces a platform_updates draft back to the dev_features entry whose
-- completion created it (functions/api/platform/dev-features/[id].ts's
-- PATCH handler INSERTs the draft with this set; NULL for every
-- manually-created draft, exactly as today). release.ts's own write-back
-- to feature_requests.status follows this column one hop, then
-- dev_features.linked_feature_request_id a second hop - two single-hop
-- FKs, not a third denormalized shortcut column, so the full provenance
-- chain (which public submission, if any, a given release note actually
-- came from) stays reconstructable rather than flattened away.
ALTER TABLE platform_updates ADD COLUMN source_dev_feature_id TEXT NULL REFERENCES dev_features(id);
