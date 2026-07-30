import { useEffect, useState } from 'react'

const SUGGESTIONS_URL = '/api/platform/known-devices/suggestions'
const KNOWN_DEVICES_URL = '/api/platform/known-devices'

interface Suggestion {
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  displayName: string | null
  ipAddress: string
  visitCount: number
  firstSeen: string
  lastSeen: string
  // Global IP directory (migration 0057) cross-check - a real gap this
  // catches: an IP confirmed as one tenant's known device that ALSO
  // carries a label like "Jeff's Mac" is almost certainly not that
  // tenant's real display. Surfaced as a visible warning here, before
  // confirming, not discovered after.
  labelGroup: string | null
}

interface KnownDevice {
  id: number
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  ipAddress: string
  label: string | null
  status: string
  active: number
  confirmedAt: string
  // Global IP directory cross-check - see Suggestion's own field for
  // the full reasoning. Distinct from `label` above (this row's own
  // free-text note).
  globalLabelGroup: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Backs the Platform Admin "Known Devices" nav entry - Phase B of the
// visit-log uptime work (Phase A: CSV export, already live; Phase C:
// the uptime report itself, depends on this page's confirmed devices).
// Two independent lists: Suggestions (candidate IPs pulled straight
// from display_visits, ranked by frequency/recency, nothing decided
// yet) and Known Devices (every IP Jeff has already confirmed or
// dismissed - confirmed ones are what Phase C's uptime math will
// filter on).
export default function KnownDevicesPage(): JSX.Element {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [knownDevices, setKnownDevices] = useState<KnownDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({})

  function loadAll() {
    setLoading(true)
    return Promise.all([fetch(SUGGESTIONS_URL), fetch(KNOWN_DEVICES_URL)])
      .then(([suggestionsRes, knownRes]) => {
        if (suggestionsRes.status === 401 || suggestionsRes.status === 403) {
          setForbidden(true)
          return null
        }
        return Promise.all([suggestionsRes.ok ? suggestionsRes.json() : null, knownRes.ok ? knownRes.json() : null])
      })
      .then((data) => {
        if (!data) return
        const [suggestionsData, knownData] = data
        setSuggestions(suggestionsData?.suggestions ?? [])
        setKnownDevices(knownData?.knownDevices ?? [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function handleDecide(s: Suggestion, status: 'confirmed' | 'dismissed') {
    const key = `${s.tenantId}:${s.displaySlug}:${s.ipAddress}`
    setBusyKey(key)
    try {
      await fetch(KNOWN_DEVICES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: s.tenantId, displaySlug: s.displaySlug, ipAddress: s.ipAddress, status }),
      })
      await loadAll()
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRetire(device: KnownDevice) {
    setBusyKey(`retire:${device.id}`)
    try {
      await fetch(`${KNOWN_DEVICES_URL}/${device.id}`, { method: 'PATCH' })
      await loadAll()
    } finally {
      setBusyKey(null)
    }
  }

  async function handleSaveLabel(device: KnownDevice) {
    const label = labelDrafts[device.id] ?? device.label ?? ''
    setBusyKey(`label:${device.id}`)
    try {
      await fetch(KNOWN_DEVICES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: device.tenantId,
          displaySlug: device.displaySlug,
          ipAddress: device.ipAddress,
          status: device.status,
          label,
        }),
      })
      await loadAll()
    } finally {
      setBusyKey(null)
    }
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  const activeKnownDevices = knownDevices.filter((d) => d.active === 1)

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-[1900px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Known Devices</h1>
        <p className="mb-3 max-w-3xl text-sm text-muted-400">
          Confirm which IP addresses are a tenant's real display, so the uptime report can tell "the screen was
          actually showing the dashboard" apart from any other traffic that happened to hit the same URL.
        </p>
        <div className="mb-6 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <strong className="font-semibold uppercase tracking-widest">Reliability note:</strong> IP addresses are not
          a perfectly stable signal. Dynamic/residential connections can rotate to a new IP every few days (confirmed
          directly against this data - one tenant's display alone has cycled through 50+ distinct IPs), and a
          building on a shared/NAT'd connection can show the same IP for multiple unrelated devices. Confirming an IP
          here is a snapshot, not a permanent fact - revisit Suggestions periodically, and treat an uptime report
          built on a stale confirmed IP as understating real uptime, not proof the screen was actually off.
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-accent-sky-400">
                Suggestions ({suggestions.length})
              </h2>
              <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                      <th className="px-4 py-3">Tenant</th>
                      <th className="px-4 py-3">Display</th>
                      <th className="px-4 py-3">IP Address</th>
                      <th className="px-4 py-3">Seen</th>
                      <th className="px-4 py-3">First / Last Seen</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s) => {
                      const key = `${s.tenantId}:${s.displaySlug}:${s.ipAddress}`
                      const isBusy = busyKey === key
                      return (
                        <tr
                          key={key}
                          className={`border-b border-border/60 last:border-0 ${s.labelGroup ? 'bg-amber-500/5' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold">{s.tenantName}</div>
                            <div className="text-xs text-muted-500">{s.tenantSlug}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-400">{s.displayName ?? s.displaySlug}</td>
                          <td className="px-4 py-3 text-xs text-muted-400">
                            {s.ipAddress}
                            {s.labelGroup && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                                ⚠ Labeled "{s.labelGroup}"
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-400">{s.visitCount} times</td>
                          <td className="px-4 py-3 text-xs text-muted-500">
                            {formatDate(s.firstSeen)} — {formatDate(s.lastSeen)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDecide(s, 'confirmed')}
                                className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-400 hover:border-emerald-400 disabled:opacity-40"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDecide(s, 'dismissed')}
                                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-400 hover:border-slate-500 disabled:opacity-40"
                              >
                                Dismiss
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {suggestions.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-sm text-muted-500" colSpan={6}>
                          No pending suggestions - every IP seen so far has been confirmed or dismissed.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-accent-sky-400">
                Known Devices ({activeKnownDevices.length} active)
              </h2>
              <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                      <th className="px-4 py-3">Tenant</th>
                      <th className="px-4 py-3">Display</th>
                      <th className="px-4 py-3">IP Address</th>
                      <th className="px-4 py-3">Label</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Confirmed</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knownDevices.map((d) => {
                      const isRetireBusy = busyKey === `retire:${d.id}`
                      const isLabelBusy = busyKey === `label:${d.id}`
                      return (
                        <tr
                          key={d.id}
                          className={`border-b border-border/60 last:border-0 ${d.active === 0 ? 'opacity-50' : ''} ${d.active === 1 && d.globalLabelGroup ? 'bg-amber-500/5' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold">{d.tenantName}</div>
                            <div className="text-xs text-muted-500">{d.tenantSlug}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-400">{d.displaySlug}</td>
                          <td className="px-4 py-3 text-xs text-muted-400">
                            {d.ipAddress}
                            {d.active === 1 && d.globalLabelGroup && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                                ⚠ Labeled "{d.globalLabelGroup}" - probably not this tenant's real display
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Optional label"
                                value={labelDrafts[d.id] ?? d.label ?? ''}
                                onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                disabled={d.active === 0}
                                className="w-40 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
                              />
                              {d.active === 1 && (
                                <button
                                  type="button"
                                  disabled={isLabelBusy}
                                  onClick={() => handleSaveLabel(d)}
                                  className="text-xs text-accent-sky-400 hover:underline disabled:opacity-40"
                                >
                                  Save
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span
                              className={
                                d.active === 0
                                  ? 'text-muted-500'
                                  : d.status === 'confirmed'
                                    ? 'text-emerald-400'
                                    : 'text-muted-400'
                              }
                            >
                              {d.active === 0 ? 'Retired' : d.status === 'confirmed' ? 'Confirmed' : 'Dismissed'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-500">{formatDate(d.confirmedAt)}</td>
                          <td className="px-4 py-3">
                            {d.active === 1 && (
                              <button
                                type="button"
                                disabled={isRetireBusy}
                                onClick={() => handleRetire(d)}
                                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-status-bad hover:border-status-bad disabled:opacity-40"
                              >
                                Retire
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {knownDevices.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-sm text-muted-500" colSpan={7}>
                          No devices confirmed or dismissed yet - start with the suggestions above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
