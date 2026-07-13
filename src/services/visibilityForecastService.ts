import { useEffect, useState } from 'react'
import { VISIBILITY_FORECAST_URL } from '../config/publicApi'

export interface VisibilityForecast {
  forecastForUtc: string
  visibilityM: number
  category: string
  rangeLabel: string
  fetchedAt: string
}

type VisibilityForecastResponse = ({ available: true } & VisibilityForecast) | { available: false }

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

export function useVisibilityForecast(): { forecast: VisibilityForecast | null; loading: boolean } {
  const [forecast, setForecast] = useState<VisibilityForecast | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch(VISIBILITY_FORECAST_URL)
        const body = (await response.json()) as VisibilityForecastResponse
        if (cancelled) return
        setForecast(body.available ? body : null)
      } catch {
        // Network failure reaching our own route - same "unavailable" as
        // a well-formed { available: false } response, never a stale
        // value left on screen from a previous successful poll.
        if (!cancelled) setForecast(null)
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

  return { forecast, loading }
}
