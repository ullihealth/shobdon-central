import { useEffect, useState } from 'react'
import { useWeather } from '../../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import type { RunwayGroup } from '../../types/clubProfile'
import RunwayWindWidget, { type WindsockThresholds } from '../RunwayWindWidget'

interface ConfigState {
  runwayGroups: RunwayGroup[]
  activeRunwayEnd: string
  circuitDirection: string
  windsock: WindsockThresholds
}

const DEFAULT_WINDSOCK: WindsockThresholds = { fullKt: 15, mediumKt: 6 }

// A runway "counts" once both end identifiers are filled in - same
// gate RunwayWidgetTestPage.tsx (the original prototype route, still
// live at /runway-widget-test) already uses, so a freshly-added-but-
// not-yet-configured second runway on /runways never flashes an empty
// "--" widget here either.
function isConfigured(group: RunwayGroup): boolean {
  return group.endAIdentifier.trim() !== '' && group.endBIdentifier.trim() !== ''
}

// Confirmed /pilot production round: replaces CompassPanel in this exact
// spot on Pilot View mobile only - the desktop dashboard still renders
// the real compass and is untouched (a separate call site, this file
// isn't imported there). Self-fetches PUBLIC_CONFIG_URL, same
// established pattern every other self-contained /pilot panel already
// uses (RunwayInUseCard, WeatherStatGrid) rather than threading props
// down from PilotViewPage - real production data, not the
// /runway-widget-test prototype route's own (identical) fetch, which
// stays live and unrelated to this file. refreshSignal (PilotViewPage's
// 60s tick) triggers a re-fetch without remounting, same as
// RunwayInUseCard's own prop of the same name.
//
// Owns the single, page-level "Wind" reading shown above the widget -
// Headwind/Crosswind/Trend used to also render as flat text rows here
// (CompassPanel's own readout, which this component fully replaces on
// this route), but now live inside RunwayWindWidget itself instead, so
// only Wind remains as a standalone line. No compass rose graphic
// either - this widget doesn't have one, replacing that too, per the
// approved plan.
//
// reverseCompassNeedle (ops_panel_state, /developertools) is NOT applied
// here, deliberately, not by oversight - it only ever corrects
// CompassPanel's own arrow SVG's visual ROTATION, never the underlying
// headwind/crosswind maths (calculateWindComponents, shared by both
// components unmodified). RunwayWindWidget's own arrow never rotates -
// colour only - so there is nothing for that flag to correct here even
// though it's currently true for Shobdon.
export default function PilotRunwayWindPanel({ refreshSignal }: { refreshSignal?: number }): JSX.Element | null {
  const { weather, liveDataUnavailable } = useWeather()
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
  }, [refreshSignal])

  if (!config) return null
  const configuredGroups = config.runwayGroups.filter(isConfigured)
  const hasWind = !!weather && !liveDataUnavailable

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold uppercase tracking-wide text-muted-400">Wind</span>
        <span className="text-2xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
      </div>

      {configuredGroups.length > 0 && (
        <div className="flex flex-col items-center gap-4">
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
