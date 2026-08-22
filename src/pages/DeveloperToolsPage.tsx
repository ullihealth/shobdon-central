import { useEffect, useState } from 'react'
import InvestigateStation from '../components/config/InvestigateStation'
import { PLATFORM_GYROPEDIA_INTERVAL_URL, PLATFORM_LANDING_MODE_URL } from '../config/publicApi'

const DEVELOPER_SETTINGS_URL = '/api/tenant/developer-settings'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type LandingMode = 'coming_soon' | 'live'
const GYROPEDIA_INTERVAL_OPTIONS = [5, 15, 30] as const
type GyropediaIntervalMinutes = (typeof GYROPEDIA_INTERVAL_OPTIONS)[number]

// Switches the PUBLIC marketing domain (airfieldcentral.com root only -
// functions/api/public/landing-mode.ts, read by RootRoute.tsx) between
// the real LandingPage and a placeholder ComingSoonPage, without a
// code deploy - a persisted flag (platform_settings, migration 0062),
// not a build-time toggle. Every tenant subdomain is completely
// unaffected regardless of this value; DashboardPage's own render path
// never consults it. Placed at the top of this page per instruction -
// the highest-consequence, most-likely-to-be-checked-first control
// here, since it changes what the public sees business-wide.
function LandingModeToggle(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<LandingMode>('coming_soon')
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(PLATFORM_LANDING_MODE_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.mode === 'live') setMode('live')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSetMode(next: LandingMode) {
    if (next === mode) return
    const previous = mode
    setMode(next)
    setStatus('saving')
    try {
      const response = await fetch(PLATFORM_LANDING_MODE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      if (response.ok) {
        setStatus('saved')
      } else {
        setMode(previous)
        setStatus('error')
      }
    } catch {
      setMode(previous)
      setStatus('error')
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Public Marketing Site</div>
      <p className="mb-4 text-sm text-slate-400">
        Controls what airfieldcentral.com's bare root domain shows to the public - the real landing page, or a
        "coming soon" placeholder. Every tenant subdomain (e.g. shobdon.airfieldcentral.com) is completely
        unaffected either way; this only ever touches the marketing root.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleSetMode('coming_soon')}
          disabled={loading || status === 'saving'}
          className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'coming_soon' ? 'bg-amber-500 text-white' : 'border border-slate-700 text-slate-300 hover:border-amber-500'
          }`}
        >
          Coming Soon
        </button>
        <button
          type="button"
          onClick={() => handleSetMode('live')}
          disabled={loading || status === 'saving'}
          className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'live' ? 'bg-green-600 text-white' : 'border border-slate-700 text-slate-300 hover:border-green-500'
          }`}
        >
          Live Landing Page
        </button>
        {status === 'saving' && <span className="text-sm font-semibold text-slate-400">Saving…</span>}
        {status === 'saved' && <span className="text-sm font-semibold text-green-400">✅ Saved.</span>}
        {status === 'error' && <span className="text-sm font-semibold text-red-400">❌ Couldn't save - try again.</span>}
      </div>
    </div>
  )
}

