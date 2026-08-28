import { useEffect } from 'react'

// Kiosk blank-render watchdog round - sets a single DOM marker once React
// has genuinely mounted and painted SOMETHING, on every route (this is
// mounted in App.tsx alongside PreviewBanner/RemoteRefreshWatcher/
// UploadIndicator, same "runs once, above <Routes>" placement). The
// raspberry-pi/kiosk-watchdog.py script polls for exactly this marker via
// Chrome DevTools Protocol (Runtime.evaluate) to tell a genuinely-stuck
// blank-white Chromium paint (confirmed on real hardware: process alive,
// CPU/GPU idle, page never finishes its first render) apart from a
// healthy kiosk - a process-aliveness check alone (systemd's own
// Restart=) can't see this failure mode at all, since Chromium itself
// never crashes or exits.
//
// Deliberately app-shell-level, not gated on any specific page's own data
// having loaded (e.g. weather, media) - the diagnosed failure is
// Chromium's OWN initial paint stalling before anything appears, not this
// app being slow to fetch. Tying the marker to a page-specific data fetch
// would risk the opposite failure: a slow-but-healthy network wrongly
// read as "still blank" and restarted. Every real render outcome this
// app can produce standalone (a live tenant dashboard, TenantUnavailable,
// the login page, an admin route) is equally "not a blank white screen",
// so this fires unconditionally on mount, once, regardless of route or
// tenant-resolution outcome.
//
// dataset (not a global var) - readable from the watchdog's Runtime.
// evaluate call as `document.documentElement.dataset.kioskRenderOk`,
// and trivially inspectable from any browser's own devtools too.
export default function KioskRenderMarker(): null {
  useEffect(() => {
    document.documentElement.dataset.kioskRenderOk = 'true'
  }, [])

  return null
}
