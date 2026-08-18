import { useWeather } from '../context/WeatherContext'
import { INTERNET_WEATHER_PROVIDERS } from '../services/internetProviders'
import type { WeatherProviderId } from '../types/weatherConfig'

// 'atc' removed from this table - its label now depends on usingFallback
// (see below), which this static table has no way to express. Also fixes
// a pre-existing bug this table had regardless of this feature: its type
// promised an entry for every WeatherProviderId except 'internet' (so
// 'atc' | 'ingested' | 'mock'), but 'ingested' was never actually in the
// object literal - harmless in practice since nothing here ever read
// STATUS_BY_PROVIDER.ingested, but a real, standing tsc error. Fixed in
// passing since this exact object is being rewritten for the fallback
// badge anyway, not a separate unrelated change.
const STATUS_BY_PROVIDER: Record<Exclude<WeatherProviderId, 'internet' | 'atc'>, { emoji: string; label: string }> = {
  ingested: { emoji: '🟣', label: 'THIRD-PARTY STATION' },
  mock: { emoji: '🟠', label: 'MOCK' },
}

// "Shobdon Airfield" -> "SHOBDON" - keeps the badge short (it sits in a
// fixed top-right corner alongside the clock) rather than spelling out
// a full tenant name every time.
function firstWordUpper(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? name).toUpperCase()
}

interface WeatherStatusIndicatorProps {
  // /pilot-only opt-in (PilotHeader.tsx) - drops the leading emoji/dot,
  // text label only. Defaults false so every other caller (every
  // desktop TV-dashboard template) renders exactly as it always has,
  // same convention CompassPanel's own spacious/hideReadout props
  // already use for /pilot-specific presentation tweaks to a shared
  // component.
  hideIcon?: boolean
}

