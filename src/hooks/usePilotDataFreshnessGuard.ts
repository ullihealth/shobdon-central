import { useEffect } from 'react'
import { useWeather } from '../context/WeatherContext'

// Pilot View - two extra recovery triggers on top of WeatherContext's
// own online/visibilitychange listeners (which stay exactly as they
// are; this doesn't replace or touch them). Scoped to /pilot only, not
// WeatherContext itself, because both signals are meaningless on the
// desktop TV/kiosk dashboard: 'pageshow' is specifically about a
// standalone-mode PWA being resumed from a suspended background state
// (not a concept that applies to a browser tab that's never installed
// as an app), and a touch/tap gesture presumes a touchscreen device
// being interacted with, not an unattended always-on display.
//
// 'pageshow' (not just 'visibilitychange') because it fires more
// reliably than visibilitychange specifically when iOS restores a
// fully suspended standalone-PWA page from the background - the exact
// scenario the online/visibilitychange listeners were originally built
// for tonight, and the one most likely to have left this tab's own
// poll-loop timers frozen the whole time it was away.
//
// Touch/tap deliberately has NO inactivity debounce - checking
// dataStale on every single touch has no meaningful cost, because the
// check itself is the guard: refetchNow() only ever actually runs when
// dataStale is already true, which by construction can happen at most
// once every STALE_WARNING_THRESHOLD_MS (refetchNow's own success
// resets the clock). A debounce would only add complexity for no
// benefit here.
//
// Both listeners re-register whenever dataStale changes (it's in the
// effect's own dependency array) rather than being captured once via a
// mount-only effect - deliberate, not an oversight: a mount-once
// effect would close over dataStale's value AT MOUNT TIME forever
// (stale closure), so it would never see it flip from false to true.
// Re-running the effect on each change keeps the check's own value
// always current, at the cost of a few harmless listener re-adds over
// a session.
export function usePilotDataFreshnessGuard(): void {
  const { dataStale, refetchNow } = useWeather()

  useEffect(() => {
    function checkAndRefetchIfStale() {
      if (dataStale) refetchNow()
    }
    window.addEventListener('pageshow', checkAndRefetchIfStale)
    window.addEventListener('touchstart', checkAndRefetchIfStale, { passive: true })
    return () => {
      window.removeEventListener('pageshow', checkAndRefetchIfStale)
      window.removeEventListener('touchstart', checkAndRefetchIfStale)
    }
  }, [dataStale, refetchNow])
}
