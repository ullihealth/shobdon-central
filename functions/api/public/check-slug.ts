// Public, UNAUTHENTICATED - GET /api/public/check-slug?slug=X. Live-
// as-you-type availability check backing the required subdomain field
// on the public trial-signup form (src/pages/LandingPage.tsx). Mirrors
// functions/api/platform/tenants/check-slug.ts's validate-then-SELECT
// logic exactly, but that one is platform-admin-gated - this one is
// reachable by anyone on the internet, so it's rate-limited (../_utils/
// rateLimit.ts, keyed by CF-Connecting-IP) to stay safe as a public
// enumeration/abuse surface, unlike its gated sibling.
//
// Advisory only, same caveat as the platform-admin version: trial-
// signup.ts's own atomic INSERT-then-catch (backed by tenants.slug's
// UNIQUE constraint) is the real uniqueness guarantee - this is just
// fast form feedback, and can never fully close the race between two
// concurrent requests on its own.
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { validateSlugCandidate, CAFE_SLUG_SUFFIX } from "../_utils/tenantSlug";
import { isRateLimited, type KVNamespace } from "../_utils/rateLimit";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  WEATHER_CACHE: KVNamespace;
}

// Generous enough for a real person adjusting their subdomain choice a
// few times (each keystroke debounced client-side already, see
// LandingPage.tsx), tight enough to blunt a basic scripted loop.
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const limited = await isRateLimited(env.WEATHER_CACHE, `check-slug:${clientIp}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS);
  if (limited) return jsonResponse({ available: false, reason: "Too many checks - please slow down" }, 429);

  const slug = (new URL(request.url).searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return jsonResponse({ error: "slug query param is required" }, 400);

  // Venue/café onboarding round - ?signupType=venue_cafe makes this
  // live-typing check enforce the exact same -media suffix rule
  // trial-signup.ts's own real submission enforces below, via the same
  // shared validateSlugCandidate() call - so this can never show
  // "available" for a slug the real submission would then reject.
  const signupType = new URL(request.url).searchParams.get("signupType");
  const requiredSuffix = signupType === "venue_cafe" ? CAFE_SLUG_SUFFIX : undefined;

  const validation = validateSlugCandidate(slug, requiredSuffix);
  if (!validation.valid) {
    return jsonResponse({ available: false, reason: validation.error });
  }

  const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (existing) {
    return jsonResponse({ available: false, reason: "That subdomain is already taken" });
  }

  return jsonResponse({ available: true });
};
