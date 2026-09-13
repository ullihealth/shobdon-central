import { useEffect, useState } from 'react'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from '../components/CafeTicker'
import ColorField from '../components/ColorField'
import CompassPanel from '../components/CompassPanel'
import PilotTickerSlotsCards, { PILOT_TICKER_SLOT_COUNT } from '../components/media/PilotTickerSlotsCards'
import PilotTickerStyleCards from '../components/media/PilotTickerStyleCards'
import PilotThemeTemplatesCard from '../components/media/PilotThemeTemplatesCard'
import PilotPreviewFrame from '../components/pilot/PilotPreviewFrame'
import WeatherStatGrid from '../components/pilot/WeatherStatGrid'
import { DEFAULT_TICKER_STYLE } from '../components/pilot/PilotFooterTicker'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import { DEFAULT_WEATHER_CONFIG } from '../services/weatherConfigStore'
import { buildPilotThemeStyle, type PilotThemeOverride } from '../utils/pilotThemeStyle'

// Settings > Pilot Panel - configures the /pilot mobile view's own
// ticker and background, independently of the desktop dashboard's
// Dashboard Manager. Owns the draft state for both sections at this
// top level (rather than each section being self-contained like
// TickerSettingsCards.tsx/PilotTickerSlotsEditor.tsx) specifically so
// the live phone-frame preview below can read the same in-progress,
// not-yet-saved state the editors are mutating - no API round-trip for
// the preview itself, same posture as DesignPage.tsx's own live preview.
type SaveStatus = 'idle' | 'working' | 'success' | 'error'

// Compass/info-panel/text colours round - all seven new fields stay
// optional even while an override is active, independent of each other
// and of backgroundColor (unlike backgroundColor, which every toggle-on
// always seeds immediately - see DEFAULT_OVERRIDE_COLOR below). A
// tenant who's only ever set a background colour keeps every one of
// these absent, which means /pilot leaves today's hardcoded default
// exactly alone for that specific piece. Type now lives in
// src/utils/pilotThemeStyle.ts (not here) so this page's own draft
// state and PilotViewPage.tsx's real-page rendering share the exact
// same shape - see that file's own comment.
type BackgroundOverride = PilotThemeOverride

interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

