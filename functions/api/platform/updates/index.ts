// Platform-admin only: GET/POST /api/platform/updates - the internal,
// app-wide "Developer Updates" running changelog (migration 0050),
// deliberately NOT tenant-facing (no tenant_id on the table at all, no
// tenant-scoped auth here). Same requirePlatformAdmin gating as every
// other /platform/* route.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

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
  version: string | null;
  createdAt: string;
  releasedAt: string | null;
}

const DESCRIPTION_MAX_LENGTH = 2000;
const TITLE_MAX_LENGTH = 200;

// version is free-text (whatever the developer types into the release
// form - see release.ts), so it can't be sorted correctly with a plain
// SQL string ORDER BY: 'v1.10.0' < 'v1.2.0' lexicographically, since
// '1' < '2' at the first differing character - confirmed this was
// silently displaying v1.12.0 (the true latest release) below v1.6.0
// through v1.9.0 in production. Segment-by-segment numeric comparison
// instead, done here in JS rather than in SQL (D1/SQLite has no
// semver-aware ORDER BY) - same "one fetch, split/sort client-side"
// posture PlatformUpdatesPage.tsx's own grouping already relies on.
// Optional leading 'v' stripped so both the pre-renumbering mixed
// '1.5.0'/'v1.6.0' formats and any future free-text version compare
// correctly; non-numeric segments fall back to 0 rather than throwing,
// since this is developer-typed text, not a validated format.
function parseVersionSegments(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((segment) => {
      const n = parseInt(segment, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

// Descending (newest version first) - returns negative when `a` is the
// newer version, matching Array.prototype.sort's "negative means a
// comes first" contract.
function compareVersionsDesc(a: string, b: string): number {
  const segmentsA = parseVersionSegments(a);
  const segmentsB = parseVersionSegments(b);
  const length = Math.max(segmentsA.length, segmentsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (segmentsB[i] ?? 0) - (segmentsA[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const rows = await env.DB
    .prepare(
      `SELECT id, title, description, status, version, created_at AS createdAt, released_at AS releasedAt
       FROM platform_updates`
    )
    .all<UpdateRow>();

  // Ordering, now applied in JS: draft/reviewed entries newest-first
  // (the "pending" queue, most recent work at the top); released
  // entries grouped by version, newest version first, newest-created
  // first within a tied version - same shape the original SQL ORDER BY
  // intended, with a correct numeric version comparison in place of the
  // buggy string one above.
  const updates = [...rows.results].sort((a, b) => {
    const aReleased = a.status === "released" ? 1 : 0;
    const bReleased = b.status === "released" ? 1 : 0;
    if (aReleased !== bReleased) return aReleased - bReleased;
    if (aReleased && a.version && b.version) {
      const versionDiff = compareVersionsDesc(a.version, b.version);
      if (versionDiff !== 0) return versionDiff;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });

  return jsonResponse({ updates });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { title?: unknown; description?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title || title.length > TITLE_MAX_LENGTH) {
    return jsonResponse({ error: `title is required (max ${TITLE_MAX_LENGTH} chars)` }, 400);
  }
  if (!description || description.length > DESCRIPTION_MAX_LENGTH) {
    return jsonResponse({ error: `description is required (max ${DESCRIPTION_MAX_LENGTH} chars)` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at)
       VALUES (?, ?, ?, 'draft', NULL, ?, NULL)`
    )
    .bind(id, title, description, now)
    .run();

  return jsonResponse({ ok: true, id, status: "draft", createdAt: now });
};
