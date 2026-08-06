import { useEffect, useState } from 'react'
import { AIRFIELD_TIMEZONE, PUBLIC_CONFIG_URL } from '../../config/publicApi'

type PilotClockMode = 'summer' | 'gmt' | 'utc'

// Real UTC offset (minutes) Europe/London is CURRENTLY observing -
// 0 in winter (GMT), 60 in summer (BST). Deliberately not a hand-rolled
// "is DST active" date calculation (the UK's BST start/end dates aren't
// a fixed calendar rule - they're the last Sunday in March/October,
// which shifts year to year) - 'shortOffset' asks the browser's own
// IANA tz database for the real answer, the same source of truth
// {timeZone: AIRFIELD_TIMEZONE} below already relies on for the digits
// themselves, so the offset and the digits can never disagree with
// each other.
function londonOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).formatToParts(date)
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = raw.match(/GMT([+-]\d+)?/)
  return match?.[1] ? Number(match[1]) * 60 : 0
}

// Pilot View header clock-mode round - three admin-selectable modes
// (DeveloperToolsPage.tsx's PilotClockModeToggle, ops_panel_state.
// pilot_clock_mode, migration 0075). 'summer' (the default, and what
// this component always did before this round existed) is Europe/
// London local time with a suffix that follows the real UK daylight-
// saving calendar each year - "BST" while it's actually in effect,
// "GMT" the rest of the year, per londonOffsetMinutes above. 'gmt'
// pins the DIGITS themselves to fixed UTC+0 year-round (never shifts
// for BST, even in summer) with a static "GMT" suffix - a genuinely
// different real-world time from 'summer' mode during BST months, not
// just a different label on the same number. 'utc' is numerically
// identical to 'gmt' (both are fixed UTC+0, no DST) - the two exist as
// separate modes because "GMT" and "Zulu/UTC" are conventionally
// different suffixes for the same underlying civil time, not because
// the clock itself differs.
function computeClock(now: Date, mode: PilotClockMode): { time: string; suffix: string } {
  if (mode === 'gmt') {
    return {
      time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Etc/GMT' }),
      suffix: 'GMT',
    }
  }
  if (mode === 'utc') {
    return {
      time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }),
      suffix: 'Z',
    }
  }
  return {
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: AIRFIELD_TIMEZONE }),
    suffix: londonOffsetMinutes(now) > 0 ? 'BST' : 'GMT',
  }
}

// Pilot View header - small extraction of Header.tsx's own clock logic
// (not imported from that file directly - Header.tsx is TV-header-
// specific, not otherwise prop-driven/reusable, and this is small
// enough that duplicating it matches this codebase's own established
// stance on small single-purpose UI bits, same reasoning
// RunwayInUseCard.tsx's own comment gives). Desktop's own Header.tsx
// clock is completely untouched by this round - pilotClockMode only
// ever reaches this one component.
export default function LiveClock(): JSX.Element {
  const [now, setNow] = useState(new Date())
  const [mode, setMode] = useState<PilotClockMode>('summer')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const value = data?.opsPanel?.pilotClockMode
        if (!cancelled && (value === 'summer' || value === 'gmt' || value === 'utc')) setMode(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { time, suffix } = computeClock(now, mode)

  // text-3xl/font-extrabold matches Header.tsx's own TV-dashboard clock
  // treatment (that file's own comment: "text-lg font-extrabold
  // text-primary sm:text-5xl") - no font-mono here, this app's standard
  // sans-serif face throughout, not a monospace/typewriter fallback.
  // Suffix is deliberately smaller and a distinct colour, not just a
  // dimmer version of the time itself - text-accent-sky-400 is the same
  // neon blue already used for CIRCUIT (RunwayWindWidget.tsx) and Club
  // Safety Notices elsewhere on this same page.
  return (
    <span className="text-3xl font-extrabold text-primary">
      {time} <span className="text-lg font-bold text-accent-sky-400">{suffix}</span>
    </span>
  )
}
