import { useEffect, useState } from 'react'
import InvestigateStation from '../components/config/InvestigateStation'
import { PLATFORM_LANDING_MODE_URL } from '../config/publicApi'

const DEVELOPER_SETTINGS_URL = '/api/tenant/developer-settings'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type LandingMode = 'coming_soon' | 'live'

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

export default function DeveloperToolsPage(): JSX.Element {
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

        {/* Amber box matches this page's other developer-only tools below -
            InvestigateStation renders its own "Investigate Station" heading
            and top divider internally, so no extra heading is added here. */}
        <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
          <InvestigateStation />
        </div>
        <ReverseNeedleToggle />
      </div>
    </div>
  )
}
