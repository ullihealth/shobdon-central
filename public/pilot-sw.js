// Pilot View service worker - scoped to /pilot only (registered with
// { scope: '/pilot' } from PilotViewPage.tsx), not the whole app. Hand-
// written rather than vite-plugin-pwa/Workbox - no new build dependency,
// consistent with this codebase's existing "hand-roll a narrow local
// solution" convention (no icon library, no drag-reorder library, etc).
//
// Deliberately network-first for everything, not a precached app shell -
// Vite's build output uses content-hashed filenames that change every
// deploy, so a hand-written precache list would go stale the moment a
// new version ships (this is exactly the problem vite-plugin-pwa's own
// build-time manifest generation solves, which is more machinery than
// this round needs).
//
// Live data (weather/NOTAMs/AFISO/ticker - everything under /api/) is
// NEVER written to the cache, at all, full stop - not "network-first
// with a cache fallback" for these, genuinely excluded. Confirmed the
// hard way: an earlier version of this file cached every successful
// same-origin GET indiscriminately, which meant a genuinely-offline
// device would silently serve a last-known /api/public/config (stale
// weather/AFISO/ticker) or /api/public/notams response through the
// catch() fallback below, indistinguishable from a live one to the
// calling React code - exactly the "stale data shown as if current"
// failure this route can't accept given NOTAMs/AFISO are safety-
// relevant. Everything under functions/api/ in this codebase is a
// dynamic Pages Function, never a static asset, so excluding the whole
// /api/ prefix (rather than enumerating today's specific live-data
// endpoints) stays correct automatically if a new one is added later
// without anyone having to remember to update this file. Only the app
// shell (the /pilot document itself, hashed JS/CSS, fonts, icons) gets
// cached - genuinely static, safe to show from cache if a later
// request for the same asset fails.
const CACHE_NAME = 'pilot-view-v1'

function isLiveDataRequest(url) {
  return new URL(url).pathname.startsWith('/api/')
}

self.addEventListener('install', (event) => {
  // Take over immediately on next load rather than waiting for every
  // open tab to close first - safe here since every response strategy
  // below is network-first, so an old service worker instance briefly
  // still active during activation can't serve stale data either.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Only ever handle GET - POST/PUT (form submissions, API writes)
  // always go straight to the network, untouched.
  if (event.request.method !== 'GET') return

  const isLiveData = isLiveDataRequest(event.request.url)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache genuinely successful, same-origin, non-API
        // responses - never cache an error page, an opaque cross-origin
        // response, or any live-data endpoint as if it were a static
        // asset (see the file-level comment above).
        if (response.ok && !isLiveData && new URL(event.request.url).origin === self.location.origin) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone))
        }
        return response
      })
      .catch(() => {
        // Live data has no cache entry to fall back to by construction
        // (never written above) - a genuinely offline request for
        // /api/public/config or /api/public/notams surfaces as a normal
        // fetch failure, exactly as it would with no service worker at
        // all, so the page's own existing error/"N/A" handling takes
        // over rather than quietly rendering stale readings.
        if (isLiveData) return Response.error()
        return caches.match(event.request).then((cached) => cached || Response.error())
      })
  )
})
