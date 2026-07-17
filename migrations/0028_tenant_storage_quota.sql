-- Per-tenant media storage quota, replacing the hardcoded 100MB cap in
-- functions/api/_utils/mediaQuota.ts. Additive only - defaults to
-- exactly the value that constant already enforced, so nothing changes
-- for Shobdon or Demo until their quota is deliberately raised (see
-- that file's own comment for the documented query to do so).
ALTER TABLE tenants ADD COLUMN storage_quota_bytes INTEGER NOT NULL DEFAULT 104857600;
