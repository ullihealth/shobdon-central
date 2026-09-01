// Role -> landing-page mapping for the public dashboard, shared by
// Header.tsx (the normal top-of-page link) and PersistentConfigLink.tsx
// (the fullscreen-safe overlay). Kept as one pure function rather than
// inlined in both places - the two callers resolving this differently
// is exactly the "lands on the wrong page" risk worth avoiding.
export function resolveDashboardLandingPage(role: string | undefined | null, tenantType: string | undefined | null): string {
  if (!role) return '/login'
  if (role === 'atc') return '/atc-control'
  if (role === 'media') return '/media-manager'
  if (role === 'cafe') return '/cafe-media'
  return tenantType === 'venue_cafe' ? '/cafe-media' : '/config'
}
