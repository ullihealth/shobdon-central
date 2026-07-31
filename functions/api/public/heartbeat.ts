// Public, UNAUTHENTICATED - POST /api/public/heartbeat?slug=<slug>.
// Called by DashboardPage.tsx ('/', slug 'main') and TenantDisplayPage.tsx
// ('/d/:slug') on mount + on an interval, so a display's actual on-screen
// time gets logged into display_visits (migration 0041) - answers "was
// this screen showing at 9am" and "what IPs have hit this URL", neither
// of which a single overwritten last-seen timestamp could answer (see
// this round's own investigation for why that earlier plan was dropped).
//
// Host-resolved tenant, same pattern as every other public route
// (display.ts, weather-default.ts) - this is the same static JS bundle
// served to every tenant's subdomain, so it can't know its own tenant at
// build time either.
import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

// Cloudflare's own edge-resolved geolocation, present on every request
// as request.cf at the platform level (not from a header, not a
// third-party lookup) - not in lib.dom.d.ts's Request type (this
// codebase has no @cloudflare/workers-types dependency, see worker/
// src/index.ts's own comment on that same choice), so narrowed locally
// to just the fields this file actually reads. Absent entirely in local
// dev without Cloudflare in front - every field already optional to
// match.
interface IncomingRequestCfProperties {
  country?: string;
  region?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
}

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// A continuously-open display page pings this endpoint every 30
// minutes (src/hooks/useDisplayHeartbeat.ts's own HEARTBEAT_INTERVAL_MS -
// keep both in sync), which is already the row-write cadence the Uptime
// Report assumes, so this window's job is narrower than it used to be:
// a 30-minute ping always exceeds this window, so it always logs on the
// normal timer, same as an IP/user-agent change always logs
// immediately - it exists purely to collapse same-IP/same-user-agent
// pings that land closer together than this into one row. Still
// deliberately smaller than the 30-minute ping interval for that
// reason - real heartbeats are untouched.
//
// Widened 5 -> 20 minutes as a deliberate stopgap: authenticated admin
// pages re-trigger this same public heartbeat hook on every navigation/
// mount, so admin browsing was writing a row every 3-6 minutes instead
// of the intended ~30. The real fix (excluding authenticated admin
// routes from the Visit Log entirely) is parked for a later session;
// this just shrinks the symptom in the meantime.
const DEDUP_WINDOW_MS = 20 * 60 * 1000;

// How long a tenant's visit rows are kept - chosen as a reasonable
// window for "was this displayed recently"/"any odd IPs lately"
// questions without keeping personal data (ip_address, user_agent)
// indefinitely. See migration 0041's own comment and the onboarding
// content privacy-notice line this same value backs.
const RETENTION_DAYS = 30;

interface LastVisitRow {
  ipAddress: string | null;
  userAgent: string | null;
  visitedAt: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const slug = new URL(request.url).searchParams.get("slug") || "main";

  // CF-Connecting-IP, not X-Forwarded-For - Cloudflare's own
  // edge-observed connecting IP, not a client-settable header. null on
  // the rare request that genuinely lacks it (e.g. local dev without
  // Cloudflare in front) rather than storing a fake placeholder value.
  const ipAddress = request.headers.get("CF-Connecting-IP");
  const userAgent = request.headers.get("User-Agent");
  const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf;
  const geoCountry = cf?.country ?? null;
  const geoRegion = cf?.region ?? null;
  const geoCity = cf?.city ?? null;
  const geoLatitude = cf?.latitude ?? null;
  const geoLongitude = cf?.longitude ?? null;
  const now = new Date();

  const lastVisit = await env.DB
    .prepare(
      "SELECT ip_address AS ipAddress, user_agent AS userAgent, visited_at AS visitedAt FROM display_visits WHERE tenant_id = ? AND display_slug = ? ORDER BY visited_at DESC LIMIT 1"
    )
    .bind(tenant.id, slug)
    .first<LastVisitRow>();

  const changed = !lastVisit || lastVisit.ipAddress !== ipAddress || lastVisit.userAgent !== userAgent;
  const staleEnough = !lastVisit || now.getTime() - new Date(lastVisit.visitedAt).getTime() >= DEDUP_WINDOW_MS;

  if (!changed && !staleEnough) {
    // No-op ping - same IP/user-agent, still within the dedup window.
    // Deliberately still 200 (not e.g. 204/304) - the caller doesn't
    // need to distinguish "logged" from "deduped", it just needs to
    // know the request succeeded.
    return jsonResponse({ ok: true, logged: false });
  }

  await env.DB
    .prepare(
      "INSERT INTO display_visits (tenant_id, display_slug, visited_at, ip_address, user_agent, geo_country, geo_region, geo_city, geo_latitude, geo_longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(tenant.id, slug, now.toISOString(), ipAddress, userAgent, geoCountry, geoRegion, geoCity, geoLatitude, geoLongitude)
    .run();

  // Prune-on-write: cheap, scoped (this tenant only), indexed delete -
  // opportunistic rather than a scheduled cron, since this project has
  // no cron infrastructure anywhere (checked both this Pages project's
  // own wrangler.toml and the standalone capture Worker's - neither has
  // a Cron Trigger configured, and Pages Functions can't have one
  // directly regardless). Only runs on an actual insert above, not
  // every deduped no-op ping, so a quiet display doesn't cost extra
  // writes on top of its own.
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM display_visits WHERE tenant_id = ? AND visited_at < ?").bind(tenant.id, cutoff).run();

  return jsonResponse({ ok: true, logged: true });
};
