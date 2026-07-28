import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

const TENANTS_URL = '/api/platform/tenants'
const SITE_RELAYS_URL = '/api/platform/site-relays'
const CAMERAS_URL = '/api/platform/cameras'

type CameraMode = 'local' | 'stream' | 'both'

interface TenantOption {
  id: number
  name: string
}

interface SiteRelay {
  id: string
  tenantId: number
  label: string
  localBaseUrl: string
  createdAt: string
}

interface Camera {
  id: string
  tenantId: number
  siteRelayId: string
  name: string
  mode: CameraMode
  rtspAddress: string | null
  youtubeVideoId: string | null
  pushEnabled: boolean
  createdAt: string
}

type SaveStatus = 'idle' | 'working' | 'error'

const inputClass = 'rounded border border-border bg-slate-900 px-3 py-2 text-sm text-primary focus:border-sky-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs uppercase tracking-wide text-muted-400'
const cardClass = 'rounded-3xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20'
const primaryButtonClass = 'shrink-0 rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40'
const dangerButtonClass = 'rounded border border-status-bad px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-status-bad hover:bg-status-bad/10'

// Site relays must exist before a camera can be assigned to one
// (cameras.site_relay_id is a real FK) - kept as its own compact
// section on this same page rather than a separate route, since a
// platform admin only ever touches this while also setting up cameras
// for the same site.
function SiteRelaysSection({
  tenants,
  siteRelays,
  onChanged,
}: {
  tenants: TenantOption[]
  siteRelays: SiteRelay[]
  onChanged: () => void
}): JSX.Element {
  const [id, setId] = useState('')
  const [tenantId, setTenantId] = useState<number | ''>('')
  const [label, setLabel] = useState('')
  const [localBaseUrl, setLocalBaseUrl] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setStatus('working')
    setError(null)
    try {
      const response = await fetch(SITE_RELAYS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tenantId, label, localBaseUrl }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error ?? "Couldn't save - please try again.")
        setStatus('idle')
        return
      }
      setId('')
      setTenantId('')
      setLabel('')
      setLocalBaseUrl('')
      setStatus('idle')
      onChanged()
    } catch {
      setError("Couldn't save - please try again.")
      setStatus('idle')
    }
  }

  async function handleDelete(relayId: string) {
    if (!window.confirm('Delete this site relay?')) return
    const response = await fetch(`${SITE_RELAYS_URL}/${relayId}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      window.alert(data?.error ?? "Couldn't delete - please try again.")
      return
    }
    onChanged()
  }

  return (
    <div className={cardClass}>
      <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Site Relays</div>
      <p className="mb-4 text-sm text-muted-300">
        One row per physical relay device (go2rtc/MediaMTX) running at a site - its local network address is what a
        viewer's browser embeds directly for local-mode playback.
      </p>

      <div className="mb-6 flex flex-col gap-2">
        {siteRelays.length === 0 && <div className="text-sm text-muted-500">No site relays yet.</div>}
        {siteRelays.map((relay) => (
          <div key={relay.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-slate-900/60 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-primary">
                {relay.label} <span className="font-mono text-xs text-muted-500">({relay.id})</span>
              </div>
              <div className="text-xs text-muted-400">
                {tenants.find((t) => t.id === relay.tenantId)?.name ?? `Tenant #${relay.tenantId}`} — {relay.localBaseUrl}
              </div>
            </div>
            <button type="button" onClick={() => handleDelete(relay.id)} className={dangerButtonClass}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass}>Id (slug)</label>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="shobdon-main" className={`w-40 ${inputClass}`} required />
        </div>
        <div>
          <label className={labelClass}>Tenant</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : '')}
            className={`w-48 ${inputClass}`}
            required
          >
            <option value="">Select tenant…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main building" className={`w-40 ${inputClass}`} required />
        </div>
        <div>
          <label className={labelClass}>Local base URL</label>
          <input
            value={localBaseUrl}
            onChange={(e) => setLocalBaseUrl(e.target.value)}
            placeholder="http://192.168.1.50:1984"
            className={`w-56 ${inputClass}`}
            required
          />
        </div>
        <button type="submit" disabled={status === 'working'} className={primaryButtonClass}>
          {status === 'working' ? 'Adding…' : '+ Add relay'}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-status-bad">{error}</p>}
    </div>
  )
}

interface CameraFormState {
  id: string | null
  tenantId: number | ''
  siteRelayId: string
  name: string
  mode: CameraMode
  rtspIp: string
  rtspPort: string
  rtspUsername: string
  rtspPassword: string
  rtspPath: string
  youtubeVideoId: string
  pushEnabled: boolean
}

const BLANK_CAMERA_FORM: CameraFormState = {
  id: null,
  tenantId: '',
  siteRelayId: '',
  name: '',
  mode: 'local',
  rtspIp: '',
  rtspPort: '554',
  rtspUsername: '',
  rtspPassword: '',
  rtspPath: '',
  youtubeVideoId: '',
  pushEnabled: false,
}

