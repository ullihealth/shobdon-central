import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import AtcDeveloperTools from '../components/config/AtcDeveloperTools'

const DEVELOPER_SETTINGS_URL = '/api/tenant/developer-settings'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

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
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto h-24 max-w-[1920px] px-10 pt-6">
        <Header />
      </div>

      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mt-6 rounded-3xl border border-slate-700 bg-slate-950/85 p-10 shadow-xl shadow-slate-950/20">
          <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
            ← Back to Config
          </Link>
          <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Developer Tools</h1>
          <p className="mb-2 max-w-2xl text-sm text-muted-400">
            Capture pipeline diagnostics - relocated here from /config, visible only to the developer account
            regardless of tenant role.
          </p>

          <AtcDeveloperTools />
          <ReverseNeedleToggle />
        </div>
      </div>
    </div>
  )
}
