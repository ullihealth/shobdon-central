import type { WeatherProviderId } from '../../types/weatherConfig'
import { WEATHER_PROVIDERS } from '../../services/weatherProviders'

interface WeatherSourceSelectorProps {
  value: WeatherProviderId
  onChange: (value: WeatherProviderId) => void
}

const PROVIDER_ORDER: WeatherProviderId[] = ['atc', 'internet', 'mock']

export default function WeatherSourceSelector({ value, onChange }: WeatherSourceSelectorProps): JSX.Element {
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
        Weather Source
      </legend>
      <div className="flex flex-col gap-4">
        {PROVIDER_ORDER.map((id) => (
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