// rtsp_address is stored/read as one combined URL (functions/api/
// platform/cameras). The add/edit form keeps it as separate IP/port/
// username/password/path fields per the original spec ("combine into
// the stored rtsp_address") - these two functions are the only place
// that conversion happens.
function buildRtspAddress(form: CameraFormState): string {
  if (!form.rtspIp) return ''
  const auth = form.rtspUsername ? `${form.rtspUsername}:${form.rtspPassword}@` : ''
  const path = form.rtspPath ? (form.rtspPath.startsWith('/') ? form.rtspPath : `/${form.rtspPath}`) : ''
  return `rtsp://${auth}${form.rtspIp}:${form.rtspPort || '554'}${path}`
}

function parseRtspAddress(address: string | null): Pick<CameraFormState, 'rtspIp' | 'rtspPort' | 'rtspUsername' | 'rtspPassword' | 'rtspPath'> {
  if (!address) return { rtspIp: '', rtspPort: '554', rtspUsername: '', rtspPassword: '', rtspPath: '' }
  try {
    const url = new URL(address)
    return {
      rtspIp: url.hostname,
      rtspPort: url.port || '554',
      rtspUsername: decodeURIComponent(url.username),
      rtspPassword: decodeURIComponent(url.password),
      rtspPath: url.pathname,
    }
  } catch {
    return { rtspIp: '', rtspPort: '554', rtspUsername: '', rtspPassword: '', rtspPath: '' }
  }
}

