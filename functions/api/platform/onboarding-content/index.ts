// Platform-admin only: GET/PUT /api/platform/onboarding-content
// requirePlatformAdmin (org-independent, same reasoning as every other
// functions/api/platform/* route - see tenantAuth.ts's own comment on
// that helper) - this content is genuinely global, not tenant-scoped,
// so there's no org to resolve here anyway.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

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

interface VideoInput {
  id: string;
  title: string;
  url: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
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

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as
    | { videos?: VideoInput[]; termsText?: string; privacyText?: string }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const videos = Array.isArray(body.videos)
    ? body.videos
        .filter((video) => video && typeof video.id === "string" && typeof video.title === "string" && typeof video.url === "string")
        .map((video) => ({ id: video.id, title: video.title, url: video.url }))
    : [];

  await env.DB
    .prepare("UPDATE onboarding_content SET videos_json = ?, terms_text = ?, privacy_text = ?, updated_at = ? WHERE id = 1")
    .bind(
      JSON.stringify(videos),
      typeof body.termsText === "string" ? body.termsText : "",
      typeof body.privacyText === "string" ? body.privacyText : "",
      new Date().toISOString()
    )
    .run();

  return jsonResponse({ ok: true });
};