// How often functions/api/public/gyropedia-departures.ts re-fetches
// gyropedia.com/monitor.php, rather than serving its own cached copy -
// same platform_settings-backed, requireDeveloper-gated GET/PUT shape
// as LandingModeToggle above (functions/api/platform/gyropedia-interval.ts),
// genuinely cross-tenant since the feed itself is one shared UK-wide
// dataset, not tenant-specific.
function GyropediaIntervalToggle(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [minutes, setMinutes] = useState<GyropediaIntervalMinutes>(15)
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(PLATFORM_GYROPEDIA_INTERVAL_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && GYROPEDIA_INTERVAL_OPTIONS.includes(data?.minutes)) setMinutes(data.minutes)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSetMinutes(next: GyropediaIntervalMinutes) {
    if (next === minutes) return
    const previous = minutes
    setMinutes(next)
    setStatus('saving')
    try {
      const response = await fetch(PLATFORM_GYROPEDIA_INTERVAL_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: next }),
      })
      if (response.ok) {
        setStatus('saved')
      } else {
        setMinutes(previous)
        setStatus('error')
      }
    } catch {
      setMinutes(previous)
      setStatus('error')
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Gyropedia Refresh Interval</div>
      <p className="mb-4 text-sm text-slate-400">
        How often the "Gyropedia Departures/Arrivals" carousel slot re-fetches live data from gyropedia.com, for
        every tenant that has it enabled - same shared feed, one setting. Between refreshes, tenants see the
        last successfully fetched copy.
      </p>
      <div className="flex items-center gap-3">
        {GYROPEDIA_INTERVAL_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => handleSetMinutes(option)}
            disabled={loading || status === 'saving'}
            className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
              minutes === option ? 'bg-amber-500 text-white' : 'border border-slate-700 text-slate-300 hover:border-amber-500'
            }`}
          >
            {option} min
          </button>
        ))}
        {status === 'saving' && <span className="text-sm font-semibold text-slate-400">Saving…</span>}
        {status === 'saved' && <span className="text-sm font-semibold text-green-400">✅ Saved.</span>}
        {status === 'error' && <span className="text-sm font-semibold text-red-400">❌ Couldn't save - try again.</span>}
      </div>
    </div>
  )
}

// Safety-net override for the compass wind arrow's visual rotation -
// see CompassPanel.tsx. Written via its own narrow endpoint (not the
// shared /api/tenant/ops-panel PUT atc-control also uses), applied
// immediately on toggle rather than staged, since this is a diagnostic
// flag a developer flips once to confirm/correct, not a multi-field
// form with its own "Update Dashboard" moment.
function ReverseNeedleToggle(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [reverseCompassNeedle, setReverseCompassNeedle] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(DEVELOPER_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setReverseCompassNeedle(!!data?.reverseCompassNeedle)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked
    setReverseCompassNeedle(next)
    setStatus('saving')
    try {
      const response = await fetch(DEVELOPER_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reverseCompassNeedle: next }),
      })
      setStatus(response.ok ? 'saved' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Compass Safety Net</div>
      <p className="mb-4 text-sm text-slate-400">
        Flips the wind arrow's visual rotation by 180° on the live dashboard - a safety-net override for when
        the arrow's direction doesn't match reality. Does NOT affect the reported wind direction figure, or the
        headwind/crosswind numbers, which are calculated independently and are unaffected by this toggle either
        way.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={reverseCompassNeedle}
          disabled={loading}
          onChange={handleToggle}
          className="h-4 w-4"
        />
        <span className="text-sm text-slate-300">Reverse compass needle</span>
      </label>
      {status === 'saving' && <p className="mt-3 text-sm font-semibold text-slate-400">Saving…</p>}
      {status === 'saved' && <p className="mt-3 text-sm font-semibold text-green-400">✅ Saved - live dashboard updates on its next refresh.</p>}
      {status === 'error' && (
        <p className="mt-3 text-sm font-semibold text-red-400">❌ Could not save - check connectivity and try again.</p>
      )}
    </div>
  )
}

const PILOT_CLOCK_MODE_OPTIONS = [
  { value: 'summer', label: 'Summer Time', description: 'Local time, "BST" while the UK is actually observing daylight saving, "GMT" the rest of the year.' },
  { value: 'gmt', label: 'GMT', description: 'Fixed UTC+0 year-round, never shifts for BST - suffix always "GMT".' },
  { value: 'utc', label: 'UTC / Zulu', description: 'Same fixed UTC+0 as GMT above, suffix always "Z" instead.' },
] as const
type PilotClockMode = (typeof PILOT_CLOCK_MODE_OPTIONS)[number]['value']

// /pilot header clock round - same GET/PUT round trip as
// ReverseNeedleToggle above, sharing the same developer-settings
// endpoint (two independent fields on the same ops_panel_state row,
// see that endpoint's own comment), but its own independent
// fetch/save, matching this page's existing convention of each control
// being self-contained rather than one shared form. 'summer' (this
// page's default before a real value loads) matches
// ops_panel_state.pilot_clock_mode's own DEFAULT - never a flash of a
// wrong selected button while loading.
function PilotClockModeToggle(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<PilotClockMode>('summer')
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(DEVELOPER_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && (data?.pilotClockMode === 'summer' || data?.pilotClockMode === 'gmt' || data?.pilotClockMode === 'utc')) {
          setMode(data.pilotClockMode)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSetMode(next: PilotClockMode) {
    if (next === mode) return
    const previous = mode
    setMode(next)
    setStatus('saving')
    try {
      const response = await fetch(DEVELOPER_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pilotClockMode: next }),
      })
      if (response.ok) {
        setStatus('saved')
      } else {
        setMode(previous)
        setStatus('error')
      }
    } catch {
      setMode(previous)
      setStatus('error')
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Pilot View Header Clock</div>
      <p className="mb-4 text-sm text-slate-400">
        Controls the time-of-day suffix shown after the clock in /pilot's header only - the main TV dashboard's own
        clock, and every other clock in the app, are unaffected either way.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        {PILOT_CLOCK_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSetMode(option.value)}
            disabled={loading || status === 'saving'}
            title={option.description}
            className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === option.value ? 'bg-amber-500 text-white' : 'border border-slate-700 text-slate-300 hover:border-amber-500'
            }`}
          >
            {option.label}
          </button>
        ))}
        {status === 'saving' && <span className="text-sm font-semibold text-slate-400">Saving…</span>}
        {status === 'saved' && <span className="text-sm font-semibold text-green-400">✅ Saved.</span>}
        {status === 'error' && <span className="text-sm font-semibold text-red-400">❌ Couldn't save - try again.</span>}
      </div>
    </div>
  )
}

