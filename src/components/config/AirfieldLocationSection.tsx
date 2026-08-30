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
//
// Postcode-first round - a raw lat/lon pair is precise but not something
// most airfield admins have on hand or can type confidently (Shobdon's
// own real coordinates were hand-inserted directly into D1, never typed
// into this form by an admin, until this round). UK Postcode (migration
// 0099) is now the primary path: /api/tenant/config PUT resolves it
// server-side via the SAME geocodePostcode() helper the venue_cafe
// self-serve signup branch already established (functions/api/_utils/
// postcodeGeocode.ts), writing into the same lat/lon columns this form
// always wrote - so a tenant who only ever uses the postcode field never
// needs to know lat/lon exist. Raw lat/lon stays available as an
// "Advanced" manual override, collapsed by default - still needed for a
// future non-UK tenant (postcodes.io is UK-only) or if a postcode lookup
// ever fails and an admin already knows their coordinates some other way.
//
// One-source-of-truth round - ConfigPage.tsx's own Internet Weather card
// used to have its own, completely independent Latitude/Longitude
// fields (localStorage-only, weatherConfigStore.ts), which never
// reflected a postcode/manual save made here - two editable copies of
// "this tenant's location" that could silently disagree. onLocationChange
// (fired only on an actual SAVE here, not on initial load - ConfigPage.tsx
// gets the initial value from its own existing fetch instead, avoiding a
// redundant double-set) lets ConfigPage.tsx keep that card's now-
// read-only display in sync the instant a save here succeeds, no reload
// needed. See InternetWeatherConfigSection.tsx's own comment for why
// read-only (not "also editable, also writes here") was the chosen fix.
interface AirfieldLocationSectionProps {
  onLocationChange?: (lat: number, lon: number) => void
}

