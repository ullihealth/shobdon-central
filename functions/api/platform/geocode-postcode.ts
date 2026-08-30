// Platform-admin only: POST /api/platform/geocode-postcode - resolves a
// UK postcode to lat/lon for the new-tenant onboarding wizard
// (PlatformTenantsPage.tsx), before any tenant row exists to PUT
// against (unlike functions/api/tenant/config.ts's own postcode
// handling, which writes straight into an existing tenant's row).
// Reuses the SAME geocodePostcode() (_utils/postcodeGeocode.ts) the
// venue_cafe self-serve signup branch already established
// (trial-signup.ts/check-postcode.ts) - one place talks to
// postcodes.io, not a second implementation. Purely a stateless lookup
// proxy - never touches D1, just forwards the { valid, lat, lon,
// postcode, error } shape that helper already returns, same as
// check-postcode.ts's own response shape (that endpoint is public +
// rate-limited for the landing page's live-as-you-type check; this one
// is authenticated-admin-only instead, no rate limiting needed).
//
// onboard.ts's own required-lat/lon-unless-parent-selected logic is
// entirely untouched by this - the wizard still submits plain lat/lon in
// its onboard POST exactly as before, just populated via this lookup
// instead of (or alongside) manual typing.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { geocodePostcode } from "../_utils/postcodeGeocode";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { postcode?: unknown } | null;
  const postcode = typeof body?.postcode === "string" ? body.postcode : "";
  if (!postcode.trim()) return jsonResponse({ valid: false, error: "postcode is required" }, 400);

  const geocoded = await geocodePostcode(postcode);
  return jsonResponse(geocoded);
};