const CAPTURE_INTERVAL_SECONDS_OPTIONS = [5, 10, 15, 30, 60] as const
type CaptureIntervalSeconds = (typeof CAPTURE_INTERVAL_SECONDS_OPTIONS)[number]

// ADISP capture polling interval (migration 0080) - same GET/PUT round
// trip as ReverseNeedleToggle/PilotClockModeToggle above, sharing the
// same developer-settings endpoint (a third independent field on the
// same ops_panel_state row). Rendered as a <select>, not this page's
// usual button-group pattern (PilotClockModeToggle/GyropediaIntervalToggle
// above) - explicit instruction, 5 fixed numeric choices read more
// naturally as a dropdown than 5 buttons in a row. 60 (this page's
// default before a real value loads) matches ops_panel_state.
// captureIntervalSeconds's own DEFAULT - never a flash of a wrong
// selected option while loading.
//
// Live-reload, not a code deploy: the PC2 capture script
// (public/downloads/capture-weathercentral.ps1) polls its own value
// roughly once a minute during its capture loop and adopts a change
// without needing to be restarted - PROVIDED PC2 is already running the
// version of the script with that polling logic. The very first switch
// to this version still needs the updated .ps1 re-downloaded and the
// script restarted once on PC2; every change made here after that takes
// effect on its own.
function CaptureIntervalToggle(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [seconds, setSeconds] = useState<CaptureIntervalSeconds>(60)
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(DEVELOPER_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && CAPTURE_INTERVAL_SECONDS_OPTIONS.includes(data?.captureIntervalSeconds)) {
          setSeconds(data.captureIntervalSeconds)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = Number(event.target.value) as CaptureIntervalSeconds
    if (next === seconds) return
    const previous = seconds
    setSeconds(next)
    setStatus('saving')
    try {
      const response = await fetch(DEVELOPER_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureIntervalSeconds: next }),
      })
      if (response.ok) {
        setStatus('saved')
      } else {
        setSeconds(previous)
        setStatus('error')
      }
    } catch {
      setSeconds(previous)
      setStatus('error')
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">ADISP Capture Interval</div>
      <p className="mb-4 text-sm text-slate-400">
        How often the PC2 capture script scrapes the local ADISP station and posts a reading. Live-reload - PC2
        adopts a change within roughly a minute, no restart needed, provided it's already running the updated
        capture-weathercentral.ps1 (the first switch to this version still needs one manual re-download/restart).
        Start at 15 or 30 seconds and only go lower once that's confirmed stable on the real station.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={seconds}
          disabled={loading || status === 'saving'}
          onChange={handleChange}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none disabled:opacity-50"
        >
          {CAPTURE_INTERVAL_SECONDS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} seconds
            </option>
          ))}
        </select>
        {status === 'saving' && <span className="text-sm font-semibold text-slate-400">Saving…</span>}
        {status === 'saved' && <span className="text-sm font-semibold text-green-400">✅ Saved.</span>}
        {status === 'error' && <span className="text-sm font-semibold text-red-400">❌ Couldn't save - try again.</span>}
      </div>
    </div>
  )
}

