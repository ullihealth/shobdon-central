// Role -> landing-page mapping for the public dashboard, shared by
// Header.tsx (the normal top-of-page link) and PersistentConfigLink.tsx
// (the fullscreen-safe overlay). Kept as one pure function rather than
// inlined in both places - the two callers resolving this differently
// is exactly the "lands on the wrong page" risk worth avoiding.
//
// Dashboard-Manager-as-landing round: plain owner/admin now land on
// /media-manager instead of /config - Dashboard Manager is the page a
// tenant admin actually wants day to day (media library, carousel
// slots, gas prices, ticker), Weather Config is a once-in-a-while
// setup page still reachable from the sidebar as normal. isDeveloper
// is a THIRD, deliberately separate input (not just another role) -
// the real developer account holds role='owner' at Shobdon like any
// other owner, so without this it would silently also move off
// /config, which this round's own go-ahead explicitly ruled out
// ("developer account still lands where it does today").
export function resolveDashboardLandingPage(
  role: string | undefined | null,
  tenantType: string | undefined | null,
  isDeveloper?: boolean | null
): string {
  if (!role) return '/login'
  if (role === 'atc') return '/atc-control'
  if (role === 'media') return '/media-manager'
  if (role === 'cafe') return '/cafe-media'
  if (tenantType === 'venue_cafe') return '/cafe-media'
  return isDeveloper ? '/config' : '/media-manager'
}
