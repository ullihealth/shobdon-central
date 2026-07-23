// Platform-admin only: POST /api/platform/tenants/:id/hard-delete -
// genuine, permanent, irreversible deletion. A developer/testing tool
// for disposing of throwaway tenants created while testing "Onboard New
// Tenant" (e.g. tenant-wtl832hb) - NOT a customer-offboarding feature.
// Archive (migration 0044) is the correct action for a real customer
// leaving; this is for making a fake tenant's data actually stop
// existing, R2 objects included.
//
// Requires the tenant to already be archived (deleted_at IS NOT NULL) -
// hard-delete is a follow-up action on something already disposed of,
// never a direct alternative to Archive for a live tenant. Also
// requires the caller to type the tenant's exact current slug or name
// in the request body, checked HERE against the real current value -
// not trusted from a client-side button-enable check alone, since this
// is irreversible.
//
// Full FK-cascade investigation (this round): every organization(id)-
// referencing table (club_theme, media_library, member, camera_slots,
// carousel_slots, cafe_carousel_slots, cafe_template_settings,
// ops_panel_state, runway_groups, media_folders, invitation) already
// has ON DELETE CASCADE, confirmed enforced (D1 has PRAGMA foreign_keys
// = 1, verified empirically). Deleting `organization` handles all 11 of
// those for free. `member`'s own FK to user(id) ON DELETE CASCADE also
// means deleting an orphaned user cascades their account/session rows.
//
// tenants(id)-referencing tables have NO cascade (display_visits and
// subscription_history are the only exceptions, added this session with
// cascade from the start) - these 8 are deleted explicitly below, in
// one atomic env.DB.batch() alongside the organization and tenants
// deletes themselves. No schema migration to retrofit cascades onto
// them - rebuilding 5 tables for a rarely-used dev tool's benefit was
// judged disproportionate risk to production schema; explicit ordered
// deletes here are sufficient since this is the only delete path that
// will ever exist for this action.
//
// Order matters for one more reason found while testing this locally:
// tenants.organization_id ITSELF references organization(id), with no
// cascade - so the tenants row must be deleted BEFORE organization, not
// after (deleting organization first throws a real FK-constraint error,
// confirmed by hitting it). Every other organization(id) reference
// genuinely does cascade; this one column on `tenants` is the exception.
import { requirePlatformAdmin, jsonResponse, type D1Database, type D1BoundStatement } from "../../../_utils/tenantAuth";

interface R2Bucket {
  list: (options: { prefix: string; cursor?: string }) => Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete: (key: string) => Promise<void>;
}

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  // batch is optional on the shared D1Database type (other files pass a
  // narrower local type into helpers typed against it), but this file
  // genuinely needs it - narrowed to required here rather than loosening
  // the shared type back to always-required.
  DB: D1Database & { batch: (statements: D1BoundStatement[]) => Promise<unknown[]> };
  MEDIA: R2Bucket;
}

interface TenantRow {
  slug: string;
  name: string;
  organizationId: string | null;
  deletedAt: string | null;
}

// R2 objects are stored under organizationId-independent, slug-prefixed
// keys (media-library/upload.ts's "${slug}/library/..." and
// logoUpload.ts's "${tenantSlug}/branding/logo-..." - both confirmed by
// inspection, no other R2 write path exists anywhere in the codebase),
// so a single prefix sweep catches both regardless of which D1 rows
// still reference which key at the time this runs.
async function deleteAllObjectsWithPrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  for (;;) {
    const listing = await bucket.list({ prefix, cursor });
    for (const object of listing.objects) {
      await bucket.delete(object.key);
      deleted += 1;
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  return deleted;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  const confirm = typeof body?.confirm === "string" ? body.confirm.trim() : "";
  if (!confirm) return jsonResponse({ error: "Type the tenant's slug or name to confirm" }, 400);

  const tenant = await env.DB
    .prepare("SELECT slug, name, organization_id AS organizationId, deleted_at AS deletedAt FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  if (!tenant.deletedAt) {
    return jsonResponse({ error: "Tenant must be archived before it can be permanently deleted" }, 400);
  }
  if (confirm !== tenant.slug && confirm !== tenant.name) {
    return jsonResponse({ error: "Confirmation text does not match this tenant's slug or name" }, 400);
  }

  // Candidates for orphan cleanup below - captured BEFORE the batch
  // deletes `member` (via the organization cascade), since afterward
  // there'd be no row left to look this list up from.
  const memberCandidates = tenant.organizationId
    ? (
        await env.DB.prepare("SELECT userId FROM member WHERE organizationId = ?").bind(tenant.organizationId).all<{ userId: string }>()
      ).results
    : [];

  const statements = [
    env.DB.prepare("DELETE FROM tenant_displays WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM tenant_api_keys WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM tenant_invites WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM latest_conditions WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM operational_events WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM trial_signups WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM weather_observations WHERE tenant_id = ?").bind(tenantId),
    env.DB.prepare("DELETE FROM tenant_weather_shares WHERE source_tenant_id = ? OR target_tenant_id = ?").bind(tenantId, tenantId),
  ];
  // tenants row FIRST, then organization - tenants.organization_id
  // itself references organization(id) with no cascade (confirmed the
  // hard way, via a real FK-constraint failure while testing locally:
  // deleting organization while this tenant's own row still pointed at
  // it violated that FK). Every other reference to organization(id)
  // genuinely does cascade (club_theme, media_library, member,
  // camera_slots, carousel_slots, cafe_carousel_slots,
  // cafe_template_settings, ops_panel_state, runway_groups,
  // media_folders, invitation - see this file's own top comment), so
  // once the tenants row is gone, deleting organization is clean.
  statements.push(env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId));
  if (tenant.organizationId) {
    statements.push(env.DB.prepare("DELETE FROM organization WHERE id = ?").bind(tenant.organizationId));
  }

  await env.DB.batch(statements);

  // Orphaned-user cleanup - anyone who was a member of THIS org and,
  // now that it's gone, belongs to zero organizations anywhere. Never
  // the platform developer account (their real membership elsewhere,
  // if any, is irrelevant - developer status itself is a separate
  // column, not membership-derived, but excluding explicitly anyway as
  // a hard safety rule). Deleting the user cascades their account/
  // session rows (both ON DELETE CASCADE from user(id)), so this also
  // revokes their login entirely, not just their access to this tenant.
  let orphanedUsersDeleted = 0;
  for (const candidate of memberCandidates) {
    const stillMember = await env.DB
      .prepare("SELECT 1 FROM member WHERE userId = ? LIMIT 1")
      .bind(candidate.userId)
      .first();
    if (stillMember) continue;
    const userRow = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(candidate.userId).first<{ developer: number }>();
    if (!userRow || userRow.developer) continue;
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(candidate.userId).run();
    orphanedUsersDeleted += 1;
  }

  const r2ObjectsDeleted = await deleteAllObjectsWithPrefix(env.MEDIA, `${tenant.slug}/`);

  return jsonResponse({ ok: true, orphanedUsersDeleted, r2ObjectsDeleted });
};