function CameraForm({
  tenants,
  siteRelays,
  initial,
  onSaved,
  onCancel,
}: {
  tenants: TenantOption[]
  siteRelays: SiteRelay[]
  initial: CameraFormState
  onSaved: () => void
  onCancel?: () => void
}): JSX.Element {
  const [form, setForm] = useState<CameraFormState>(initial)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const relaysForTenant = useMemo(() => siteRelays.filter((r) => r.tenantId === form.tenantId), [siteRelays, form.tenantId])
  const needsRtsp = form.mode === 'local' || form.mode === 'both'
  const needsYoutube = form.mode === 'stream' || form.mode === 'both'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus('working')
    setError(null)

    const body = {
      tenantId: form.tenantId,
      siteRelayId: form.siteRelayId,
      name: form.name,
      mode: form.mode,
      rtspAddress: needsRtsp ? buildRtspAddress(form) : null,
      youtubeVideoId: needsYoutube ? form.youtubeVideoId : null,
      pushEnabled: form.pushEnabled,
    }

    const url = form.id ? `${CAMERAS_URL}/${form.id}` : CAMERAS_URL
    const method = form.id ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error ?? "Couldn't save - please try again.")
        setStatus('idle')
        return
      }
      setStatus('idle')
      onSaved()
    } catch {
      setError("Couldn't save - please try again.")
      setStatus('idle')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-slate-900/40 p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Gyroplane Train — Runway View"
            className={`w-64 ${inputClass}`}
            required
          />
        </div>
        <div>
          <label className={labelClass}>Tenant</label>
          <select
            value={form.tenantId}
            onChange={(e) => setForm({ ...form, tenantId: e.target.value ? Number(e.target.value) : '', siteRelayId: '' })}
            className={`w-48 ${inputClass}`}
            required
          >
            <option value="">Select tenant…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Site relay</label>
          <select
            value={form.siteRelayId}
            onChange={(e) => setForm({ ...form, siteRelayId: e.target.value })}
            className={`w-48 ${inputClass}`}
            required
            disabled={!form.tenantId}
          >
            <option value="">Select relay…</option>
            {relaysForTenant.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Mode</label>
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as CameraMode })} className={`w-32 ${inputClass}`}>
            <option value="local">Local</option>
            <option value="stream">Stream</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      {needsRtsp && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-400">
            RTSP source (relay-side only - never sent to the browser)
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className={labelClass}>IP address</label>
              <input value={form.rtspIp} onChange={(e) => setForm({ ...form, rtspIp: e.target.value })} placeholder="192.168.1.60" className={`w-40 ${inputClass}`} required />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input value={form.rtspPort} onChange={(e) => setForm({ ...form, rtspPort: e.target.value })} placeholder="554" className={`w-20 ${inputClass}`} />
            </div>
            <div>
              <label className={labelClass}>Username</label>
              <input value={form.rtspUsername} onChange={(e) => setForm({ ...form, rtspUsername: e.target.value })} className={`w-32 ${inputClass}`} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input
                type="password"
                value={form.rtspPassword}
                onChange={(e) => setForm({ ...form, rtspPassword: e.target.value })}
                className={`w-32 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass}>Path</label>
              <input value={form.rtspPath} onChange={(e) => setForm({ ...form, rtspPath: e.target.value })} placeholder="/stream1" className={`w-32 ${inputClass}`} />
            </div>
          </div>
        </div>
      )}

      {needsYoutube && (
        <div>
          <label className={labelClass}>YouTube video id</label>
          <input
            value={form.youtubeVideoId}
            onChange={(e) => setForm({ ...form, youtubeVideoId: e.target.value })}
            placeholder="dQw4w9WgXcQ"
            className={`w-64 ${inputClass}`}
            required
          />
          <p className="mt-1 text-xs text-muted-500">
            The persistent YouTube Live video id viewers embed - not the RTMP ingest key, which stays on the relay itself.
          </p>
        </div>
      )}

      {(form.mode === 'stream' || form.mode === 'both') && (
        <label className="flex w-fit items-center gap-2 text-sm text-primary">
          <input type="checkbox" checked={form.pushEnabled} onChange={(e) => setForm({ ...form, pushEnabled: e.target.checked })} className="h-4 w-4" />
          Push enabled (relay should currently be pushing to YouTube)
        </label>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === 'working'} className={primaryButtonClass}>
          {status === 'working' ? 'Saving…' : form.id ? 'Save changes' : '+ Add camera'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs font-semibold uppercase tracking-wide text-muted-400 hover:text-primary">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-status-bad">{error}</p>}
    </form>
  )
}

export default function PlatformCamerasPage(): JSX.Element {
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [siteRelays, setSiteRelays] = useState<SiteRelay[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function loadAll() {
    const [tenantsRes, relaysRes, camerasRes] = await Promise.all([
      fetch(TENANTS_URL).then((r) => (r.ok ? r.json() : null)),
      fetch(SITE_RELAYS_URL).then((r) => (r.ok ? r.json() : null)),
      fetch(CAMERAS_URL).then((r) => (r.ok ? r.json() : null)),
    ])
    if (tenantsRes?.tenants) setTenants(tenantsRes.tenants.map((t: { id: number; name: string }) => ({ id: t.id, name: t.name })))
    if (relaysRes?.siteRelays) setSiteRelays(relaysRes.siteRelays)
    if (camerasRes?.cameras) setCameras(camerasRes.cameras)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDeleteCamera(id: string) {
    if (!window.confirm('Delete this camera?')) return
    const response = await fetch(`${CAMERAS_URL}/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      window.alert("Couldn't delete - please try again.")
      return
    }
    loadAll()
  }

  const editingCamera = cameras.find((c) => c.id === editingId) ?? null

  if (loading) {
    return <div className="mx-auto max-w-7xl px-6 pb-10 pt-10 text-sm text-muted-400">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pb-10 pt-10">
      <h1 className="mb-6 text-xl font-black uppercase tracking-wide text-primary">Cameras</h1>

      <div className="mb-6">
        <SiteRelaysSection tenants={tenants} siteRelays={siteRelays} onChanged={loadAll} />
      </div>

      <div className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Cameras</div>
          {!showAddForm && (
            <button type="button" onClick={() => setShowAddForm(true)} className={primaryButtonClass}>
              + Add camera
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="mb-6">
            <CameraForm
              tenants={tenants}
              siteRelays={siteRelays}
              initial={BLANK_CAMERA_FORM}
              onSaved={() => {
                setShowAddForm(false)
                loadAll()
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {cameras.length === 0 && <div className="text-sm text-muted-500">No cameras yet.</div>}
          {cameras.map((camera) =>
            editingCamera?.id === camera.id ? (
              <div key={camera.id} className="mb-2">
                <CameraForm
                  tenants={tenants}
                  siteRelays={siteRelays}
                  initial={{
                    id: camera.id,
                    tenantId: camera.tenantId,
                    siteRelayId: camera.siteRelayId,
                    name: camera.name,
                    mode: camera.mode,
                    youtubeVideoId: camera.youtubeVideoId ?? '',
                    pushEnabled: camera.pushEnabled,
                    ...parseRtspAddress(camera.rtspAddress),
                  }}
                  onSaved={() => {
                    setEditingId(null)
                    loadAll()
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div key={camera.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-slate-900/60 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-primary">{camera.name}</div>
                  <div className="text-xs text-muted-400">
                    {tenants.find((t) => t.id === camera.tenantId)?.name ?? `Tenant #${camera.tenantId}`} — {camera.mode}
                    {(camera.mode === 'stream' || camera.mode === 'both') && (
                      <span className={camera.pushEnabled ? 'ml-2 text-status-good' : 'ml-2 text-muted-500'}>
                        {camera.pushEnabled ? '● pushing' : '○ not pushing'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(camera.id)}
                    className="rounded border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary hover:border-accent-sky-500 hover:text-accent-sky-400"
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDeleteCamera(camera.id)} className={dangerButtonClass}>
                    Delete
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
