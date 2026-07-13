// Public, unauthenticated read endpoint for the live dashboard - served
// by functions/api/public/[tenant]/config.ts (a Cloudflare Pages
// Function on the same origin as this SPA, hence a plain relative path -
// this is a native fetch() call, not the BetterAuth client, which
// specifically needs an absolute URL; a relative path works fine here in
// every browser).
//
// TENANT_SLUG is hardcoded to Shobdon for now - phase 0 is explicitly
// single-tenant infrastructure; this becomes a real per-deployment value
// once a second airfield onboards in a later phase.
export const TENANT_SLUG = 'shobdon'
export const PUBLIC_CONFIG_URL = `/api/public/${TENANT_SLUG}/config`

// Authenticated read/write for the management pages - functions/api/
// tenant/config.ts. Requires a valid BetterAuth session cookie, which a
// same-origin fetch() sends automatically; no extra credential handling
// needed. Resolves its own tenant from the logged-in user's membership,
// so no slug is passed here (unlike the public endpoint above).
export const TENANT_CONFIG_URL = '/api/tenant/config'

// Owner/media-role media-manager endpoints.
export const MEDIA_LIBRARY_URL = '/api/tenant/media-library'
export const MEDIA_LIBRARY_UPLOAD_URL = '/api/tenant/media-library/upload'
export const CAROUSEL_SLOTS_URL = '/api/tenant/carousel'
// Lightweight, flat (no nesting) per-tenant folders for the media
// library - functions/api/tenant/media-folders/*.
export const MEDIA_FOLDERS_URL = '/api/tenant/media-folders'

// Slide composer - see SlideEditor.tsx. Recipe attach is a separate PUT
// from the upload itself (upload.ts stays completely untouched); the
// image proxy is same-origin so an existing library image can be loaded
// into a <canvas> as a background without tainting it (the public R2
// bucket sends no CORS headers).
export const mediaLibraryRecipeUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/recipe`
export const mediaLibraryImageProxyUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/image`
// True in-place update (same id, same r2Key, new bytes) - used by the
// primary "Save Slide" action when editing an existing slide. "Save as
// New" instead uses MEDIA_LIBRARY_UPLOAD_URL above, unchanged.
export const mediaLibraryReplaceUrl = (fileId: string): string => `/api/tenant/media-library/${fileId}/replace`

// Owner/atc-role ATC-control endpoint.
export const OPS_PANEL_URL = '/api/tenant/ops-panel'
