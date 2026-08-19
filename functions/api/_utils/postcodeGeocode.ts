// Venue/café onboarding round - the venue_cafe signup branch collects a
// UK postcode instead of raw lat/lon (a café owner has no reason to
// know their own coordinates, unlike the airfield branch's audience).
// Shared between check-postcode.ts (the live-as-you-type advisory check)
// and trial-signup.ts's own real submission - same "one validator, two
// callers can't disagree" shape tenantSlug.ts's validateSlugCandidate()
// already established for the -media suffix rule.
//
// postcodes.io (https://postcodes.io) - free, no API key, UK-only,
// matches this being a UK-focused product. No caching here: postcode
// lookups are a one-off per signup attempt, not a repeated/expensive
// call worth adding KV caching for (unlike weather-forecast lookups
// elsewhere in this codebase).

// Loose format check (not a strict full UK postcode grammar) - good
// enough to short-circuit an obviously-wrong value (empty, random text)
// before ever making a network call; postcodes.io's own response is the
// real authority on whether a well-formatted-looking postcode is a real,
// currently-allocated one.
const POSTCODE_FORMAT = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

export function isValidPostcodeFormat(postcode: string): boolean {
  return POSTCODE_FORMAT.test(postcode.trim());
}

export interface PostcodeGeocodeResult {
  valid: boolean;
  lat?: number;
  lon?: number;
  // postcodes.io's own canonically-formatted postcode (correct casing/
  // spacing, e.g. "HR6 9HB") - trial-signup.ts stores this rather than
  // whatever raw casing/spacing the caller typed, so trial_signups.
  // location_text reads consistently regardless of how it was entered.
  postcode?: string;
  error?: string;
}

interface PostcodesIoResponse {
  result?: {
    latitude?: number;
    longitude?: number;
    postcode?: string;
  };
}

// Never throws - every failure path (bad format, not found, postcodes.io
// unreachable/erroring) returns { valid: false, error }, so both callers
// can treat this as the single source of truth for "is this submittable"
// without their own try/catch around it.
export async function geocodePostcode(postcode: string): Promise<PostcodeGeocodeResult> {
  const trimmed = postcode.trim();
  if (!isValidPostcodeFormat(trimmed)) {
    return { valid: false, error: "Not a recognised UK postcode format" };
  }

  let response: Response;
  try {
    response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(trimmed)}`);
  } catch {
    return { valid: false, error: "Could not verify postcode - please try again" };
  }

  if (response.status === 404) {
    return { valid: false, error: "Postcode not found" };
  }
  if (!response.ok) {
    return { valid: false, error: "Could not verify postcode - please try again" };
  }

  const data = (await response.json().catch(() => null)) as PostcodesIoResponse | null;
  const lat = data?.result?.latitude;
  const lon = data?.result?.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { valid: false, error: "Postcode not found" };
  }

  return { valid: true, lat, lon, postcode: data?.result?.postcode ?? trimmed.toUpperCase() };
}
