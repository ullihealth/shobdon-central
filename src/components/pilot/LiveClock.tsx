import { useEffect, useState } from 'react'
import { AIRFIELD_TIMEZONE } from '../../config/publicApi'

// Pilot View header - small extraction of Header.tsx's own clock logic
// (not imported from that file directly - Header.tsx is TV-header-
// specific, not otherwise prop-driven/reusable, and this is small
// enough that duplicating it matches this codebase's own established
// stance on small single-purpose UI bits, same reasoning
// RunwayInUseCard.tsx's own comment gives). timeZone: AIRFIELD_TIMEZONE,
// not the viewing device's own local zone - same reasoning as every
// other clock in this app (a pilot needs the airfield's actual local
// time, not whatever zone their phone happens to be set to). No per-
// tenant timezone exists anywhere in this app's schema - this constant
// is the only one that has ever been needed.
export default function LiveClock(): JSX.Element {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })

  // text-3xl/font-extrabold matches Header.tsx's own TV-dashboard clock
  // treatment (that file's own comment: "text-lg font-extrabold
  // text-primary sm:text-5xl") - no font-mono here, this app's standard
  // sans-serif face throughout, not a monospace/typewriter fallback.
  return <span className="text-3xl font-extrabold text-primary">{timeString}</span>
}