export default function WeatherStatusIndicator({ hideIcon = false }: WeatherStatusIndicatorProps): JSX.Element {
  const { activeProvider, weather, config, liveDataUnavailable, usingFallback, internetProviderDisplayName } = useWeather()

  // liveDataUnavailable means the selected source's fetch failed and the
  // numbers on screen are the substituted mock fixture, not real data -
  // that must never be labelled as if it were the selected live source.
  const { emoji, label } = liveDataUnavailable
    ? { emoji: '🔴', label: 'NO LIVE READING' }
    : activeProvider === 'atc'
      ? usingFallback
        // internetProviderDisplayName (WeatherContext.tsx) is already
        // the complete display string ("Met-Office SAWS" or bare
        // "Met-Office", server-derived - see that context's own
        // comment) - rendered verbatim, no further formatting here. No
        // provider check needed here (unlike the 'internet' branch
        // below) - the ATC fallback always calls fetchInternetWeather(),
        // which is always Open-Meteo, never a different registered
        // provider.
        ? { emoji: '🔵', label: internetProviderDisplayName }
        : { emoji: '🟢', label: 'Shobdon Radio' }
      : activeProvider === 'internet'
        ? {
            emoji: '🔵',
            // Deliberately identical to the ATC-fallback badge above -
            // same label regardless of whether this source is showing
            // because of automatic fallback or a manual /config
            // selection, since it's the same underlying data either
            // way. Override only applies when Open-Meteo is the
            // actually-selected internet provider - a guard against a
            // future second INTERNET_WEATHER_PROVIDERS entry silently
            // inheriting a label that's specifically about Open-Meteo's
            // own Met-Office-sourced UK data.
            label:
              config.internet.provider === 'open-meteo'
                ? internetProviderDisplayName
                : INTERNET_WEATHER_PROVIDERS[config.internet.provider].label,
          }
        : // Weather-share round: 'ingested' via an active cross-tenant share
          // (weather.sourceTenantName only ever set in that case - see
          // WeatherData's own comment) names the actual source instead of
          // the generic "Third-Party Station" label below, which told the
          // viewer nothing. Genuinely ATC-captured data (sourceReadingType
          // 'atc_capture') gets the SAME green live-ATC treatment Shobdon's
          // own dashboard uses for its own station - it IS a live ATC
          // reading, just physically captured at another tenant's site.
          // Anything else (the source tenant's own internet/third-party
          // feed, shared onward) keeps the purple "not a physical station"
          // treatment, just naming who it's from instead of staying
          // generic - never claim ATC for a reading that isn't one.
          activeProvider === 'ingested' && weather?.sourceTenantName
          ? weather.sourceReadingType === 'atc_capture'
            ? // Shobdon-branding round: the source tenant's name is only
              // ever "Shobdon" itself today (the only tenant with real
              // physical ATC capture - see WeatherStatusIndicator's own
              // production data check), but this stays name-driven
              // rather than a blanket "always say Radio here" - a future
              // subtenant sharing a DIFFERENT physical-ATC tenant's feed
              // must keep that tenant's own "{NAME} LIVE" label
              // unchanged, not inherit Shobdon's own rebrand.
              {
                emoji: '🟢',
                label:
                  firstWordUpper(weather.sourceTenantName) === 'SHOBDON'
                    ? 'Shobdon Radio'
                    : `${firstWordUpper(weather.sourceTenantName)} LIVE`,
              }
            : // Platform weather-fallback cron round - the parent
              // (station-owning) tenant's own real feed went stale and
              // worker/src/index.ts's scheduled handler substituted a
              // Met Office/SAWS reading on its behalf (source_type
              // 'met_office_fallback', written straight into
              // weather_observations for the PARENT tenant - see that
              // handler's own comment). A subtenant reading this via
              // 'ingested' should see the exact same blue "Met-Office
              // SAWS" story the parent's own 'atc'-provider dashboard
              // shows during ITS client-side fallback, not the generic
              // purple "SHARED" treatment below, which would tell a
              // viewer nothing about why the data looks different from
              // usual.
              weather.sourceReadingType === 'met_office_fallback'
              ? { emoji: '🔵', label: internetProviderDisplayName }
              : { emoji: '🟣', label: `SHARED: ${firstWordUpper(weather.sourceTenantName)}` }
          : STATUS_BY_PROVIDER[activeProvider]

  // Colour round: text now carries the same "this is a genuine live ATC
  // reading" signal the 🟢 emoji already encoded on its own - previously
  // the label was always the same slate-200 grey regardless of state,
  // so /pilot's own header (hideIcon, text-only - see PilotHeader.tsx)
  // had no colour cue at all once the emoji was dropped. Keyed off the
  // emoji itself, not a separate `label === 'Shobdon Radio'` check, so
  // this also covers the ingested-cross-tenant-LIVE branch above (which
  // already deliberately reuses 🟢 for "genuinely live ATC data, just
  // captured at another tenant's site") without a second condition that
  // could drift out of sync with that one.
  const isLive = emoji === '🟢'

  return (
    <div className="flex items-center gap-2 text-base font-bold tracking-wide text-slate-200">
      {/* isLive gets a plain CSS-drawn dot (bg-station-live), not the 🟢
          glyph - confirmed empirically (rendered color: #c8f336 on the
          emoji and sampled the actual output pixels) that CSS `color`
          has NO effect on an emoji-presentation character; it's drawn by
          the platform's own colour-emoji font regardless. bg-station-
          live reuses the exact same --color-station-live-text variable
          the label span already uses (index.css), just via
          background-color instead of color - not a second token. Every
          OTHER state (🔴🔵🟣🟠) is untouched, still the literal emoji -
          this only replaces the one glyph that needed an exact,
          CSS-controllable colour match to the label beside it. */}
      {!hideIcon &&
        (isLive ? (
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-station-live" />
        ) : (
          <span aria-hidden="true">{emoji}</span>
        ))}
      {/* text-station-live (index.css --color-station-live-text), NOT
          text-status-good - the two used to share a token by coincidence
          (both happened to start green), but this badge answers "is this
          reading really live ATC data" while status-good answers "is
          this wind reading in the safe range", a different question that
          must be free to diverge independently. Recolouring this badge
          must never repaint RunwayWindWidget.tsx's own good-wind text.
          uppercase here (not on the div, which would also affect a
          future non-uppercase label) - scoped to isLive precisely
          because that's the exact same "Shobdon Radio"/"{STATION} LIVE"
          pair this token exists for, verified to be the ONLY two
          branches that ever set emoji to 🟢. */}
      <span className={isLive ? 'text-station-live uppercase' : undefined}>{label}</span>
    </div>
  )
}
