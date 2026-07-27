// Shared slug format/reserved-word validation for tenant subdomains -
// used by the platform-admin invite flow (onboard.ts, a human
// deliberately choosing a subdomain now that the wildcard DNS migration
// makes any valid one resolve automatically) and its paired live-
// availability-check endpoint. trial-signup.ts's own slugify() is a
// different concern (deriving a slug FROM a typed business name) and
// stays there, but the reserved-word list itself is the same underlying
// "which slugs would collide with something real" fact regardless of
// which flow is choosing one - this is the one place meant to stay in
// sync with src/App.tsx's actual route table going forward.

// Every top-level path segment src/App.tsx actually routes on, plus
// registration/marketing-adjacent words a real customer could plausibly
// expect to behave a certain way (www, api). Confirmed directly against
// App.tsx's route list, not guessed - includes onboard/onboarding/
// upgrade/d/platform/media-library/cafe-media/help, which trial-
// signup.ts's own older list (written before several of these routes
// existed) was missing.
export const RESERVED_SLUGS = new Set([
  "www",
  "api",
  "global",
  "admin",
  "app",
  "login",
  "checklist",
  "account",
  "config",
  "design",
  "runways",
  "members",
  "media-manager",
  "media-library",
  "cafe-media",
  "atc-control",
  "developertools",
  "static",
  "assets",
  "signup",
  "trial",
  "shobdon",
  "onboard",
  "onboarding",
  "upgrade",
  "d",
  "platform",
  "help",
]);

// DNS-label-shaped: lowercase letters/digits/hyphens only, no leading or
// trailing hyphen (both invalid in a real DNS label), 3-63 characters
// (63 is the actual DNS label limit; 3 is just a sane floor so a
// two-character subdomain isn't accidentally landed on - not a protocol
// requirement).
const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_FORMAT.test(slug);
}

export interface SlugValidationResult {
  valid: boolean;
  error?: string;
}

// Format + reserved-word check only - deliberately does NOT touch the
// database. Whether/how to check current availability differs between
// a live-typing check endpoint (a single fresh SELECT) and the actual
// create endpoint (a pre-check, then a try/catch around the INSERT
// itself for the real atomic guarantee) - both call this first, then
// do their own DB-touching work on top.
export function validateSlugCandidate(slug: string): SlugValidationResult {
  if (!isValidSlugFormat(slug)) {
    return {
      valid: false,
      error: "3-63 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { valid: false, error: "That subdomain is reserved" };
  }
  return { valid: true };
}
