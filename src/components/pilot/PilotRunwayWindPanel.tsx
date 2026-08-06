import { useEffect, useState } from 'react'
import { useWeather } from '../../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import type { RunwayGroup } from '../../types/clubProfile'
import RunwayWindWidget, { type WindsockThresholds } from '../RunwayWindWidget'

interface ConfigState {
  runwayGroups: RunwayGroup[]
  activeRunwayEnd: string
  circuitDirection: string
  reverseCompassNeedle: boolean
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

// Confirmed /pilot production round: sits directly below the compass
// (CompassPanel with hideReadout - see that component's own comment)
// on Pilot View mobile only, replacing its old Headwind/Crosswind/Trend
// text rows - the desktop dashboard still renders CompassPanel's full
// readout and is untouched (a separate call site, this file isn't
// imported there). Self-fetches PUBLIC_CONFIG_URL, same established
// pattern every other self-contained /pilot panel already uses
// (RunwayInUseCard, WeatherStatGrid) rather than threading props down
// from PilotViewPage - real production data, not the
// /runway-widget-test prototype route's own (identical) fetch, which
// stays live and unrelated to this file. refreshSignal (PilotViewPage's
// 60s tick) triggers a re-fetch without remounting, same as
// RunwayInUseCard's own prop of the same name.
//
// Standalone "Wind" reading restored above the widget (round 2 - it was
// dropped as redundant with the compass's own centre label, but that
// label reads small/secondary next to a full instrument; this is meant
// to be the single most prominent number on the page, distinct from
// that). mt-8/mb-8 on this block are deliberate, not incidental -
// generous, visually separate gaps from both the compass above and the
// Crosswind/Headwind row below, on top of (not instead of) the page's
// own shared gap-4 between sibling sections. `bare` renders the widget
// itself full-width with no card/border, directly on the page
// background, same treatment as the compass above it - see
// RunwayWindWidget.tsx's own comment.
//
// reverseCompassNeedle (ops_panel_state, /developertools) IS threaded
// through to RunwayWindWidget below - correcting an earlier mistake in
// this exact comment, which claimed the flag only ever affects
// CompassPanel's own arrow SVG rotation. It doesn't: CompassPanel also
// applies it to activeRunwayHeading before calculateWindComponents,
// because the flag means the tenant's stored runway heading data is
// itself known to be backwards for this physical station - genuinely
// required for a correct headwind/crosswind result, not a cosmetic-only
// correction. Traced and fixed after Shobdon's own real production data
// (reverseCompassNeedle=true) produced an inverted Headwind/Tailwind
// colour here while CompassPanel showed the correct one for the same
// live wind - the two components were applying different corrections to
// the same underlying heading.
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
          reverseCompassNeedle: !!data.opsPanel?.reverseCompassNeedle,
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
  if (configuredGroups.length === 0) return null

  const hasWind = !!weather && !liveDataUnavailable

  return (
    // mb-8 here (not on the last child inside) is what creates the
    // breathing room before NOTAMs below - on top of the page's own
    // shared gap-4 between sibling sections, same "layered, not
    // instead-of" spacing approach as the Wind block's own mt-8/mb-8.
    <div className="mb-8 flex w-full flex-col items-center">
      <div className="mb-8 mt-8 flex items-baseline gap-3">
        <span className="text-2xl font-bold uppercase tracking-wide text-muted-400">Wind</span>
        <span className="text-5xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
      </div>
      <div className="flex w-full flex-col items-center gap-4">
        {configuredGroups.map((group) => (
          <RunwayWindWidget
            key={group.id}
            group={group}
            activeEnd={config.activeRunwayEnd}
            circuitDirection={config.circuitDirection}
            reverseCompassNeedle={config.reverseCompassNeedle}
            weather={weather}
            liveDataUnavailable={liveDataUnavailable}
            windsock={config.windsock}
            bare
          />
        ))}
      </div>
    </div>
  )
}
