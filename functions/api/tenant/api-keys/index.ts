// Owner-only management for tenant_api_keys (migration 0029) - keys used
// by the generic weather ingestion endpoint (functions/api/ingest/
// weather.ts). No settings-page UI yet - same "curl/devtools with your
// own session cookie" posture public-visibility.ts had before it got a
// settings-page consumer.
//
// POST returns the raw key exactly once, at creation time - only its
// hash is ever stored, so there is no "view key again" capability by
// design. Losing it means creating a new one and revoking the old
// (DELETE .../api-keys/:id).

import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { generateApiKey, hashApiKey } from "../../_utils/apiKeys";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface ApiKeyRow {
  id: string;
  label: string | null;
  keyPrefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

async function resolveTenantId(db: D1Database, organizationId: string): Promise<number | null> {
  const row = await db.prepare("SELECT id FROM tenants WHERE organization_id = ?").bind(organizationId).first<{ id: number }>();
  return row?.id ?? null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const tenantId = await resolveTenantId(env.DB, result.membership.organizationId);
  if (!tenantId) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  const rows = await env.DB
    .prepare(
      "SELECT id, label, key_prefix AS keyPrefix, created_at AS createdAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC"
    )
    .bind(tenantId)
    .all<ApiKeyRow>();

  return jsonResponse(rows.results);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const tenantId = await resolveTenantId(env.DB, result.membership.organizationId);
  if (!tenantId) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null;

  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16);
  const id = `key_${crypto.randomUUID()}`;

  await env.DB
    .prepare("INSERT INTO tenant_api_keys (id, tenant_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?, ?)")
    .bind(id, tenantId, keyHash, keyPrefix, label)
    .run();

  return jsonResponse({ id, key: rawKey, keyPrefix, label });
};