function defaultTickerSlots(): TickerSlot[] {
  return Array.from({ length: PILOT_TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
}

// Same dark-navy default PilotFooterTicker.tsx's own DEFAULT_TICKER_STYLE
// already uses - a sensible starting colour the instant the toggle below
// is switched on, before the admin has picked their own.
const DEFAULT_OVERRIDE_COLOR = '#0f172a'

// /pilot's own default background (PilotViewPage.tsx's gradient classes
// resolve to roughly this at their darkest stop) - only used here as the
// preview's own fallback when no override is set, so the "off" state
// still looks like a real screen rather than transparent/white.
const SHARED_THEME_FALLBACK_COLOR = '#0f172a'

// Opaque-hex approximations of today's real (translucent rgba) defaults
// from src/index.css/CompassPanel.tsx - shown as each picker's own
// starting point ONLY (a native <input type="color"> always needs some
// hex value to display, it can't show "inherit"). Purely cosmetic: an
// untouched field is never written into backgroundOverride, so /pilot
// itself keeps reading the REAL default through unchanged, not this
// approximation - see BackgroundOverride's own comment.
const DEFAULT_COMPASS_DISC_BG_HEX = '#0f172a'
const DEFAULT_COMPASS_RING_HEX = '#3b82f6'
const DEFAULT_COMPASS_CARDINAL_HEX = '#3b82f6'
const DEFAULT_COMPASS_MARKERS_HEX = '#94a3b8'
// Same RGB as DEFAULT_COMPASS_MARKERS_HEX above (today's real literal is
// the same hue, just 85% alpha vs that one's 25%) - kept as its own
// named constant rather than reusing the other one directly, since the
// two fields are independent and this one's default could diverge from
// the tick-marks default in the future without the naming implying
// otherwise.
const DEFAULT_COMPASS_BEARING_LABELS_HEX = '#94a3b8'
const DEFAULT_PANEL_BG_HEX = '#020617'
const DEFAULT_CARD_BG_HEX = '#0f172a'
// Today's real default text colour (CompassPanel.tsx's own fill="white"
// literals, --color-text-primary's own #ffffff default) - same
// "picker's own starting point only" posture as the six above.
const DEFAULT_TEXT_COLOR_HEX = '#ffffff'
// One-click "invert" buttons, right next to the picker - Jeff's own
// framing was specifically "an option to invert to dark/black text",
// not just a bare colour picker, so these sit alongside the full
// ColorField rather than replacing it (a picker alone would make the
// exact "invert" action - go straight to a sensible dark text colour -
// take several clicks in the native colour dialog instead of one).
const LIGHT_TEXT_COLOR_HEX = '#ffffff'
const DARK_TEXT_COLOR_HEX = '#0f172a'

// Plain perceptual luminance (not full gamma-correct WCAG relative
// luminance) - adequate for a lightweight "which way should I invert"
// hint, not a precision contrast checker. Explicit instruction was not
// to build a fully automatic system, only to consider whether a
// suggestion is cheap to add alongside the real, manual control - this
// is the cheap version: a label, not an enforced/auto-applied choice.
function suggestedTextColorLabel(backgroundHex: string): 'Light' | 'Dark' {
  const r = parseInt(backgroundHex.slice(1, 3), 16) / 255
  const g = parseInt(backgroundHex.slice(3, 5), 16) / 255
  const b = parseInt(backgroundHex.slice(5, 7), 16) / 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.5 ? 'Dark' : 'Light'
}

const MOCK_CONFIG = { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'mock' as const }
const DEFAULT_GAS_PRICES: TickerGasPrices = { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: '£' }

// Split out so it can call useWeather()/useVisibilityForecast() - both
// context hooks that need a WeatherProvider ancestor, which the parent
// below provides. Pure presentational preview: every prop here is
// in-progress draft state from the parent, never independently fetched
// or saved by this component.
//
// Live-preview-accuracy round: previously only ever showed the flat
// background colour behind the ticker - none of the compass/info-panel/
// text overrides added over the last two rounds were reflected here at
// all. Investigated first: CompassPanel and WeatherStatGrid are BOTH
// already explicitly documented as self-contained, prop-less "drop in
// anywhere" components (own useWeather()/useVisibilityForecast()/
// PUBLIC_CONFIG_URL calls, no data threaded in from a parent - see
// WeatherStatGrid.tsx's own comment, "matching every other drop-in-
// anywhere panel in this codebase (CompassPanel, GasPricesPanel)"), and
// their SVG/Tailwind sizing is already fluid (CompassPanel's own
// viewBox + w-full h-full, WeatherStatGrid's plain Tailwind text sizes)
// - both already shrink cleanly to whatever width they're given, no
// separate "preview-sized" variant needed. Reusing the real components
// here instead of hand-building a simplified mock means this preview
// structurally CANNOT drift from the real page's own rendering - same
// components, same buildPilotThemeStyle call PilotViewPage.tsx itself
// uses (see src/utils/pilotThemeStyle.ts).
//
// Layout: compass + stat grid now scroll inside their own area (this
// preview frame is a small fixed-size box, taller content needs
// somewhere to go), with the ticker staying pinned as a normal flex
// child at the very bottom - not a literal position:fixed footer like
// the real page (fighting position:fixed inside a small transformed
// mockup box is its own can of worms for zero real benefit here), just
// visually equivalent: ticker always visible, everything else scrolls
// beneath it.
function PilotPanelPreview({
  tickerSlots,
  tickerStyle,
  backgroundOverride,
  safetyNotices,
  gasPrices,
}: {
  tickerSlots: TickerSlot[]
  tickerStyle: TickerStyle
  backgroundOverride: BackgroundOverride | null
  safetyNotices: SafetyNotice[]
  gasPrices: TickerGasPrices
}): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  // Same style object the real page builds (buildPilotThemeStyle),
  // falling back to a flat dark colour rather than undefined when no
  // override is set - PREVIEW-only convenience (the real page falls
  // back to its own gradient CSS classes instead, which this small
  // mockup box has no equivalent of), not something buildPilotThemeStyle
  // itself should know about.
  const themeStyle = buildPilotThemeStyle(backgroundOverride) ?? { backgroundColor: SHARED_THEME_FALLBACK_COLOR }

  return (
    <PilotPreviewFrame>
      <div className="flex h-full flex-col" style={themeStyle}>
        <div className="flex-1 overflow-y-auto px-2 pt-2">
          <CompassPanel
            spacious
            hideReadout
            initialCompassMode="runway"
            ringColor={backgroundOverride?.compassRing}
            cardinalColor={backgroundOverride?.compassCardinal}
            markersColor={backgroundOverride?.compassMarkers}
            cardinalTextColor={backgroundOverride?.textColor}
            bearingLabelColor={backgroundOverride?.compassBearingLabels}
          />
          <WeatherStatGrid />
        </div>
        <CafeTicker
          slots={tickerSlots}
          weather={weather}
          liveDataUnavailable={liveDataUnavailable}
          visibilityHours={visibilityHours}
          safetyNotices={safetyNotices}
          gasPrices={gasPrices}
          style={tickerStyle}
        />
      </div>
    </PilotPreviewFrame>
  )
}

export default function PilotPanelPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [desktopTickerSlots, setDesktopTickerSlots] = useState<TickerSlot[]>([])
  const [backgroundOverride, setBackgroundOverride] = useState<BackgroundOverride | null>(null)
  // Compass/info-panel colours round - local-only, not persisted to D1
  // (unlike DesignPage.tsx's own savedSwatches, which round-trips
  // through /api/tenant/config). This page's colour pickers are a much
  // smaller, self-contained surface than Screens Design's - a plain
  // per-session capture/reuse/clear clipboard for the six ColorField
  // instances below, reset on every fresh page load, no new backend
  // field needed for it.
  const [savedSwatches, setSavedSwatches] = useState<string[]>([])
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>(DEFAULT_TICKER_STYLE)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])
  const [gasPrices, setGasPrices] = useState<TickerGasPrices>(DEFAULT_GAS_PRICES)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/pilot-view')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.tickerSlots) && data.tickerSlots.length === PILOT_TICKER_SLOT_COUNT) {
          setTickerSlots(data.tickerSlots)
        }
        if (Array.isArray(data.desktopTickerSlots)) setDesktopTickerSlots(data.desktopTickerSlots)
        if (data.backgroundOverride) setBackgroundOverride(data.backgroundOverride)
        if (data.tickerStyle) setTickerStyle(data.tickerStyle)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Read-only, for the preview's own "notice" slot content - same
  // /api/tenant/ops-panel endpoint PilotTickerSlotsCards already uses
  // for its dropdown (owner/admin/atc/cafe allowed), fetched separately
  // here rather than threaded up from that component, to keep the two
  // concerns (editing UI vs. preview data) independent. Gas prices
  // deliberately NOT fetched for the preview - /api/tenant/gas-prices
  // only allows owner/admin/media, not atc, and this page must work for
  // atc too; a "fuel" slot in the preview just reads blank (CafeTicker's
  // own graceful-degradation for all-null prices) rather than widening
  // an unrelated endpoint's role list for one preview edge case.
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/ops-panel')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.safetyNotices)) setSafetyNotices(data.safetyNotices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Same capture/clear shape as DesignPage.tsx's own handleCaptureSwatch/
  // handleClearSwatch, minus the PUT - see savedSwatches' own comment for
  // why this stays local-only.
  function handleCaptureSwatch(hex: string) {
    if (savedSwatches.includes(hex) || savedSwatches.length >= 5) return
    setSavedSwatches((prev) => [...prev, hex])
  }

  function handleClearSwatch(hex: string) {
    setSavedSwatches((prev) => prev.filter((s) => s !== hex))
  }

  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch('/api/tenant/pilot-view', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickerSlots, backgroundOverride, tickerStyle }),
      })
      setSaveStatus(response.ok ? 'success' : 'error')
    } catch {
      setSaveStatus('error')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-bold text-primary">Pilot Panel</h1>
      <p className="mt-2 text-sm text-muted-400">
        Configure the /pilot mobile view's ticker and background, independently of the desktop dashboard.
      </p>

      {loading ? (
        <p className="mt-6 text-xs text-muted-500">Loading…</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-6">
            <PilotTickerSlotsCards slots={tickerSlots} onChange={setTickerSlots} desktopTickerSlots={desktopTickerSlots} />

            <PilotTickerStyleCards style={tickerStyle} onChange={setTickerStyle} />

            <PilotThemeTemplatesCard theme={backgroundOverride} onApply={setBackgroundOverride} />

            <section className="rounded-2xl border border-border bg-panel p-6">
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Pilot Background</div>
              <p className="mt-1 text-xs text-muted-500">
                By default /pilot uses the same shared colour theme as the desktop dashboard (Screens Design). Turn this
                on to give /pilot its own independent background colour instead.
              </p>
              <label className="mt-4 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!backgroundOverride}
                  onChange={(event) =>
                    setBackgroundOverride(event.target.checked ? { backgroundColor: DEFAULT_OVERRIDE_COLOR } : null)
                  }
                  className="h-4 w-4 accent-accent-sky-500"
                />
                <span className="text-sm font-semibold text-slate-200">Use independent mobile background</span>
              </label>
              {backgroundOverride && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="color"
                    value={backgroundOverride.backgroundColor}
                    onChange={(event) => setBackgroundOverride({ ...backgroundOverride, backgroundColor: event.target.value })}
                    className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <span className="text-xs text-muted-500">{backgroundOverride.backgroundColor}</span>
                </div>
              )}
            </section>

            {/* Compass/info-panel colours round - both sections only
                render while the independent background is on, same
                gating as the background colour field itself immediately
                above (there's nothing to theme independently of the
                desktop dashboard until that's switched on). Each
                ColorField stays genuinely optional in saved state - an
                untouched field is never written into backgroundOverride
                at all (see that interface's own comment), the
                DEFAULT_*_HEX constants below are only what the picker
                itself displays as a starting point. toHex is the
                identity function, not DesignPage.tsx's own rgbaToHex -
                every value here already round-trips as a plain #rrggbb
                hex string straight from the native colour input, never
                an rgba() one. */}
            {backgroundOverride && (
              <section className="rounded-2xl border border-border bg-panel p-6">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Compass Colours</div>
                <p className="mt-1 text-xs text-muted-500">
                  Recolour the compass disc, outer ring, cardinal-point lines, degree tick marks, and degree numbers
                  on /pilot. Leave any of these unset to keep today's default dark navy/blue look for that part.
                </p>
                <div className="mt-3 flex flex-col gap-1">
                  <ColorField
                    label="Disc background"
                    value={backgroundOverride.compassDiscBg ?? DEFAULT_COMPASS_DISC_BG_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, compassDiscBg: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.compassDiscBg ?? DEFAULT_COMPASS_DISC_BG_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                  <ColorField
                    label="Outer ring"
                    value={backgroundOverride.compassRing ?? DEFAULT_COMPASS_RING_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, compassRing: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.compassRing ?? DEFAULT_COMPASS_RING_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                  <ColorField
                    label="Cardinal lines"
                    value={backgroundOverride.compassCardinal ?? DEFAULT_COMPASS_CARDINAL_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, compassCardinal: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.compassCardinal ?? DEFAULT_COMPASS_CARDINAL_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                  <ColorField
                    label="Degree tick marks"
                    value={backgroundOverride.compassMarkers ?? DEFAULT_COMPASS_MARKERS_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, compassMarkers: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.compassMarkers ?? DEFAULT_COMPASS_MARKERS_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                  {/* Degree-number labels round - a genuinely separate
                      element from "Degree tick marks" above (the small
                      lines around the ring) - this is the "24"/"30"/"33"
                      NUMBER text just inside them. Reported by Jeff after
                      finding no way to change the numbers specifically -
                      renamed the tick-marks field above from its old
                      plain "Degree markers" label at the same time, so
                      the two are no longer easy to conflate the way this
                      one was. */}
                  <ColorField
                    label="Degree numbers"
                    value={backgroundOverride.compassBearingLabels ?? DEFAULT_COMPASS_BEARING_LABELS_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, compassBearingLabels: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.compassBearingLabels ?? DEFAULT_COMPASS_BEARING_LABELS_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                </div>
              </section>
            )}

            {backgroundOverride && (
              <section className="rounded-2xl border border-border bg-panel p-6">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Info Panel Colours</div>
                <p className="mt-1 text-xs text-muted-500">
                  Recolour the QNH/QFE/Cloud Base/Visibility boxes (and every other panel/card on /pilot - header, wind
                  card, notices). Leave either unset to keep today's default dark navy look.
                </p>
                <div className="mt-3 flex flex-col gap-1">
                  <ColorField
                    label="Panel background"
                    value={backgroundOverride.panelBg ?? DEFAULT_PANEL_BG_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, panelBg: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.panelBg ?? DEFAULT_PANEL_BG_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                  <ColorField
                    label="Card background"
                    value={backgroundOverride.cardBg ?? DEFAULT_CARD_BG_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, cardBg: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.cardBg ?? DEFAULT_CARD_BG_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                </div>
              </section>
            )}

            {backgroundOverride && (
              <section className="rounded-2xl border border-border bg-panel p-6">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Text Colour</div>
                <p className="mt-1 text-xs text-muted-500">
                  The wind box, compass cardinal letters (N/S/E/W), and QNH/QFE/Cloud Base/Visibility values on
                  /pilot. Invert to dark text if you've picked a light background colour above. Leave unset to keep
                  today's default white text.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setBackgroundOverride({ ...backgroundOverride, textColor: LIGHT_TEXT_COLOR_HEX })}
                    className="rounded-lg border border-border bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500"
                  >
                    Light text
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackgroundOverride({ ...backgroundOverride, textColor: DARK_TEXT_COLOR_HEX })}
                    className="rounded-lg border border-border bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500"
                  >
                    Dark text
                  </button>
                  <span className="text-xs text-muted-500">
                    Suggested for your background: {suggestedTextColorLabel(backgroundOverride.backgroundColor)}
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <ColorField
                    label="Text colour"
                    value={backgroundOverride.textColor ?? DEFAULT_TEXT_COLOR_HEX}
                    onChange={(value) => setBackgroundOverride({ ...backgroundOverride, textColor: value })}
                    toHex={(value) => value}
                    savedSwatches={savedSwatches}
                    onCaptureSwatch={() => handleCaptureSwatch(backgroundOverride.textColor ?? DEFAULT_TEXT_COLOR_HEX)}
                    onClearSwatch={handleClearSwatch}
                  />
                </div>
              </section>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saveStatus === 'working'}
                className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveStatus === 'working' ? 'Saving…' : 'Save Pilot Panel'}
              </button>
              {saveStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
              {saveStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save.</span>}
            </div>
          </div>

          <div className="lg:sticky lg:top-6 lg:self-start">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-500">
              Live preview
            </p>
            <WeatherProvider forcedConfig={MOCK_CONFIG}>
              <PilotPanelPreview
                tickerSlots={tickerSlots}
                tickerStyle={tickerStyle}
                backgroundOverride={backgroundOverride}
                safetyNotices={safetyNotices}
                gasPrices={gasPrices}
              />
            </WeatherProvider>
          </div>
        </div>
      )}
    </div>
  )
}
