import { useEffect, useState } from 'react'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import type { RunwayGroup } from '../types/clubProfile'
import RunwayWindWidget, { type WindsockThresholds } from '../components/RunwayWindWidget'

interface ConfigState {
  runwayGroups: RunwayGroup[]
  activeRunwayEnd: string
  // Same opsPanel.circuitDirection RunwayInUseCard.tsx/RightInfoPanel.tsx
  // already read - one airfield-wide value (ops_panel_state), not
  // per-runway, same reasoning as activeRunwayEnd above.
  circuitDirection: string
  windsock: WindsockThresholds
}

const DEFAULT_WINDSOCK: WindsockThresholds = { fullKt: 15, mediumKt: 6 }

// A runway "counts" for this test page once BOTH end identifiers are
// filled in - matches RunwaysPage.tsx's own createBlankGroup() starting
// both as '', so a freshly-added-but-not-yet-configured second runway
// (the "+ Add another runway" case) doesn't flash an empty/"--" widget
// before an admin has actually entered its details.
function isConfigured(group: RunwayGroup): boolean {
  return group.endAIdentifier.trim() !== '' && group.endBIdentifier.trim() !== ''
}

// Reads live weather via useWeather() - must render inside
// <WeatherProvider>, which is why this is split out from the page
// component below rather than calling the hook directly there.
function WidgetGrid({ config }: { config: ConfigState }): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const configuredGroups = config.runwayGroups.filter(isConfigured)
  const hasWind = !!weather && !liveDataUnavailable

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Standalone "Wind" reading, page-level (not per-widget) - one
          weather station serves every runway, so this is shown once
          above the whole grid rather than duplicated inside each
          RunwayWindWidget. Headwind/Crosswind/Trend used to also live in
          this same text-row style (CompassPanel.tsx's own readout, still
          live on /pilot and the dashboard today) - this page previews
          what that row looks like trimmed down to Wind only, WITHOUT
          touching the real CompassPanel component or its compass-rose
          graphic, since neither /pilot nor the dashboard are in scope
          for this prototype round. Say if you actually wanted the real
          compass instrument included here too, not just this text line. */}
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold uppercase tracking-wide text-muted-400">Wind</span>
        <span className="text-5xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
      </div>

      {configuredGroups.length === 0 ? (
        <p className="text-sm text-muted-400">No fully-configured runway found on /runways yet.</p>
      ) : (
        <div className="flex flex-wrap justify-center gap-8">
          {configuredGroups.map((group) => (
            <RunwayWindWidget
              key={group.id}
              group={group}
              activeEnd={config.activeRunwayEnd}
              circuitDirection={config.circuitDirection}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              windsock={config.windsock}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Standalone, unlinked prototype route (see App.tsx's own route comment)
// for RunwayWindWidget.tsx - deliberately not reachable from any nav, not
// wired into /pilot or the dashboard. Self-fetches PUBLIC_CONFIG_URL the
// same way every other public dashboard piece does (Host-resolved tenant
// identity, no auth) so it reflects whatever's actually staged/published
// on /runways for the tenant this URL is visited on.
export default function RunwayWidgetTestPage(): JSX.Element {
  const [config, setConfig] = useState<ConfigState | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setConfig({
          runwayGroups: Array.isArray(data.runwayGroups) ? data.runwayGroups : [],
          activeRunwayEnd: data.opsPanel?.activeRunwayEnd ?? '',
          circuitDirection: data.opsPanel?.circuitDirection ?? 'left',
          windsock: { fullKt: data.windsock?.fullKt ?? DEFAULT_WINDSOCK.fullKt, mediumKt: data.windsock?.mediumKt ?? DEFAULT_WINDSOCK.mediumKt },
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Runway / Wind Widget — Prototype</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Standalone test page, not linked from any nav and not wired into /pilot or the dashboard. Reflects
          whatever's currently published on /runways for this tenant.
        </p>
        {!config ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <WeatherProvider>
            <WidgetGrid config={config} />
          </WeatherProvider>
        )}
      </div>
    </div>
  )
}
