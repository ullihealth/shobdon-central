// Public, UNAUTHENTICATED - GET /api/public/manifest.json - a per-tenant
// web app manifest for the Pilot View (/pilot), resolved by Host header
// exactly like functions/api/public/config.ts. Primarily serves Android
// Chrome / any future iOS Safari version that does read manifest.json
// for home-screen install metadata - iOS Safari TODAY does not read
// this at Add-to-Home-Screen time at all (it reads live DOM
// <link rel="apple-touch-icon">/<meta name="apple-mobile-web-app-title">
// instead - see src/hooks/usePilotHomeScreenMeta.ts, which is what
// actually satisfies the iOS requirement this round asked for). This
// route is still worth having: it's nearly free given the existing
// Host-resolution pattern, and it's what makes a future/Android install
// prompt tenant-branded rather than generic.
//
// Deliberately a lightweight, dedicated query rather than reusing
// buildPublicConfigData - a manifest request needs only name/logo, not
// the full config payload (runways/carousel/ops panel/etc).
import { resolveOrganizationIdFromHost } from "../_utils/resolveTenantHost";

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

function manifestResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return manifestResponse({ error: "Missing Host header" }, 400);

  const organizationId = await resolveOrganizationIdFromHost(host, env.DB);
  if (!organizationId) return manifestResponse({ error: "Unknown tenant host" }, 404);

  const tenant = await env.DB
    .prepare("SELECT name, logo_r2_key AS logoR2Key FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ name: string; logoR2Key: string | null }>();

  const name = tenant?.name ?? "Airfield Central";
  const iconUrl = tenant?.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenant.logoR2Key}` : null;

  return manifestResponse({
    name: `${name} Pilot View`,
    short_name: name,
    start_url: "/pilot",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: iconUrl ? [{ src: iconUrl, sizes: "any", type: "image/png" }] : [],
  });
};
