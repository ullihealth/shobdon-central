// Shared per-tenant media storage cap resolver, so the list endpoint
// (reporting usage), the upload endpoint, and the in-place-replace
// endpoint can never drift out of sync with each other or with the
// tenants row itself.
//
// Per-tenant now (migration 0028: tenants.storage_quota_bytes), not a
// single global constant - defaults to 100MB (the exact value this used
// to hardcode) for every tenant until deliberately raised. No admin UI
// for changing it yet - run directly against D1:
//
//   UPDATE tenants SET storage_quota_bytes = <bytes> WHERE slug = '<tenant-slug>';
//
// e.g. to raise Shobdon to 500MB:
//   UPDATE tenants SET storage_quota_bytes = 524288000 WHERE slug = 'shobdon';

import type { D1Database } from "./tenantAuth";

// Fallback only - used if a tenant row is somehow missing/unlinked from
// the calling organizationId, which shouldn't happen in practice (every
// real tenant has exactly one linked organization_id, migration
// 0024_link_tenants_to_organization.sql). Matches the value every
// tenant's actual column defaults to, so this fallback and the normal
// case agree by construction.
const DEFAULT_MEDIA_QUOTA_BYTES = 100 * 1024 * 1024; // 100MB

export async function resolveMediaQuotaBytes(db: D1Database, organizationId: string): Promise<number> {
  const row = await db
    .prepare("SELECT storage_quota_bytes AS storageQuotaBytes FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ storageQuotaBytes: number }>();
  return row?.storageQuotaBytes ?? DEFAULT_MEDIA_QUOTA_BYTES;
}