// Physical screen width (cm) of the real TV/monitor this tenant's
// dashboard runs on (migration 0088, tenants.display_width_cm) - needed
// because window.innerWidth only reports CSS pixel width, not physical
// size (a 1920x1080 43in TV and a 1920x1080 24in monitor report
// identically), and the Ops Panel QR tile (RightInfoPanel.tsx) needs a
// real physical size to stay reliably scannable. Lives on tenants, not
// ops_panel_state like the other controls on this page, but bundled into
// the same developer-settings GET/PUT and this same page anyway - still
// "developer sets this on request, no self-service" like everything
// else here, just a different underlying table.
//
// Free-text number input + explicit Save (not save-on-blur/an immediate
// toggle like this page's other controls) - unlike a fixed set of
// buttons/a dropdown, a physical measurement is free-form and easy to
// mistype, so an explicit confirm step before it round-trips matches
// this page's existing "Saving.../Saved./error" status pattern without
// firing a save on every keystroke or an accidental blur.
//
// Empty input saves null (explicit "not yet confirmed" - see migration
// 0088's own comment), not 0 or an error - RightInfoPanel.tsx falls back
// to an assumed 110cm and logs a dev-mode warning whenever this is null,
// so leaving it unset is a real, supported state, not a mistake to block.
function DisplayWidthField(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [savedValue, setSavedValue] = useState<number | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch(DEVELOPER_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const value = typeof data?.displayWidthCm === 'number' ? data.displayWidthCm : null
        setSavedValue(value)
        setInputValue(value === null ? '' : String(value))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    const trimmed = inputValue.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next <= 0)) {
      setStatus('error')
      return
    }
    setStatus('saving')
    try {
      const response = await fetch(DEVELOPER_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayWidthCm: next }),
      })
      if (response.ok) {
        setSavedValue(next)
        setStatus('saved')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  const dirty = !loading && inputValue.trim() !== (savedValue === null ? '' : String(savedValue))

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Display Physical Width</div>
      <p className="mb-4 text-sm text-slate-400">
        The real, physical width (in centimetres) of the TV/monitor this tenant's Ops Panel QR code renders on -
        there's no browser API for this, so it has to be set here from the actual hardware. Left blank, the QR
        sizing calculation assumes 110cm (~43in) and logs a console warning in dev mode so a missing value is
        never silently wrong.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="number"
          inputMode="decimal"
          min={1}
          step="0.5"
          value={inputValue}
          disabled={loading}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="e.g. 95"
          className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none disabled:opacity-50"
        />
        <span className="text-sm text-slate-400">cm</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || status === 'saving' || !dirty}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold uppercase tracking-widest text-slate-300 transition hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        {status === 'saving' && <span className="text-sm font-semibold text-slate-400">Saving…</span>}
        {status === 'saved' && <span className="text-sm font-semibold text-green-400">✅ Saved.</span>}
        {status === 'error' && (
          <span className="text-sm font-semibold text-red-400">❌ Enter a positive number, or leave blank to clear.</span>
        )}
      </div>
    </div>
  )
}

export default function DeveloperToolsPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Developer Tools — Airfield Central'
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-6 pb-10 pt-10">
      <div className="rounded-3xl border border-slate-700 bg-slate-950/85 p-10 shadow-xl shadow-slate-950/20">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Developer Tools</h1>
        <p className="mb-2 max-w-2xl text-sm text-muted-400">
          Deep capture diagnostics, visible only to the developer account regardless of tenant role. The self-serve
          PC2 capture setup (download files, view logs, trigger a refresh) moved to /config, where any owner/admin
          can use it directly without developer involvement.
        </p>

        <div className="mt-10">
          <LandingModeToggle />
        </div>
        <GyropediaIntervalToggle />

        {/* Amber box matches this page's other developer-only tools below -
            InvestigateStation renders its own "Investigate Station" heading
            and top divider internally, so no extra heading is added here. */}
        <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
          <InvestigateStation />
        </div>
        <ReverseNeedleToggle />
        <PilotClockModeToggle />
        <CaptureIntervalToggle />
        <DisplayWidthField />
      </div>
    </div>
  )
}
