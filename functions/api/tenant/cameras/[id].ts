// Authenticated (requireOwner - matches config.ts's own admin-action
// posture): PATCH /api/tenant/cameras/:id. Two shapes, disambiguated by
// which keys are present:
//
// 1. { pushEnabled: boolean } only - the original narrow "go live
//    remotely" toggle CameraPanel.tsx sends, unchanged.
// 2. { name, mode, youtubeVideoId?, rtsp? } - the tenant Config page's
//    self-service edit (added alongside CameraSection.tsx). Lets a
//    tenant's own owner/admin edit an already-provisioned camera's
//    logical settings. Deliberately still cannot touch siteRelayId or
//    create/delete cameras - relay assignment is physical on-site setup
//    done by the platform admin (functions/api/platform/cameras/), see
//    that route's own comment. This endpoint only ever updates a row
//    that already exists.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const VALID_MODES = new Set(["local", "stream", "both"]);

// Mirrors PlatformCamerasPage.tsx's own buildRtspAddress exactly (same
// non-encoded concatenation) - kept in parity rather than "fixed" here,
// so a camera edited from either page round-trips through
// parseRtspAddress on the platform side identically either way.
function buildRtspAddress(ip: string, port: string, username: string, password: string, path: string): string {
  const auth = username ? `${username}:${password}@` : "";
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `rtsp://${auth}${ip}:${port || "554"}${normalizedPath}`;
}

interface RtspInput {
  ip?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  path?: unknown;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as
    | {
        pushEnabled?: unknown;
        name?: unknown;
        mode?: unknown;
        youtubeVideoId?: unknown;
        rtsp?: RtspInput;
      }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  // Explicit ownership check before any write, rather than folding it
  // into the UPDATE's WHERE clause and inspecting affected-row count -
  // this codebase's minimal D1Database type (tenantAuth.ts) only
  // exposes run() -> { success }, not a row-count, so this is both the
  // type-safe option and gives a clean 404 for "not yours"/"doesn't
  // exist" without needing to distinguish the two. rtsp_address is
  // selected here purely for server-side "is one already set" logic
  // below - never included in any response.
  const existing = await env.DB
    .prepare("SELECT c.id, c.rtsp_address AS rtspAddress FROM cameras c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ? AND t.organization_id = ?")
    .bind(params.id, organizationId)
    .first<{ id: string; rtspAddress: string | null }>();
  if (!existing) return jsonResponse({ error: "Camera not found" }, 404);

  const now = new Date().toISOString();

  // Shape 1: legacy narrow toggle - untouched behaviour, still exactly
  // what CameraPanel.tsx sends.
  if (typeof body.name !== "string" && typeof body.mode !== "string") {
    if (typeof body.pushEnabled !== "boolean") {
      return jsonResponse({ error: "pushEnabled (boolean) is required" }, 400);
    }
    await env.DB
      .prepare("UPDATE cameras SET push_enabled = ?, updated_at = ? WHERE id = ?")
      .bind(body.pushEnabled ? 1 : 0, now, params.id)
      .run();
    return jsonResponse({ ok: true });
  }

  // Shape 2: full self-service edit.
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!name) return jsonResponse({ error: "name is required" }, 400);
  if (!VALID_MODES.has(mode)) return jsonResponse({ error: "mode must be 'local', 'stream', or 'both'" }, 400);

  const needsRtsp = mode === "local" || mode === "both";
  const needsYoutube = mode === "stream" || mode === "both";

  let rtspAddress: string | null = null;
  if (needsRtsp) {
    if (body.rtsp && typeof body.rtsp.ip === "string" && body.rtsp.ip.trim()) {
      rtspAddress = buildRtspAddress(
        body.rtsp.ip.trim(),
        typeof body.rtsp.port === "string" ? body.rtsp.port.trim() : "",
        typeof body.rtsp.username === "string" ? body.rtsp.username.trim() : "",
        typeof body.rtsp.password === "string" ? body.rtsp.password : "",
        typeof body.rtsp.path === "string" ? body.rtsp.path.trim() : ""
      );
    } else if (existing.rtspAddress) {
      // No new value submitted - keep the current (never-returned-to-
      // the-browser) address as-is, same "leave blank to keep unchanged"
      // convention as a password-change form.
      rtspAddress = existing.rtspAddress;
    } else {
      return jsonResponse({ error: "RTSP source is required for local/both mode" }, 400);
    }
  }

  let youtubeVideoId: string | null = null;
  if (needsYoutube) {
    const trimmed = typeof body.youtubeVideoId === "string" ? body.youtubeVideoId.trim() : "";
    if (!trimmed) return jsonResponse({ error: "youtubeVideoId is required for stream/both mode" }, 400);
    youtubeVideoId = trimmed;
  }

  await env.DB
    .prepare("UPDATE cameras SET name = ?, mode = ?, rtsp_address = ?, youtube_video_id = ?, updated_at = ? WHERE id = ?")
    .bind(name, mode, rtspAddress, youtubeVideoId, now, params.id)
    .run();

  return jsonResponse({ ok: true });
};
