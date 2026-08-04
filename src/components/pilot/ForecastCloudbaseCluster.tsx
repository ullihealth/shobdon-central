import { useWeather } from '../../context/WeatherContext'
import { estimateCloudBaseFt } from '../../utils/cloudBase'
import { useVisibilityForecast } from '../../services/visibilityForecastService'
import CloudVisibilityChart from '../CloudVisibilityChart'

// Pilot View extraction (Sections 3-4 - Forecast + Visibility, Cloudbase)
// - LeftInfoPanel.tsx's "State B" content (the Met Office forecast/
// cloud-visibility chart), permanently visible here instead of behind
// an A/B flip timer - this page has no carousels anywhere. Self-
// contained, same reasoning as WeatherStatGrid.tsx's own comment.
// CloudVisibilityChart itself is reused completely unmodified - it was
// already a standalone, self-contained component.
export default function ForecastCloudbaseCluster(): JSX.Element {
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours, fetchedAt: visibilityFetchedAt } = useVisibilityForecast()

  const cloudBaseFt =
    !weather || liveDataUnavailable || activeProvider !== 'atc' || weather.dewpoint === undefined
      ? null
      : estimateCloudBaseFt(weather.temperature, weather.dewpoint)
  const cloudBaseCapturedAt = cloudBaseFt === null ? null : (weather?.capturedAt ?? null)
  const visibilityOutlookText = visibilityHours[0]
    ? `${visibilityHours[0].category} (${visibilityHours[0].rangeLabel})`
    : 'Unavailable'

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.25em] text-muted-400">
        Forecast &amp; Visibility
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-500">Ceiling</div>
          <div className="mt-1 text-lg font-semibold text-primary">{cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-500">Visibility</div>
          <div className="mt-1 text-lg font-semibold text-primary">{visibilityOutlookText}</div>
        </div>
      </div>
      {/* CloudVisibilityChart renders h-full internally (built for the TV
          dashboard's flex-1 ancestor chain) - on this naturally-flowing
          mobile page there's no implicit height to inherit, so this
          wrapper gives it one explicitly. */}
      <div className="h-[360px]">
        <CloudVisibilityChart
          cloudBaseFt={cloudBaseFt}
          cloudBaseCapturedAt={cloudBaseCapturedAt}
          visibilityHours={visibilityHours}
          visibilityFetchedAt={visibilityFetchedAt}
        />
      </div>
    </section>
  )
}
