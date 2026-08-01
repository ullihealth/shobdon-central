// Public, unauthenticated: GET /api/public/landing-mode
//
// Read by RootRoute.tsx before deciding whether the bare marketing
// domain (airfieldcentral.com) shows the real LandingPage or
// ComingSoonPage - this is checked for EVERY visitor there, logged in
// or not, so it can never be behind auth. Never consulted for any
// tenant subdomain - DashboardPage's own render path doesn't call this
// at all, so a tenant dashboard is completely unaffected by this flag
// regardless of its value.
//
// Missing row (shouldn't happen after migration 0062, which seeds it)
// fails safe to 'coming_soon' - the same "never accidentally reveal
// the real site" posture the seeded default itself was chosen for,
// not just a random fallback.
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.DB
    .prepare("SELECT value FROM platform_settings WHERE key = 'landing_page_mode'")
    .first<{ value: string }>();

  const mode = row?.value === "live" ? "live" : "coming_soon";
  return jsonResponse({ mode });
};
