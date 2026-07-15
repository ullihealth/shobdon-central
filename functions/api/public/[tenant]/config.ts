// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard.
// GET /api/public/:tenant/config -> { runwayGroups, theme, cameraSlots, carouselSlots, opsPanel }
//
// The actual query/response logic lives in functions/api/_utils/
// publicConfig.ts, shared with functions/api/public/config.ts (Stage 3's
// new host-based route). This file's only remaining job is resolving
// organizationId from the :tenant URL path segment (organization.slug),
// same as always - kept working unchanged as a zero-risk rollback path
// for the frontend cutover to the host-based route, not because
// anything still requires it.
//
// Authenticated writes for the management pages live in
// functions/api/tenant/[tenant]/*.ts, not here.

import { buildPublicConfigResponse, jsonResponse, type D1Database } from "../../_utils/publicConfig";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const slug = params.tenant;
  if (!slug) return jsonResponse({ error: "Missing tenant" }, 400);

  const org = await env.DB.prepare("SELECT id FROM organization WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (!org) return jsonResponse({ error: "Unknown tenant" }, 404);

  return buildPublicConfigResponse(org.id, env);
};
