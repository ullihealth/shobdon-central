// Platform-admin only: POST /api/platform/updates/release - the
// "select a batch of REVIEWED dev-features entries and assign them one
// version number" action, relocated here from operating on
// platform_updates rows directly (dev-features/Updates consolidation
// round). platform_updates has no draft state of its own any more - a
// row in that table is now created for the FIRST time by this endpoint,
// at the moment of an actual release, one row per dev_features entry
// being released, not an UPDATE of a pre-existing draft row.
//
// Eligible = the same three-column check REVIEWED-tab membership itself
// uses (functions/api/platform/dev-features/index.ts's own GET) -
// completedAt set, eligibleForRelease true, releasedUpdateId still NULL.
// Rejects the whole batch (no partial release) if any requested id
// isn't currently eligible, same "never leave the caller unsure which
// entries actually ended up in the version they asked for" reasoning
// the old version of this endpoint already used.
//
// feature_requests write-back is now a direct, single-hop read off the
// SAME rows already being processed (dev_features.linked_feature_request_id)
// - no more indirection through platform_updates.source_dev_feature_id,
// since that column is only ever written by THIS request, not read back
// by it. A dev-features entry with no linked_feature_request_id (a
// developer-private entry) just skips the write-back entirely - no
// error, no special-casing beyond the NULL check itself.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  // Fine-grained GitHub personal access token, scoped to THIS repo only
  // (ullihealth/shobdon-central) with "Actions: Read and write"
  // permission and nothing else - narrowest credential that can
  // actually trigger a workflow_dispatch run, per GitHub's own REST API
  // requirements for that endpoint. Set via `wrangler secret put
  // GITHUB_DEPLOY_TOKEN --config wrangler.worker.toml` - deliberately
  // the WORKER's own secret store, not Pages': real requests to this
  // route go through the airfield-central Worker in production
  // (confirmed directly - shobdon.airfieldcentral.com's DNS/response
  // headers don't match the shobdon-central Pages project at all, only
  // the Worker; see TECH_DEBT.md's own retirement-tracking note), so a
  // secret set on the Pages project would never actually be read by the
  // code path that's live for a real platform admin's release action.
  // Optional - see triggerPilotRedeploy's own comment for why an unset
  // value degrades gracefully rather than failing the release.
  GITHUB_DEPLOY_TOKEN?: string;
}

const GITHUB_OWNER = "ullihealth";
const GITHUB_REPO = "shobdon-central";
const GITHUB_WORKFLOW_FILE = "deploy-worker.yml";
const GITHUB_DISPATCH_REF = "main";

