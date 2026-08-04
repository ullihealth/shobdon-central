import { useEffect } from 'react'

// Pilot View - "Add to Home Screen" on iOS Safari. iOS Safari does NOT
// read manifest.json for the home-screen icon/name at Add-to-Home-
// Screen time (confirmed during planning) - it reads whatever
// <link rel="apple-touch-icon">/<meta name="apple-mobile-web-app-title">
// happen to be in the live DOM at that moment. index.html ships neither
// tag tenant-specific (that file is one shared shell across every
// tenant) - this hook upserts both once real branding data resolves, so
// a pilot adding /pilot to their home screen gets THEIR club's icon/name,
// not a generic one or another tenant's leftover values from a previous
// page visit.
function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

function upsertMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
}

export function usePilotHomeScreenMeta(airfieldName: string | null, logoUrl: string | null): void {
  useEffect(() => {
    if (airfieldName) upsertMeta('apple-mobile-web-app-title', airfieldName)
    if (logoUrl) upsertLink('apple-touch-icon', logoUrl)
  }, [airfieldName, logoUrl])
}
