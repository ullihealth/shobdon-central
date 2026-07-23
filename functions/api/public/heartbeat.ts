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

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// A continuously-open display page pings this endpoint every 2-5
// minutes (see DashboardPage.tsx/TenantDisplayPage.tsx's own heartbeat
// effect), but logging every single ping would be pure noise for what
// this table is actually asked - "was it on around 9am" and "what IPs
// have hit this" don't need row-per-ping resolution. A new row is only
// written when the IP or user-agent actually changed since the last
// logged row (an unexpected-access signal, logged immediately, not
// batched), OR when this many milliseconds have passed since the last
// row for this tenant+slug (so a quiet, unchanging display still gets
// occasional fresh rows, not one from days ago as its only record).
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
    .prepare("INSERT INTO display_visits (tenant_id, display_slug, visited_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(tenant.id, slug, now.toISOString(), ipAddress, userAgent)
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