// The whole point of this round: the /pilot version stamp is now baked
// into the shipped bundle at build time (see scripts/generate-pilot-
// version.mjs), not live API data - so the ONLY way a new release's
// version ever actually reaches a pilot's phone is a fresh deploy of
// the airfield-central Worker (the actual production target for
// shobdon.airfieldcentral.com/pilot - NOT the shobdon-central Pages
// project, confirmed the hard way after an earlier version of this
// function targeted that wrong project's own Deploy Hook mechanism,
// which would have silently rebuilt a project real traffic never
// touches). This function is what makes that automatic instead of
// relying on someone remembering to push an unrelated commit after
// every release. deploy-worker.yml (.github/workflows/) is the
// existing, already-working pipeline for that Worker - already/
// deliberately kept trigger-able via workflow_dispatch (see that
// file's own comment) alongside its push-to-main trigger, specifically
// so a redeploy can be fired by hand or programmatically without an
// empty commit. This function calls that exact same dispatch, just
// from GitHub's REST API instead of the Actions UI. The redeploy itself
// carries no feature changes - its only job is to re-run
// generate-pilot-version.mjs against the version this same request
// just wrote, then ship that.
//
// Deliberately never allowed to fail the release itself: the D1 writes
// above are the actual source of truth (what /versions and /platform/
// dev-features show), already committed by the time this runs - a
// down GitHub API, an expired token, or a missing secret should
// surface as a softer signal to the admin (the `deployTriggered` field
// on the response), not an error that makes it look like the release
// itself failed when it didn't.
async function triggerPilotRedeploy(env: Env): Promise<boolean> {
  if (!env.GITHUB_DEPLOY_TOKEN) return false;
  try {
    // 204 No Content on success - GitHub's own documented response for
    // this endpoint, nothing to parse. GitHub's REST API rejects
    // requests with no User-Agent at all (not just a Cloudflare-
    // default one) - set explicitly rather than relying on whatever
    // fetch() supplies by default in this runtime.
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_DEPLOY_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "shobdon-central-release-endpoint",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: GITHUB_DISPATCH_REF }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

interface DevFeatureRow {
  id: string;
  linkedFeatureRequestId: string | null;
  title: string | null;
  description: string | null;
  completedAt: string | null;
  eligibleForRelease: number;
  releasedUpdateId: string | null;
}

interface LinkedFeatureRequestRow {
  id: string;
  title: string;
  description: string;
}

const VERSION_MAX_LENGTH = 40;
const MAX_IDS_PER_RELEASE = 100;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { ids?: unknown; version?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  const version = typeof body.version === "string" ? body.version.trim() : "";

  if (ids.length === 0 || ids.length > MAX_IDS_PER_RELEASE) {
    return jsonResponse({ error: `ids must be a non-empty array of at most ${MAX_IDS_PER_RELEASE} entries` }, 400);
  }
  if (!version || version.length > VERSION_MAX_LENGTH) {
    return jsonResponse({ error: `version is required (max ${VERSION_MAX_LENGTH} chars)` }, 400);
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.DB
    .prepare(
      `SELECT id, linked_feature_request_id AS linkedFeatureRequestId, title, description,
              completed_at AS completedAt, eligible_for_release AS eligibleForRelease, released_update_id AS releasedUpdateId
       FROM dev_features WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .all<DevFeatureRow>();

  const foundById = new Map(rows.results.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !foundById.has(id));
  if (missing.length > 0) {
    return jsonResponse({ error: `Unknown id(s): ${missing.join(", ")}` }, 400);
  }
  const notEligible = ids.filter((id) => {
    const row = foundById.get(id)!;
    return row.completedAt === null || !row.eligibleForRelease || row.releasedUpdateId !== null;
  });
  if (notEligible.length > 0) {
    return jsonResponse({ error: `Only completed, eligible, not-yet-released entries can be released - not currently eligible: ${notEligible.join(", ")}` }, 400);
  }

  // Live read-through for linked entries' title/description, same
  // COALESCE-at-read-time posture as dev-features' own GET - batch
  // query rather than one lookup per id.
  const linkedIds = ids.map((id) => foundById.get(id)!.linkedFeatureRequestId).filter((id): id is string => id !== null);
  const linkedById = new Map<string, LinkedFeatureRequestRow>();
  if (linkedIds.length > 0) {
    const linkedPlaceholders = linkedIds.map(() => "?").join(", ");
    const { results: linkedRows } = await env.DB
      .prepare(`SELECT id, title, description FROM feature_requests WHERE id IN (${linkedPlaceholders})`)
      .bind(...linkedIds)
      .all<LinkedFeatureRequestRow>();
    for (const row of linkedRows) linkedById.set(row.id, row);
  }

  const now = new Date().toISOString();
  for (const id of ids) {
    const devFeature = foundById.get(id)!;
    const linked = devFeature.linkedFeatureRequestId ? linkedById.get(devFeature.linkedFeatureRequestId) : undefined;
    const title = linked?.title ?? devFeature.title ?? "";
    const description = linked?.description ?? devFeature.description ?? "";

    const updateId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at, source_dev_feature_id)
         VALUES (?, ?, ?, 'released', ?, ?, ?, ?)`
      )
      .bind(updateId, title, description, version, now, now, id)
      .run();

    await env.DB.prepare("UPDATE dev_features SET released_update_id = ? WHERE id = ?").bind(updateId, id).run();
  }

  const featureRequestIds = [...new Set(ids.map((id) => foundById.get(id)!.linkedFeatureRequestId).filter((id): id is string => id !== null))];
  if (featureRequestIds.length > 0) {
    const featurePlaceholders = featureRequestIds.map(() => "?").join(", ");
    await env.DB
      .prepare(`UPDATE feature_requests SET status = 'built', updated_at = ? WHERE id IN (${featurePlaceholders})`)
      .bind(now, ...featureRequestIds)
      .run();
  }

  const deployTriggered = await triggerPilotRedeploy(env);
  return jsonResponse({ ok: true, version, releasedAt: now, count: ids.length, deployTriggered });
};
