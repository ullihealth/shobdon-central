import { useWeather } from '../../context/WeatherContext'

// Reorder round: the "WIND 260° / 9 kt" readout used to live inline
// inside PilotRunwayWindPanel, directly above the crosswind/headwind
// widget group. Pulled out into its own full-width card here so it can
// sit at the very top of the page (above Weather Summary) - same
// rounded-2xl/border/bg-panel card treatment as WeatherStatGrid's own
// <section>, per the request. Self-contained (own useWeather() call),
// same "drop in anywhere" pattern as every other Pilot View panel.
export default function PilotWindCard(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const hasWind = !!weather && !liveDataUnavailable

  return (
    <section className="flex w-full items-baseline justify-center gap-3 rounded-2xl border border-border bg-panel p-4">
      <span className="text-2xl font-bold uppercase tracking-wide text-muted-400">Wind</span>
      <span className="text-5xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
    </section>
  )
}
