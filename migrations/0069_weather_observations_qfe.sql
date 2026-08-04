-- QFE (pressure referenced to airfield elevation, not sea level) has been
-- captured and parsed by worker/src/index.ts's parseQfe() since that
-- Worker was first built (real field id 'QFE', confirmed live), but was
-- silently dropped at the KV->D1 forwarding step (forwardToIngest())
-- rather than never having existed - see this round's own investigation.
-- Nullable, no DEFAULT beyond SQLite's own implicit NULL - every row
-- captured before this round's Worker deploy genuinely has no QFE value
-- to backfill, same "existing rows predate this column" posture
-- migration 0029's source_type column already used for the same table.
ALTER TABLE weather_observations ADD COLUMN qfe_hpa REAL;
