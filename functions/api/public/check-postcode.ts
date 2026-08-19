// Public, UNAUTHENTICATED - GET /api/public/check-postcode?postcode=X.
// Live-as-you-type validity check backing the venue_cafe signup
// branch's Postcode field (src/pages/LandingPage.tsx). Same shape as
// check-slug.ts: rate-limited (../_utils/rateLimit.ts, keyed by
// CF-Connecting-IP) since it's a public, unauthenticated surface, and
// deliberately advisory only - trial-signup.ts's own real submission
// calls the exact same geocodePostcode() (../_utils/postcodeGeocode.ts)
// as the actual gate, so this endpoint can never show "valid" for a
// postcode the real submission would then reject.
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { geocodePostcode } from "../_utils/postcodeGeocode";
import { isRateLimited, type KVNamespace } from "../_utils/rateLimit";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  WEATHER_CACHE: KVNamespace;
}

// Same limits as check-slug.ts - generous enough for a real person
// adjusting their postcode a few times (debounced client-side), tight
// enough to blunt a basic scripted loop against postcodes.io via this
// endpoint.
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const limited = await isRateLimited(env.WEATHER_CACHE, `check-postcode:${clientIp}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS);
  if (limited) return jsonResponse({ valid: false, error: "Too many checks - please slow down" }, 429);

  const postcode = (new URL(request.url).searchParams.get("postcode") ?? "").trim();
  if (!postcode) return jsonResponse({ error: "postcode query param is required" }, 400);

  const result = await geocodePostcode(postcode);
  return jsonResponse({ valid: result.valid, error: result.error });
};
