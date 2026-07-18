// Any authenticated tenant member: GET /api/tenant/onboarding-content
// Read-only fetch of the global (not tenant-scoped) singleton row - used
// by both the mandatory OnboardingTermsPage.tsx gate and the ongoing
// HelpPage.tsx. requireTenant only (any role), since every member,
// regardless of role, needs to be able to read this - it's what the
// mandatory gate itself is built from.
import { requireTenant, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface ContentRow {
  videosJson: string;
  termsText: string;
  privacyText: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  const row = await env.DB
    .prepare("SELECT videos_json AS videosJson, terms_text AS termsText, privacy_text AS privacyText FROM onboarding_content WHERE id = 1")
    .first<ContentRow>();

  return jsonResponse({
    videos: row ? JSON.parse(row.videosJson) : [],
    termsText: row?.termsText ?? "",
    privacyText: row?.privacyText ?? "",
  });
};
