import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { frontmanPlugin } from '@frontman-ai/vite';
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    frontmanPlugin({ host: 'api.frontman.sh' }), react(),
    // Kiosk offline-resilience round - lets a Pi kiosk render its last-
    // successfully-loaded dashboard instead of a blank/error page when
    // there's no internet at boot (a real, deliberate scenario - Jeff's
    // own network is off overnight, and small-venue routers/ISPs are
    // realistically no different). App-shell (JS/CSS/HTML) ONLY - see
    // globPatterns below - never the media pipeline (videoDownloadManager.ts
    // already owns byte-verified caching for carousel content, a
    // completely separate mechanism this must not duplicate or compete
    // with) and never API/dynamic data (weather, refresh-check, tenant
    // config - these must fail cleanly when genuinely offline, never be
    // served stale from a cache pretending to be current, so nothing
    // here adds runtimeCaching for them at all).
    //
    // registerType: 'prompt' (NOT 'autoUpdate') is load-bearing, not a
    // style choice - autoUpdate calls updateServiceWorker(true)
    // automatically the instant a new build is detected, which reloads
    // the page immediately with none of RemoteRefreshWatcher.tsx's own
    // safety gating (isCaptureInProgress, its debounced poll). That would
    // be a SECOND, independent, uncoordinated reload trigger living
    // alongside the one this app already has and already tested today -
    // exactly the kind of thing that produces hard-to-reproduce bugs.
    // 'prompt' only sets a flag and waits to be told when it's safe;
    // src/services/serviceWorkerUpdate.ts wires that flag into
    // RemoteRefreshWatcher.tsx's existing reload pathway instead of
    // creating a parallel one. injectRegister: false because that file
    // also calls registerSW() itself, explicitly, with its own callbacks -
    // letting the plugin ALSO auto-inject its own registration script
    // would register the same worker twice from two uncoordinated call
    // sites.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        // public/pilot-sw.js is a completely separate, hand-written service
        // worker for the unrelated Pilot View feature (registered by
        // usePilotServiceWorker.ts with its own explicit { scope: '/pilot' }
        // - see that file). It's a plain .js file in public/, so Vite copies
        // it into dist/ untouched and the globPattern above would otherwise
        // sweep it into THIS precache manifest as if it were a normal
        // app-shell asset. It isn't one - it's another service worker's own
        // install script, never fetched by a page load, and precaching it
        // here would wrongly couple two intentionally-independent features.
        // No functional conflict either way (the browser's own longest-
        // matching-scope rule already keeps pilot-sw.js in sole control of
        // /pilot, and its own script fetch bypasses any controlling SW's
        // fetch handler by spec) - this exclusion is purely so this
        // manifest accurately reflects "app shell, and only app shell".
        globIgnores: ['pilot-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022'
  }
})
