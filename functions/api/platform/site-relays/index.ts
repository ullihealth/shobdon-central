// Platform-admin only: GET/POST /api/platform/site-relays. Backs the
// "Site Relays" sub-section of PlatformCamerasPage.tsx - a site relay
// must exist before a camera can be assigned to it, since cameras.
// site_relay_id is a real FK (migration 0047).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface SiteRelayRow {
  id: string;
  tenantId: number;
  label: string;
  localBaseUrl: string;
  createdAt: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const rows = await env.DB
    .prepare("SELECT id, tenant_id AS tenantId, label, local_base_url AS localBaseUrl, created_at AS createdAt FROM site_relays ORDER BY created_at DESC")
    .all<SiteRelayRow>();

  return jsonResponse({ siteRelays: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; tenantId?: unknown; label?: unknown; localBaseUrl?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  const tenantId = typeof body.tenantId === "number" ? body.tenantId : Number(body.tenantId);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const localBaseUrl = typeof body.localBaseUrl === "string" ? body.localBaseUrl.trim() : "";

  if (!SLUG_PATTERN.test(id)) {
    return jsonResponse({ error: "id must be lowercase letters, numbers, and hyphens only (e.g. shobdon-main)" }, 400);
  }
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "tenantId is required" }, 400);
  if (!label) return jsonResponse({ error: "label is required" }, 400);
  if (!localBaseUrl) return jsonResponse({ error: "localBaseUrl is required" }, 400);

  const existing = await env.DB.prepare("SELECT id FROM site_relays WHERE id = ?").bind(id).first<{ id: string }>();
  if (existing) return jsonResponse({ error: "A site relay with this id already exists" }, 409);

  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first<{ id: number }>();
  if (!tenant) return jsonResponse({ error: "Unknown tenantId" }, 400);

  const now = new Date().toISOString();
  await env.DB
    .prepare("INSERT INTO site_relays (id, tenant_id, label, local_base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, tenantId, label, localBaseUrl, now, now)
    .run();

  return jsonResponse({ ok: true, id });
};
