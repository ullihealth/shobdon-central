// Platform-admin only: GET/POST /api/platform/dev-features - the private
// Developer Features workspace (migration 0067), now also the sole
// entry-creation path for the whole Updates workflow (dev-features/
// Updates consolidation round - functions/api/platform/updates/index.ts's
// own POST is gone; this is the only place a new entry, tenant-mirrored
// or developer-authored, ever originates). Mirrors every /features
// (feature_requests) entry read-through, PLUS developer-private entries
// with no public origin at all (linked_feature_request_id NULL).
//
// GET auto-materializes: any feature_requests row with no matching
// dev_features row yet gets one created on the fly (no folder/notes,
// title/description left NULL so they stay read-through - see migration
// 0067's own comment) before the merged list is returned. The
// materialized row's created_at is backdated to the ORIGINAL
// feature_requests.created_at (not "whenever the developer's browser
// first loaded this page") so "sortable by date" reflects genuine
// submission chronology.
//
// The old idea/planned/built/parked status column (migration 0067) is
// retired from this round on - eligibleForRelease/completedAt/
// releasedUpdateId fully replace what it used to drive (see migration
// 0068's own comment); nothing here reads or writes it any more.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface OrphanFeatureRequestRow {
  id: string;
  createdAt: string;
}

interface DevFeatureRow {
  id: string;
  linkedFeatureRequestId: string | null;
  notes: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  eligibleForRelease: number;
  releasedUpdateId: string | null;
  releasedVersion: string | null;
  title: string | null;
  description: string | null;
  submittedByTenantName: string | null;
}

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

async function materializeMissingRows(db: D1Database): Promise<void> {
  const { results: orphans } = await db
    .prepare(
      `SELECT fr.id AS id, fr.created_at AS createdAt
       FROM feature_requests fr
       LEFT JOIN dev_features dv ON dv.linked_feature_request_id = fr.id
       WHERE dv.id IS NULL`
    )
    .all<OrphanFeatureRequestRow>();

  const now = new Date().toISOString();
  for (const orphan of orphans) {
    await db
      .prepare(
        `INSERT INTO dev_features (id, linked_feature_request_id, title, description, notes, folder_id, created_at, updated_at, completed_at, eligible_for_release, released_update_id)
         VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, 0, NULL)`
      )
      .bind(crypto.randomUUID(), orphan.id, orphan.createdAt, now)
      .run();
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  await materializeMissingRows(env.DB);

  // COALESCE(fr.title, dv.title): live read-through for linked entries
  // (fr.title always wins when a join match exists), falls back to the
  // row's own title/description only for private entries (no join
  // match, fr.title is NULL).
  const { results } = await env.DB
    .prepare(
      `SELECT dv.id AS id, dv.linked_feature_request_id AS linkedFeatureRequestId,
              dv.notes AS notes, dv.folder_id AS folderId, dv.created_at AS createdAt, dv.updated_at AS updatedAt,
              dv.completed_at AS completedAt, dv.eligible_for_release AS eligibleForRelease, dv.released_update_id AS releasedUpdateId,
              pu.version AS releasedVersion,
              COALESCE(fr.title, dv.title) AS title, COALESCE(fr.description, dv.description) AS description,
              t.name AS submittedByTenantName
       FROM dev_features dv
       LEFT JOIN feature_requests fr ON fr.id = dv.linked_feature_request_id
       LEFT JOIN tenants t ON t.organization_id = fr.submitted_by_org_id
       LEFT JOIN platform_updates pu ON pu.id = dv.released_update_id
       ORDER BY dv.created_at DESC`
    )
    .all<DevFeatureRow>();

  return jsonResponse({ entries: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { title?: unknown; description?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!title || title.length > TITLE_MAX_LENGTH) return jsonResponse({ error: `title is required (max ${TITLE_MAX_LENGTH} chars)` }, 400);
  if (!description || description.length > DESCRIPTION_MAX_LENGTH) {
    return jsonResponse({ error: `description is required (max ${DESCRIPTION_MAX_LENGTH} chars)` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO dev_features (id, linked_feature_request_id, title, description, notes, folder_id, created_at, updated_at, completed_at, eligible_for_release, released_update_id)
       VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, NULL, 0, NULL)`
    )
    .bind(id, title, description, now, now)
    .run();

  return jsonResponse({ id, title, description, createdAt: now });
};
