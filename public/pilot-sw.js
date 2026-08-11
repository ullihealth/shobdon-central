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

// Update-banner round: install used to call self.skipWaiting()
// unconditionally, activating a new version the moment it finished
// installing - safe from a caching standpoint (every response strategy
// here is network-first) but it defeated the whole point of a tap-to-
// reload banner, since by the time a pilot could see one, the new
// worker had usually already taken over. skipWaiting() now only runs
// when explicitly asked (see the message listener below, fired by
// usePilotServiceWorkerUpdate.ts once the pilot taps the banner) - a
// newly-installed version sits in registration.waiting instead, exactly
// the state that hook needs to detect an update is available at all.
self.addEventListener('install', () => {})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Only ever handle GET - POST/PUT (form submissions, API writes)
  // always go straight to the network, untouched.
  if (event.request.method !== 'GET') return

  // Cross-origin requests are never touched by this service worker at
  // all - not cached, not network-first-wrapped, nothing. Confirmed the
  // hard way: isLiveDataRequest() below only ever checked pathname
  // (correct for same-origin /api/* live data), so a cross-origin
  // live-data request - the weather station's own capture Worker,
  // *.workers.dev, a genuinely different origin from this app - fell
  // through as NOT live data, got intercepted, and this handler tried
  // to fetch(event.request) again from inside the service worker's own
  // execution context to service it. Re-dispatching a cross-origin
  // Request from within a SW fetch handler is a known WebKit trouble
  // spot; on affected Safari sessions that refetch failed, landed in
  // the generic (non-live-data) catch branch below, found nothing in
  // cache (cross-origin responses are never written there either - see
  // the origin check inside the .then() below), and returned
  // Response.error() - a literal network-error Response, which is
  // exactly what Safari's console reports as "Response served by
  // service worker is an error". Bailing out here before any of that
  // logic runs means the browser's own normal, un-intercepted network
  // handling takes over completely for every cross-origin request -
  // this app only ever has one such family (the capture Worker's
  // /latest, /theme, /refresh-check etc, see captureEndpoint.ts), none
  // of which need or benefit from SW involvement anyway.
  if (new URL(event.request.url).origin !== self.location.origin) return

  const isLiveData = isLiveDataRequest(event.request.url)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache genuinely successful, non-API responses - never
        // cache an error page or any live-data endpoint as if it were a
        // static asset (see the file-level comment above). The origin
        // check that used to live here is now redundant (the early
        // return above already guarantees same-origin) but costs
        // nothing to leave as a second, explicit guard.
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