export default function AirfieldLocationSection({ onLocationChange }: AirfieldLocationSectionProps = {}): JSX.Element | null {
  const [loaded, setLoaded] = useState(false)
  const [icaoCode, setIcaoCode] = useState('')
  const [postcode, setPostcode] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  // Same touched-ref pattern as DesignPage.tsx's branding-name editor -
  // stops the initial fetch from clobbering an in-progress edit if it
  // resolves after the admin has already started typing.
  const touchedRef = useRef(false)

  const [icaoStatus, setIcaoStatus] = useState<SaveStatus>('idle')
  const [icaoErrorMessage, setIcaoErrorMessage] = useState<string | null>(null)

  // Separate status/message from icaoStatus above - the postcode "Locate"
  // action and the ICAO save are independent operations an admin can
  // trigger in either order, each with its own outcome to show.
  const [locateStatus, setLocateStatus] = useState<SaveStatus>('idle')
  const [locateErrorMessage, setLocateErrorMessage] = useState<string | null>(null)

  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [manualStatus, setManualStatus] = useState<SaveStatus>('idle')
  const [manualErrorMessage, setManualErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data || touchedRef.current) return
        setIcaoCode(typeof data.icaoCode === 'string' ? data.icaoCode : '')
        setPostcode(typeof data.postcode === 'string' ? data.postcode : '')
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

  async function handleSaveIcao() {
    if (!icaoValid) return
    setIcaoStatus('working')
    setIcaoErrorMessage(null)
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icaoCode: icaoCode.trim() === '' ? null : icaoCode.trim().toUpperCase() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setIcaoErrorMessage(typeof data?.error === 'string' ? data.error : "Couldn't save - please try again.")
        setIcaoStatus('error')
        return
      }
      setIcaoCode(icaoCode.trim().toUpperCase())
      setIcaoStatus('success')
    } catch {
      setIcaoErrorMessage("Couldn't save - please try again.")
      setIcaoStatus('error')
    }
  }

  async function handleLocate() {
    if (postcode.trim() === '') return
    setLocateStatus('working')
    setLocateErrorMessage(null)
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode: postcode.trim() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setLocateErrorMessage(typeof data?.error === 'string' ? data.error : "Couldn't locate that postcode - please try again.")
        setLocateStatus('error')
        return
      }
      const resolved = data?.resolvedLocation
      if (resolved && typeof resolved.lat === 'number' && typeof resolved.lon === 'number') {
        setLat(String(resolved.lat))
        setLon(String(resolved.lon))
        setPostcode(typeof resolved.postcode === 'string' ? resolved.postcode : postcode.trim())
        onLocationChange?.(resolved.lat, resolved.lon)
      }
      setLocateStatus('success')
    } catch {
      setLocateErrorMessage("Couldn't reach the postcode lookup service - please try again.")
      setLocateStatus('error')
    }
  }

  async function handleSaveManualLocation() {
    if (!latValid || !lonValid) return
    setManualStatus('working')
    setManualErrorMessage(null)
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: parsedLat, lon: parsedLon }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setManualErrorMessage(typeof data?.error === 'string' ? data.error : "Couldn't save - please try again.")
        setManualStatus('error')
        return
      }
      setManualStatus('success')
      onLocationChange?.(parsedLat, parsedLon)
    } catch {
      setManualErrorMessage("Couldn't save - please try again.")
      setManualStatus('error')
    }
  }

  // Same "render nothing until loaded" stance as StorageUsage - no flash
  // of an empty/default form before the tenant's real values arrive.
  if (!loaded) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">Airfield Location</h3>
      <p className="mb-4 text-sm text-muted-300">
        Powers weather lookups and the automated NOTAM feed for this tenant.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">UK Postcode</label>
          <input
            value={postcode}
            onChange={(event) => {
              touchedRef.current = true
              setPostcode(event.target.value)
              if (locateStatus !== 'idle') setLocateStatus('idle')
            }}
            placeholder="e.g. HR6 9NR"
            className="w-32 rounded border border-border bg-slate-900 px-3 py-2 text-sm uppercase text-primary"
          />
        </div>
        <button
          type="button"
          onClick={handleLocate}
          disabled={locateStatus === 'working' || postcode.trim() === ''}
          className="shrink-0 rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
        >
          {locateStatus === 'working' ? 'Locating…' : 'Locate'}
        </button>
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
        <button
          type="button"
          onClick={handleSaveIcao}
          disabled={icaoStatus === 'working' || !icaoValid}
          className="shrink-0 rounded border border-border px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary disabled:opacity-40"
        >
          {icaoStatus === 'working' ? 'Saving…' : 'Save ICAO'}
        </button>
      </div>

      {locateStatus === 'success' && (
        <p className="mt-2 text-xs text-status-good">
          {latValid && lonValid ? `Located at ${parsedLat.toFixed(2)}, ${parsedLon.toFixed(2)}` : 'Located.'}
        </p>
      )}
      {locateStatus === 'error' && <p className="mt-2 text-xs text-status-bad">{locateErrorMessage}</p>}
      {icaoStatus === 'success' && <p className="mt-2 text-xs text-status-good">ICAO code saved.</p>}
      {icaoStatus === 'error' && <p className="mt-2 text-xs text-status-bad">{icaoErrorMessage}</p>}

      <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setAdvancedExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-400"
          aria-expanded={advancedExpanded}
        >
          <span className={`inline-block transition-transform ${advancedExpanded ? 'rotate-90' : ''}`} aria-hidden="true">
            ▸
          </span>
          Advanced / manual override
        </button>

        {advancedExpanded && (
          <div className="mt-3">
            <p className="mb-3 text-xs text-muted-500">
              Only needed if the postcode lookup above doesn't cover this location (e.g. a non-UK tenant), or if the
              lookup fails and coordinates are already known some other way.
            </p>
            <div className="flex flex-wrap items-end gap-4">
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
                onClick={handleSaveManualLocation}
                disabled={manualStatus === 'working' || !latValid || !lonValid}
                className="shrink-0 rounded border border-border px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary disabled:opacity-40"
              >
                {manualStatus === 'working' ? 'Saving…' : 'Save coordinates'}
              </button>
            </div>
            {manualStatus === 'success' && <p className="mt-2 text-xs text-status-good">Coordinates saved.</p>}
            {manualStatus === 'error' && <p className="mt-2 text-xs text-status-bad">{manualErrorMessage}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
