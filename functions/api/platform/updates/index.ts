// Platform-admin only: GET /api/platform/updates - the internal,
// app-wide "Developer Updates" running changelog (migration 0050),
// deliberately NOT tenant-facing (no tenant_id on the table at all, no
// tenant-scoped auth here). Same requirePlatformAdmin gating as every
// other /platform/* route.
//
// Dev-features/Updates consolidation round: this table no longer has a
// draft/reviewed state or a creation endpoint of its own - draft entries
// now live entirely on dev_features (functions/api/platform/dev-features/),
// and a row only ever gets written HERE by release.ts, at the moment of
// an actual release. onRequestPost (draft creation) and the sibling
// [id].ts PATCH (title/description edits, draft<->reviewed toggling)
// are both removed - there's nothing left in this table for either to
// act on. The WHERE status = 'released' below is a defensive leftover
// of the old shape, not load-bearing today, but costs nothing to keep
// as an explicit invariant this table's own contract.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { compareVersionsDesc } from "../../_utils/versionSort";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface UpdateRow {
  id: string;
  title: string;
  description: string;
  status: string;
  version: string;
  createdAt: string;
  releasedAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const rows = await env.DB
    .prepare(
      `SELECT id, title, description, status, version, created_at AS createdAt, released_at AS releasedAt
       FROM platform_updates
       WHERE status = 'released'`
    )
    .all<UpdateRow>();

  // Newest version first, newest-created first within a tied version -
  // see versionSort.ts's own comment for why this can't be a plain SQL
  // ORDER BY.
  const updates = [...rows.results].sort((a, b) => {
    const versionDiff = compareVersionsDesc(a.version, b.version);
    if (versionDiff !== 0) return versionDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return jsonResponse({ updates });
};
