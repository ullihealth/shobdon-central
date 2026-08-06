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

  // No outer section/title, and no Ceiling/Visibility callout cards any
  // more - PilotViewPage.tsx now wraps this in PilotCollapsibleSection
  // (which owns the card chrome/title), and the two callouts were
  // dropped outright: both duplicate values WeatherStatGrid already
  // shows in the always-visible Weather Summary card above (Cloud Base
  // and Visibility Outlook), so keeping them here too was redundant,
  // not a second useful view of the same numbers. visibilityOutlookText
  // is gone with them - nothing else in this component reads it now.
  // CloudVisibilityChart itself (the actual forecast content this
  // section exists for) is untouched - still reused unmodified, still
  // wrapped in an explicit height (it renders h-full internally, built
  // for the TV dashboard's flex-1 ancestor chain, which this naturally-
  // flowing mobile page has no equivalent of).
  return (
    <div className="h-[360px]">
      <CloudVisibilityChart
        cloudBaseFt={cloudBaseFt}
        cloudBaseCapturedAt={cloudBaseCapturedAt}
        visibilityHours={visibilityHours}
        visibilityFetchedAt={visibilityFetchedAt}
        largeText
      />
    </div>
  )
}
