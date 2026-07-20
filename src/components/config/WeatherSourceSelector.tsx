import type { WeatherProviderId } from '../../types/weatherConfig'
import { WEATHER_PROVIDERS } from '../../services/weatherProviders'

interface WeatherSourceSelectorProps {
  value: WeatherProviderId
  onChange: (value: WeatherProviderId) => void
  // Hides the "ATC Live Weather Station" option for a tenant with no
  // physical PC2/ATC hardware capturing that data - there'd be nothing
  // behind the selection. Still shown if the tenant's stored config is
  // already 'atc' (e.g. the flag got flipped false after the fact), so
  // an existing selection stays visible/switchable rather than
  // disappearing out from under them.
  hasPhysicalAtc: boolean
}

const PROVIDER_ORDER: WeatherProviderId[] = ['atc', 'internet', 'ingested', 'mock']

export default function WeatherSourceSelector({ value, onChange, hasPhysicalAtc }: WeatherSourceSelectorProps): JSX.Element {
  const visibleProviders = PROVIDER_ORDER.filter((id) => id !== 'atc' || hasPhysicalAtc || value === 'atc')
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
        Weather Source
      </legend>
      <div className="flex flex-col gap-4">
        {visibleProviders.map((id) => (
          <label key={id} className="flex cursor-pointer items-center gap-3 text-lg text-white">
            <input
              type="radio"
              name="weather-source"
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="h-4 w-4 accent-sky-500"
            />
            {WEATHER_PROVIDERS[id].label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
