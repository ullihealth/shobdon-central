// Public, UNAUTHENTICATED - GET /api/public/versions -> the same
// released/version-grouped changelog data functions/api/platform/updates/
// index.ts already serves to the developer, minus the auth. Deliberately
// its own endpoint rather than a public flag on that one, so a public,
// unauthenticated caller can never end up seeing a draft/reviewed row
// regardless of future changes to the admin endpoint - the WHERE clause
// below is this endpoint's own explicit boundary, not inherited from
// anywhere else. Consumed by VersionsPage.tsx (/versions) and linked
// from /features's own "Versions" button.
import { compareVersionsDesc } from "../_utils/versionSort";

// Deliberately not importing D1Database/jsonResponse from _utils/
// tenantAuth - that module is the tenant-session auth boundary, and this
// route is intentionally unauthenticated. Same locally-defined-type
// convention every other functions/api/public/* route already uses.
type D1Database = {
  prepare: (query: string) => {
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

type PagesFunction<Env = unknown> = (context: { env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface UpdateRow {
  id: string;
  title: string;
  description: string;
  version: string;
  createdAt: string;
  releasedAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await env.DB
    .prepare(
      `SELECT id, title, description, version, created_at AS createdAt, released_at AS releasedAt
       FROM platform_updates
       WHERE status = 'released'`
    )
    .all<UpdateRow>();

  const updates = [...rows.results].sort((a, b) => {
    const versionDiff = compareVersionsDesc(a.version, b.version);
    if (versionDiff !== 0) return versionDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return jsonResponse({ updates });
};
