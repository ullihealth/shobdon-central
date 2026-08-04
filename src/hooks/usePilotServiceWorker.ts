import { useEffect } from 'react'

// Pilot View - registers public/pilot-sw.js, scoped to /pilot only (not
// the whole app - every other route is untouched by this). Genuine
// installed-app PWA behaviour (what this hook is for) needs a real
// service worker with a fetch handler - a manifest + apple-touch-icon
// alone only gets "Add to Home Screen" on iOS specifically, not the
// broader install criteria most platforms actually check for. Silently
// no-ops in a browser/WebView with no serviceWorker support rather than
// throwing - installability is a progressive enhancement here, never a
// requirement for the page to function.
export function usePilotServiceWorker(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/pilot-sw.js', { scope: '/pilot' }).catch(() => {})
  }, [])
}
