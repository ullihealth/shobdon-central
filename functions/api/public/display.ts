// Public, UNAUTHENTICATED read for a single named tenant display
// (tenant_displays, migration 0027) - GET /api/public/display?slug=<slug>
// -> { slug, name, templateId, panelConfig }. slug defaults to 'main'
// when omitted, matching every tenant's guaranteed seeded row so every
// existing bookmarked/embedded dashboard URL (which never passes a
// slug) is unaffected by this endpoint's existence.
//
// Host-resolved tenant, same as functions/api/public/config.ts - this
// is the same static JS bundle served to every tenant's subdomain, so
// it can't know its own tenant at build time either. Does not return
// the actual weather/ops/theme/carousel data itself (still
// PUBLIC_CONFIG_URL's job, unchanged) - just which template + which
// panels this named display should render.

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantDisplayRow {
  slug: string;
  name: string;
  templateId: string;
  panelConfigJson: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const slug = new URL(request.url).searchParams.get("slug") || "main";

  const row = await env.DB
    .prepare(
      "SELECT slug, name, template_id AS templateId, panel_config AS panelConfigJson FROM tenant_displays WHERE tenant_id = ? AND slug = ?"
    )
    .bind(tenant.id, slug)
    .first<TenantDisplayRow>();

  if (!row) return jsonResponse({ error: `No display named '${slug}' for this tenant` }, 404);

  return jsonResponse({
    slug: row.slug,
    name: row.name,
    templateId: row.templateId,
    panelConfig: row.panelConfigJson ? JSON.parse(row.panelConfigJson) : null,
  });
};
