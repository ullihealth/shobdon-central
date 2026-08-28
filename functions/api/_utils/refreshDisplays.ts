// "Refresh displays" round - shared by every authenticated Pages Function
// that triggers a tenant's own live-display reload as a side effect of a
// successful save (ops-panel/index.ts, tenant/config.ts's theme AND
// runwayGroups saves - two independent trigger points in that one file).
// Extracted here once a second FILE needed it (config.ts), on top of the
// two independent call sites already inside it - past that point the
// existing "duplicate small server-to-Worker constants across
// independently-reasoned-about Pages Functions" convention (see
// capture-refresh.ts/capture-logs.ts) stops paying for itself. The
// platform-admin relay (functions/api/platform/refresh-displays.ts)
// deliberately does NOT use this - it surfaces failure to the admin UI
// (a distinct design intent, its own loading/error state) rather than
// swallowing errors silently, so it keeps its own copy of the
// Worker-base/fallback-key constants rather than sharing this
// swallow-everything helper.
import type { D1Database } from "./tenantAuth";

const CAPTURE_WORKER_BASE = "https://shobdon-central-capture.jeffthompson.workers.dev";
const FALLBACK_CAPTURE_KEY = "49f761797d8e1fe76898e079b997980f";

// 2 seconds - generous for a same-Cloudflare-network Worker call under
// normal conditions, short enough that a genuinely stuck/unresponsive
// Worker degrades this save to "the refresh just didn't fire this
// cycle" rather than stalling the response the caller is actually
// waiting on. Found in review: this fetch previously had no bound at
// all, and now runs on every ops-panel/design/runways save - frequent,
// core admin actions - not just the occasional platform-admin action.
const REFRESH_TRIGGER_TIMEOUT_MS = 2000;

// Resolves the caller's TENANT slug (tenants.slug), not the ORGANIZATION
// slug requireRoles/TenantMembership returns - the two can differ (e.g.
// Gyroplane Train: tenants.slug='gyroplane' but
// organization.slug='tenant-3tvd9aq5', see resolveTenantMembership's own
// comment in tenantAuth.ts for that exact case), and the Worker's
// refresh-flag KV key is keyed on tenants.slug (same identifier
// publicConfig.ts exposes as `slug` and RemoteRefreshWatcher.tsx reads
// client-side) - using the wrong one here would silently refresh nothing
// (or the wrong tenant, if another tenant's slug happened to collide
// with this org's slug).
export async function resolveTenantSlug(db: D1Database, organizationId: string): Promise<string | null> {
  const row = await db.prepare("SELECT slug FROM tenants WHERE organization_id = ?").bind(organizationId).first<{ slug: string }>();
  return row?.slug ?? null;
}

// Best-effort, never fails the save it's attached to - a slow or
// unresponsive Worker here must not make a successful write report back
// as an error, and must not hang the response either (see
// REFRESH_TRIGGER_TIMEOUT_MS above). Same key-injection pattern as
// capture-refresh.ts/capture-logs.ts, just server-resolved tenant
// instead of the hardcoded Shobdon-only one those two use.
//
// Logs on a non-ok response (silent-failure round, 2026-08-28) - this
// previously swallowed EVERYTHING, including a non-2xx status, not just
// network/timeout errors. checkKey() on the Worker side does a strict
// equality check against ITS OWN env.CAPTURE_KEY secret - a completely
// separate Cloudflare deployment/secret store from this Pages project's
// own env.CAPTURE_KEY - so if the two are ever out of sync, every single
// trigger call gets a 403 that was previously invisible everywhere (a
// real incident: tenant saves persisted correctly, but the paired
// refresh silently 403'd every time, with zero evidence anywhere it had
// even been attempted). Still never throws - logging a warning is not
// the same as failing the save this is attached to.
export async function triggerTenantRefresh(env: { CAPTURE_KEY?: string }, tenantSlug: string): Promise<void> {
  const key = env.CAPTURE_KEY || FALLBACK_CAPTURE_KEY;
  try {
    const response = await fetch(`${CAPTURE_WORKER_BASE}/refresh?key=${key}&tenant=${encodeURIComponent(tenantSlug)}`, {
      signal: AbortSignal.timeout(REFRESH_TRIGGER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`triggerTenantRefresh: Worker responded ${response.status} for tenant "${tenantSlug}"`);
    }
  } catch (error) {
    console.error(`triggerTenantRefresh: request failed for tenant "${tenantSlug}"`, error instanceof Error ? error.message : error);
  }
}
