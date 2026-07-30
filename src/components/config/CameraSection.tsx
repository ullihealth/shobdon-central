import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { TENANT_CAMERAS_URL, tenantCameraUrl } from '../../config/publicApi'

type CameraMode = 'local' | 'stream' | 'both'
type SaveStatus = 'idle' | 'working' | 'success' | 'error'

interface TenantCamera {
  id: string
  name: string
  mode: CameraMode
  youtubeVideoId: string | null
  rtspConfigured: boolean
  pushEnabled: boolean
  createdAt: string
}

const labelClass = 'mb-1 block text-xs uppercase tracking-wide text-muted-400'
const inputClass = 'rounded border border-border bg-slate-900 px-3 py-2 text-sm text-primary focus:border-sky-500 focus:outline-none'
const primaryButtonClass = 'shrink-0 rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40'

// Self-service edit of this tenant's own already-provisioned camera(s) -
// PATCH /api/tenant/cameras/:id (functions/api/tenant/cameras/[id].ts).
// Deliberately no create/delete/site-relay picker here - a camera only
// ever exists after the platform admin has physically wired it to a
// relay via /platform/cameras (see that page's own comment); this form
// edits an existing row's logical settings only.
//
// RTSP fields are collapsed behind an "Update RTSP source" toggle rather
// than pre-filled - the GET response never includes rtsp_address at all
// (matching the "never sent to the browser" posture the RTSP relay poll
// route already established), so there is no current value to show.
// Leaving the toggle off on save keeps whatever was last set; toggling
// it on and filling the fields overwrites it. Same "blank means
// unchanged" convention as a password-change form.
function CameraEditForm({ camera, onSaved }: { camera: TenantCamera; onSaved: () => void }): JSX.Element {
  const [name, setName] = useState(camera.name)
  const [mode, setMode] = useState<CameraMode>(camera.mode)
  const [youtubeVideoId, setYoutubeVideoId] = useState(camera.youtubeVideoId ?? '')
  const [updateRtsp, setUpdateRtsp] = useState(false)
  const [rtspIp, setRtspIp] = useState('')
  const [rtspPort, setRtspPort] = useState('554')
  const [rtspUsername, setRtspUsername] = useState('')
  const [rtspPassword, setRtspPassword] = useState('')
  const [rtspPath, setRtspPath] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const needsRtsp = mode === 'local' || mode === 'both'
  const needsYoutube = mode === 'stream' || mode === 'both'
  const rtspSatisfied = !needsRtsp || camera.rtspConfigured || (updateRtsp && rtspIp.trim() !== '')
  const canSave = name.trim() !== '' && (!needsYoutube || youtubeVideoId.trim() !== '') && rtspSatisfied

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setStatus('working')
    setError(null)
    try {
      const response = await fetch(tenantCameraUrl(camera.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          youtubeVideoId: needsYoutube ? youtubeVideoId.trim() : null,
          rtsp: needsRtsp && updateRtsp ? { ip: rtspIp.trim(), port: rtspPort.trim(), username: rtspUsername.trim(), password: rtspPassword, path: rtspPath.trim() } : undefined,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(typeof data?.error === 'string' ? data.error : "Couldn't save - please try again.")
        setStatus('error')
        return
      }
      // Password never lingers in memory past a successful save.
      setUpdateRtsp(false)
      setRtspIp('')
      setRtspPort('554')
      setRtspUsername('')
      setRtspPassword('')
      setRtspPath('')
      setStatus('success')
      onSaved()
    } catch {
      setError("Couldn't save - please try again.")
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-slate-900/40 p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className={labelClass}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Runway View" className={`w-56 ${inputClass}`} required />
        </div>
        <div>
          <label className={labelClass}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as CameraMode)} className={`w-32 ${inputClass}`}>
            <option value="local">Local</option>
            <option value="stream">Stream</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      {needsRtsp && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-400">
            RTSP source (relay-side only — never sent to the browser)
            <span className={camera.rtspConfigured ? 'normal-case font-normal text-status-good' : 'normal-case font-normal text-status-bad'}>
              {camera.rtspConfigured ? '● configured' : '○ not set'}
            </span>
          </div>
          {!updateRtsp ? (
            <button
              type="button"
              onClick={() => setUpdateRtsp(true)}
              className="rounded border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary hover:border-accent-sky-500 hover:text-accent-sky-400"
            >
              Update RTSP source
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={labelClass}>IP address</label>
                <input value={rtspIp} onChange={(e) => setRtspIp(e.target.value)} placeholder="192.168.1.60" className={`w-40 ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input value={rtspPort} onChange={(e) => setRtspPort(e.target.value)} placeholder="554" className={`w-20 ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Username</label>
                <input value={rtspUsername} onChange={(e) => setRtspUsername(e.target.value)} className={`w-32 ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input type="password" value={rtspPassword} onChange={(e) => setRtspPassword(e.target.value)} className={`w-32 ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Path</label>
                <input value={rtspPath} onChange={(e) => setRtspPath(e.target.value)} placeholder="/stream1" className={`w-32 ${inputClass}`} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setUpdateRtsp(false)
                  setRtspIp('')
                  setRtspPort('554')
                  setRtspUsername('')
                  setRtspPassword('')
                  setRtspPath('')
                }}
                className="text-xs font-semibold uppercase tracking-wide text-muted-400 hover:text-primary"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {needsYoutube && (
        <div>
          <label className={labelClass}>YouTube video id</label>
          <input
            value={youtubeVideoId}
            onChange={(e) => setYoutubeVideoId(e.target.value)}
            placeholder="dQw4w9WgXcQ"
            className={`w-64 ${inputClass}`}
          />
          <p className="mt-1 text-xs text-muted-500">The persistent YouTube Live video id viewers embed.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === 'working' || !canSave} className={primaryButtonClass}>
          {status === 'working' ? 'Saving…' : 'Save changes'}
        </button>
        {status === 'success' && <span className="text-xs text-status-good">Saved.</span>}
        {status === 'error' && <span className="text-xs text-status-bad">{error}</span>}
      </div>
    </form>
  )
}

// Self-fetching, same pattern as this page's other sections
// (AirfieldLocationSection, StorageUsage) - reads/writes through
// functions/api/tenant/cameras/* rather than the combined
// /api/tenant/config route, since camera edits have their own
// never-return-rtsp-to-the-browser posture that the general config PUT
// handler doesn't need to know about.
//
// Omitted entirely (no placeholder) when this tenant has zero cameras -
// same "hide unless relevant" convention ConfigPage.tsx already applies
// to PC2CaptureSetup for tenants without physical ATC hardware. A
// camera only ever exists once the platform admin has physically wired
// one up, so there's nothing to self-manage until then.
export default function CameraSection(): JSX.Element | null {
  const [cameras, setCameras] = useState<TenantCamera[] | null>(null)

  function load() {
    fetch(TENANT_CAMERAS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (Array.isArray(data?.cameras)) setCameras(data.cameras)
      })
      .catch(() => {})
  }

  useEffect(load, [])

  if (cameras === null || cameras.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">Camera{cameras.length > 1 ? 's' : ''}</h3>
      <p className="mb-4 text-sm text-muted-300">
        Edit the name, mode, and connection details for your camera{cameras.length > 1 ? 's' : ''} below. New cameras
        and relay hardware are set up by your platform administrator.
      </p>
      <div className="flex flex-col gap-4">
        {cameras.map((camera) => (
          <CameraEditForm key={camera.id} camera={camera} onSaved={load} />
        ))}
      </div>
    </div>
  )
}
