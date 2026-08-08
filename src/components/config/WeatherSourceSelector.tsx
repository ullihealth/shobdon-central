import type { WeatherProviderId } from '../../types/weatherConfig'
import { WEATHER_PROVIDERS } from '../../services/weatherProviders'

interface WeatherSourceSelectorProps {
  value: WeatherProviderId
  onChange: (value: WeatherProviderId) => void
  // No longer hides "ATC Live Weather Station" for a tenant with no
  // physical PC2/ATC hardware - see the round that changed this from a
  // filter to a disabled-option treatment. Hiding it entirely made a
  // temporary "hasPhysicalAtc read false" state (a slow/failed fetch on
  // THIS page's own separate TENANT_CONFIG_URL call, or - unrelated to
  // this page - a real ATC/fallback outage elsewhere on the dashboard
  // being mistaken for this) look identical to "this tenant genuinely
  // has no ATC option at all," with no way to tell the two apart or
  // even see the option existed. Always rendered now; only its
  // selectability/styling changes.
  hasPhysicalAtc: boolean
}

const PROVIDER_ORDER: WeatherProviderId[] = ['atc', 'internet', 'ingested', 'mock']

export default function WeatherSourceSelector({ value, onChange, hasPhysicalAtc }: WeatherSourceSelectorProps): JSX.Element {
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
        Weather Source
      </legend>
      <div className="flex flex-col gap-4">
        {PROVIDER_ORDER.map((id) => {
          // Still selectable if it's already the stored choice (e.g. the
          // flag read false transiently, or got flipped false after the
          // fact) - same "don't strand an existing selection" posture
          // the old filter-based version had, just expressed as
          // disabled-not-hidden now.
          const atcDisabled = id === 'atc' && !hasPhysicalAtc && value !== 'atc'
          return (
            <label
              key={id}
              className={`flex items-center gap-3 text-lg text-white ${
                atcDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="weather-source"
                value={id}
                checked={value === id}
                disabled={atcDisabled}
                onChange={() => onChange(id)}
                className="h-4 w-4 accent-sky-500"
              />
              {WEATHER_PROVIDERS[id].label}
              {atcDisabled && <span className="text-xs text-muted-400">— Unavailable</span>}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
