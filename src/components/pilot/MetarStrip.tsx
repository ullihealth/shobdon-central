import { useWeather } from '../../context/WeatherContext'
import { formatMetarString } from '../../utils/metarFormat'

// Pilot View header - the METAR-style condition summary, computed via
// utils/metarFormat.ts from the same live weather data every other
// panel on this page already reads.
export default function MetarStrip(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const metar = formatMetarString(weather, liveDataUnavailable)

  return <span className="font-mono text-xs tracking-wide text-muted-300">{metar}</span>
}
