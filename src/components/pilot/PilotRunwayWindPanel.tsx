import { useEffect, useState } from 'react'
import { useWeather } from '../../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import type { RunwayGroup } from '../../types/clubProfile'
import RunwayWindWidget, { type WindsockThresholds } from '../RunwayWindWidget'
import { DEFAULT_ARROW_THRESHOLDS } from '../../utils/windCalculations'
import type { ArrowColourThresholds } from '../../utils/windCalculations'

interface ConfigState {
  runwayGroups: RunwayGroup[]
  activeRunwayEnd: string
  circuitDirection: string
  reverseCompassNeedle: boolean
  windsock: WindsockThresholds
  arrowThresholds: ArrowColourThresholds
}

const DEFAULT_WINDSOCK: WindsockThresholds = { band2Kt: 3, band3Kt: 7, band4Kt: 11, band5Kt: 15 }

// A runway "counts" once both end identifiers are filled in - same
// gate RunwayWidgetTestPage.tsx (the original prototype route, still
// live at /runway-widget-test) already uses, so a freshly-added-but-
// not-yet-configured second runway on /runways never flashes an empty
// "--" widget here either.
function isConfigured(group: RunwayGroup): boolean {
  return group.endAIdentifier.trim() !== '' && group.endBIdentifier.trim() !== ''
}

// Confirmed /pilot production round: renders the crosswind/headwind/
// windsock/runway/circuit/trend widget group only - the standalone
// "WIND" readout that used to live inline at the top of this component
// has moved out into its own full-width card (PilotWindCard.tsx, see
// that file's own comment) as of the reorder round, so it can sit
// higher up the page, above Weather Summary. Self-fetches
// PUBLIC_CONFIG_URL, same established pattern every other self-
// contained /pilot panel already uses (RunwayInUseCard, WeatherStatGrid)
// rather than threading props down from PilotViewPage - real production
// data, not the /runway-widget-test prototype route's own (identical)
// fetch, which stays live and unrelated to this file. refreshSignal
// (PilotViewPage's 60s tick) triggers a re-fetch without remounting,
// same as RunwayInUseCard's own prop of the same name. `bare` renders
// the widget itself full-width with no card/border, directly on the
// page background, matching the rest of this page's non-card sections -
// see RunwayWindWidget.tsx's own comment.
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
          windsock: {
            band2Kt: data.windsock?.band2Kt ?? DEFAULT_WINDSOCK.band2Kt,
            band3Kt: data.windsock?.band3Kt ?? DEFAULT_WINDSOCK.band3Kt,
            band4Kt: data.windsock?.band4Kt ?? DEFAULT_WINDSOCK.band4Kt,
            band5Kt: data.windsock?.band5Kt ?? DEFAULT_WINDSOCK.band5Kt,
          },
          arrowThresholds: {
            tailwindKt: data.arrowThresholds?.tailwindKt ?? DEFAULT_ARROW_THRESHOLDS.tailwindKt,
            crosswindKt: data.arrowThresholds?.crosswindKt ?? DEFAULT_ARROW_THRESHOLDS.crosswindKt,
            headwindKt: data.arrowThresholds?.headwindKt ?? DEFAULT_ARROW_THRESHOLDS.headwindKt,
          },
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

  return (
    // mb-8 here (not on the last child inside) is what creates the
    // breathing room before the compass below - on top of the page's
    // own shared gap-4 between sibling sections, same "layered, not
    // instead-of" spacing approach used throughout this page.
    <div className="mb-8 flex w-full flex-col items-center">
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
          arrowThresholds={config.arrowThresholds}
          bare
        />
      ))}
    </div>
  )
}
