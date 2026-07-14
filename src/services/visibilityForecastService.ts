import { useEffect, useState } from 'react'
import { VISIBILITY_FORECAST_URL } from '../config/publicApi'

export interface VisibilityHour {
  forecastForUtc: string
  visibilityM: number
  category: string
  rangeLabel: string
  // Met Office's own 0-30 Significant Weather Code - may be absent on an
  // otherwise-valid hour (see visibility-forecast.ts), so the Cloud/
  // Visibility Chart's weather-type icon strip should treat a missing
  // code as "nothing to show for this hour", not fall back to a fake one.
  weatherCode?: number
}

interface VisibilityForecastData {
  hours: VisibilityHour[]
  fetchedAt: string
}

type VisibilityForecastResponse = ({ available: true } & VisibilityForecastData) | { available: false }

// Independent of WeatherContext's own polling entirely - this hook owns
// its own fetch/interval against a separate route
// (functions/api/public/[tenant]/visibility-forecast.ts), so a failure
// here can never affect Wind/QNH/Temperature/Cloud Base or anything else
// on the dashboard. 15 minutes is deliberately much slower than the
// weather panel's polling: the upstream Met Office forecast itself only
// changes roughly once an hour (that route's own KV cache has a 60-minute
// TTL), so polling faster than that would just re-request the same cached
// answer.
const POLL_INTERVAL_MS = 15 * 60 * 1000

// hours[] is ordered nearest-hour first - the existing "Visibility
// Outlook" card reads hours[0] (same single value it always showed); the
// Cloud/Visibility Chart's trend strip uses the rest. An empty array
// (never populated, or a genuine upstream failure) is what both
// consumers treat as "unavailable" - there's no separate error flag to
// thread through.
export function useVisibilityForecast(): { hours: VisibilityHour[]; fetchedAt: string | null; loading: boolean } {
  const [hours, setHours] = useState<VisibilityHour[]>([])
  // When Met Office was actually called (server-side, then cached) - not
  // when this browser polled the route. Null whenever hours is empty, so
  // consumers never show a "Last updated" line with no real data behind it.
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch(VISIBILITY_FORECAST_URL)
        const body = (await response.json()) as VisibilityForecastResponse
        if (cancelled) return
        // Array.isArray, not just body.available - defensive second layer
        // against a malformed/unexpected response shape (the route itself
        // also guards its cache read, but a consumer should never trust a
        // network response enough to skip this and risk `hours[0]`
        // crashing the whole panel below).
        const validHours = body.available && Array.isArray(body.hours) ? body.hours : []
        setHours(validHours)
        setFetchedAt(validHours.length > 0 && body.available ? body.fetchedAt : null)
      } catch {
        // Network failure reaching our own route - same "unavailable" as
        // a well-formed { available: false } response, never a stale
        // value left on screen from a previous successful poll.
        if (!cancelled) {
          setHours([])
          setFetchedAt(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = window.setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  return { hours, fetchedAt, loading }
}
