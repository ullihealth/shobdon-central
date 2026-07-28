import { useEffect, useRef, useState } from 'react'
import { TENANT_CONFIG_URL } from '../../config/publicApi'

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

// icaoCode/lat/lon (tenants table, migration 0022) power the weather
// providers' own tenant-location lookup (weather-metoffice.ts/
// weather-default.ts) and the automated NOTAM feed (functions/api/public/
// notams.ts) - previously only ever hand-inserted directly into D1 for
// Shobdon, with no admin UI to set or edit them at all, which would have
// blocked a second tenant from ever getting working weather/NOTAMs. Same
// self-fetching pattern as this page's other sections (StorageUsage,
// PC2CaptureSetup) - reads and writes through the existing
// /api/tenant/config GET/PUT rather than a new route.
export default function AirfieldLocationSection(): JSX.Element | null {
  const [loaded, setLoaded] = useState(false)
  const [icaoCode, setIcaoCode] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  // Same touched-ref pattern as DesignPage.tsx's branding-name editor -
  // stops the initial fetch from clobbering an in-progress edit if it
  // resolves after the admin has already started typing.
  const touchedRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data || touchedRef.current) return
        setIcaoCode(typeof data.icaoCode === 'string' ? data.icaoCode : '')
        setLat(typeof data.lat === 'number' ? String(data.lat) : '')
        setLon(typeof data.lon === 'number' ? String(data.lon) : '')
        setLoaded(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  // Client-side pre-check only (disables Save on obviously-bad input) -
  // the PUT below is still the authoritative validator; this just avoids
  // a round trip for the common typo case.
  const latValid = lat.trim() !== '' && Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
  const lonValid = lon.trim() !== '' && Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180
  const icaoValid = icaoCode.trim() === '' || /^[A-Za-z]{4}$/.test(icaoCode.trim())

  async function handleSave() {
    if (!latValid || !lonValid || !icaoValid) return
    setStatus('working')
    setErrorMessage(null)
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icaoCode: icaoCode.trim() === '' ? null : icaoCode.trim().toUpperCase(),
          lat: parsedLat,
          lon: parsedLon,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setErrorMessage(typeof data?.error === 'string' ? data.error : "Couldn't save - please try again.")
        setStatus('error')
        return
      }
      setIcaoCode(icaoCode.trim().toUpperCase())
      setStatus('success')
    } catch {
      setErrorMessage("Couldn't save - please try again.")
      setStatus('error')
    }
  }

  // Same "render nothing until loaded" stance as StorageUsage - no flash
  // of an empty/default form before the tenant's real values arrive.
  if (!loaded) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">Airfield Location</h3>
      <p className="mb-4 text-sm text-muted-300">
        Powers weather lookups and the automated NOTAM feed for this tenant. Latitude/longitude are required; ICAO
        code is optional but improves NOTAM accuracy when available.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">ICAO code</label>
          <input
            value={icaoCode}
            onChange={(event) => {
              touchedRef.current = true
              setIcaoCode(event.target.value.toUpperCase().slice(0, 4))
            }}
            placeholder="e.g. EGBS"
            maxLength={4}
            className="w-24 rounded border border-border bg-slate-900 px-3 py-2 text-sm uppercase text-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">Latitude</label>
          <input
            value={lat}
            onChange={(event) => {
              touchedRef.current = true
              setLat(event.target.value)
            }}
            placeholder="52.2416"
            inputMode="decimal"
            className="w-32 rounded border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">Longitude</label>
          <input
            value={lon}
            onChange={(event) => {
              touchedRef.current = true
              setLon(event.target.value)
            }}
            placeholder="-2.8821"
            inputMode="decimal"
            className="w-32 rounded border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={status === 'working' || !latValid || !lonValid || !icaoValid}
          className="shrink-0 rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
        >
          {status === 'working' ? 'Saving…' : 'Save'}
        </button>
      </div>
      {status === 'success' && <p className="mt-2 text-xs text-status-good">Saved.</p>}
      {status === 'error' && <p className="mt-2 text-xs text-status-bad">{errorMessage}</p>}
    </div>
  )
}
