// Minimal authenticated management for tenant_displays (migration 0027)
// - owner-only, same "no dedicated settings page yet, curl/devtools
// fetch with your own session cookie is fine" posture as
// public-visibility.ts. A full visual template builder/editor is a
// later stretch goal, not needed for the first templates.
//
// requireOwner, imported unchanged from tenantAuth.ts - this file adds
// a new route that USES the existing owner gate, it does not modify
// requireOwner/requireTenant or any other authenticated route.

import { requireOwner, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantDisplayRow {
  slug: string;
  name: string;
  templateId: string;
  panelConfigJson: string | null;
  updatedAt: string;
}

interface TenantIdentity {
  id: number;
  subdomain: string;
}

async function resolveTenant(db: D1Database, organizationId: string): Promise<TenantIdentity | null> {
  const row = await db
    .prepare("SELECT id, subdomain FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<TenantIdentity>();
  return row ?? null;
}

// Response includes the tenant's own subdomain alongside the displays -
// so a consumer (the /config "Your displays" list) can build each
// display's full live URL (https://<subdomain>/d/<slug>) without a
// second request or hardcoding the domain scheme itself.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const tenant = await resolveTenant(env.DB, result.membership.organizationId);
  if (!tenant) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  const rows = await env.DB
    .prepare(
      "SELECT slug, name, template_id AS templateId, panel_config AS panelConfigJson, updated_at AS updatedAt FROM tenant_displays WHERE tenant_id = ? ORDER BY id"
    )
    .bind(tenant.id)
    .all<TenantDisplayRow>();

  return jsonResponse({
    subdomain: tenant.subdomain,
    displays: rows.results.map((row) => ({
      slug: row.slug,
      name: row.name,
      templateId: row.templateId,
      panelConfig: row.panelConfigJson ? JSON.parse(row.panelConfigJson) : null,
      updatedAt: row.updatedAt,
    })),
  });
};

// Upsert by (tenantId, slug) - the table's own UNIQUE constraint. One
// call creates a brand-new display or updates an existing one's
// name/template/panel_config; a hand-rolled admin tool has no need for
// separate POST/PUT verbs to distinguish the two.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const tenant = await resolveTenant(env.DB, result.membership.organizationId);
  if (!tenant) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  const body = (await request.json().catch(() => null)) as
    | { slug?: unknown; name?: unknown; templateId?: unknown; panelConfig?: unknown }
    | null;
  if (!body || typeof body.slug !== "string" || !body.slug.trim()) {
    return jsonResponse({ error: "slug is required" }, 400);
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return jsonResponse({ error: "name is required" }, 400);
  }
  const slug = body.slug.trim();
  const name = body.name.trim();
  const templateId = typeof body.templateId === "string" && body.templateId.trim() ? body.templateId.trim() : "classic";
  const panelConfigJson = body.panelConfig && typeof body.panelConfig === "object" ? JSON.stringify(body.panelConfig) : null;
  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO tenant_displays (tenant_id, slug, name, template_id, panel_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, slug) DO UPDATE SET
         name = excluded.name,
         template_id = excluded.template_id,
         panel_config = excluded.panel_config,
         updated_at = excluded.updated_at`
    )
    .bind(tenant.id, slug, name, templateId, panelConfigJson, now, now)
    .run();

  return jsonResponse({ ok: true, slug, name, templateId, panelConfig: body.panelConfig ?? null });
};
