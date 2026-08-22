import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

const TENANTS_URL = '/api/platform/tenants'

interface OwnerSlot {
  slotNumber: number
  mediaType: 'image' | 'mp4' | 'pdf'
  mediaLibraryId: string | null
  ownerSlotUnlocked: boolean
  ownerContentAssigned: boolean
  filename: string | null
  resolvedUrl: string | null
  mp4DurationSeconds: number | null
}

interface MediaFile {
  id: string
  filename: string
  mediaType: string
  mp4DurationSeconds: number | null
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

const MEDIA_TYPE_OPTIONS: OwnerSlot['mediaType'][] = ['image', 'mp4', 'pdf']

// Platform-admin-only: assign owner-sold/leased ad content to a
// specific tenant's reserved carousel slots (5/8/12) and toggle the
// per-slot manual unlock - Reserved Owner Slots & Time Budget round.
// Mirrors the requirePlatformAdmin + explicit :id path-param shape
// PlatformTenantsPage.tsx's ParentAirfieldEditor already established
// for cross-tenant writes, just as its own dedicated page (browsing one
// tenant's 3 reserved slots is enough surface area to not want to
// squeeze it into the main tenant detail pane).
export default function PlatformCarouselOwnerSlotsPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Reserved Owner Slots — Airfield Central'
  }, [])

  const { id } = useParams<{ id: string }>()
  const [tenantName, setTenantName] = useState<string | null>(null)
  const [slots, setSlots] = useState<OwnerSlot[]>([])
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({})
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      fetch(TENANTS_URL).then((response) => (response.ok ? response.json() : null)),
      fetch(`${TENANTS_URL}/${id}/carousel-owner-slots`).then((response) => (response.ok ? response.json() : null)),
    ]).then(([tenantsData, slotsData]) => {
      if (cancelled) return
      const tenant = tenantsData?.tenants?.find((t: { id: number }) => String(t.id) === id)
      if (tenant) setTenantName(tenant.name)
      if (slotsData) {
        setSlots(slotsData.slots ?? [])
        setFiles(slotsData.files ?? [])
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  async function saveSlot(slotNumber: number, patch: Partial<OwnerSlot>) {
    const current = slots.find((s) => s.slotNumber === slotNumber)
    if (!current) return
    const updated = { ...current, ...patch }
    setSlots((prev) => prev.map((s) => (s.slotNumber === slotNumber ? updated : s)))
    setSaveStatus((prev) => ({ ...prev, [slotNumber]: 'working' }))
    try {
      const response = await fetch(`${TENANTS_URL}/${id}/carousel-owner-slots`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: [
            {
              slotNumber,
              mediaType: updated.mediaType,
              mediaLibraryId: updated.mediaLibraryId,
              ownerSlotUnlocked: updated.ownerSlotUnlocked,
            },
          ],
        }),
      })
      if (!response.ok) {
        setSaveStatus((prev) => ({ ...prev, [slotNumber]: 'error' }))
        return
      }
      const data = await response.json()
      setSlots(data.slots ?? [])
      setFiles(data.files ?? files)
      setSaveStatus((prev) => ({ ...prev, [slotNumber]: 'success' }))
    } catch {
      setSaveStatus((prev) => ({ ...prev, [slotNumber]: 'error' }))
    }
  }

  async function handleFileUpload(slotNumber: number, mediaType: OwnerSlot['mediaType'], file: File) {
    setUploadingSlot(slotNumber)
    setUploadError(null)
    try {
      let mp4DurationSeconds: number | null = null
      if (mediaType === 'mp4') {
        mp4DurationSeconds = await new Promise<number | null>((resolve) => {
          const video = document.createElement('video')
          video.preload = 'metadata'
          video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : null)
          video.onerror = () => resolve(null)
          video.src = URL.createObjectURL(file)
        })
      }
      const params = new URLSearchParams({ filename: file.name, mediaType })
      if (mp4DurationSeconds) params.set('mp4DurationSeconds', String(mp4DurationSeconds))
      const response = await fetch(`${TENANTS_URL}/${id}/media-library-upload?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setUploadError(data?.error ?? 'Upload failed.')
        return
      }
      const uploaded = await response.json()
      setFiles((prev) => [{ id: uploaded.id, filename: uploaded.filename, mediaType: uploaded.mediaType, mp4DurationSeconds: uploaded.mp4DurationSeconds }, ...prev])
      await saveSlot(slotNumber, { mediaType, mediaLibraryId: uploaded.id })
    } finally {
      setUploadingSlot(null)
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 pb-10 pt-10 text-sm text-muted-400">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pb-10 pt-10">
      <Link to="/platform/tenants" className="mb-4 inline-block text-xs font-semibold text-accent-sky-400 hover:underline">
        ← Back to Tenants
      </Link>
      <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Reserved Owner Slots</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        {tenantName ?? `Tenant #${id}`}'s carousel slots 5, 8, and 12 - owner-controlled ad/marketing space, sold
        directly or leased to the tenant. Assign content and manage the per-slot manual unlock here. Has no effect
        unless "Reserved owner slots + time budget" is switched on for this tenant (Tenants page).
      </p>

      {uploadError && (
        <p className="mb-4 rounded-lg border border-status-bad/40 bg-status-bad/10 px-3 py-2 text-xs text-status-bad">{uploadError}</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {slots.map((slot) => {
          const status = saveStatus[slot.slotNumber] ?? 'idle'
          return (
            <section key={slot.slotNumber} className="rounded-2xl border border-border bg-panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Slot {slot.slotNumber}</div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-400">
                  <input
                    type="checkbox"
                    checked={slot.ownerSlotUnlocked}
                    onChange={(event) => saveSlot(slot.slotNumber, { ownerSlotUnlocked: event.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  Unlocked
                </label>
              </div>

              {slot.ownerSlotUnlocked ? (
                <p className="text-xs text-muted-500">
                  Unlocked - this slot behaves as a normal tenant-controlled slot for this tenant. Uncheck "Unlocked"
                  to reserve it again.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-slate-950">
                    {slot.ownerContentAssigned && slot.resolvedUrl ? (
                      slot.mediaType === 'image' ? (
                        <img src={slot.resolvedUrl} alt="" className="h-full w-full object-contain" />
                      ) : slot.mediaType === 'mp4' ? (
                        <video src={slot.resolvedUrl} className="h-full w-full object-contain" muted loop autoPlay playsInline />
                      ) : (
                        <span className="text-xs text-muted-500">PDF: {slot.filename}</span>
                      )
                    ) : (
                      <span className="text-xs uppercase tracking-widest text-muted-600">No content assigned - shows "Media Reserved" live</span>
                    )}
                  </div>

                  <label className="mb-2 flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Content type</span>
                    <select
                      value={slot.mediaType}
                      onChange={(event) => saveSlot(slot.slotNumber, { mediaType: event.target.value as OwnerSlot['mediaType'], mediaLibraryId: null })}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    >
                      {MEDIA_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="mb-2 flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Existing file in this tenant's library</span>
                    <select
                      value={slot.mediaLibraryId ?? ''}
                      onChange={(event) => saveSlot(slot.slotNumber, { mediaLibraryId: event.target.value || null })}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    >
                      <option value="">— None (show Media Reserved placeholder) —</option>
                      {files
                        .filter((f) => f.mediaType === slot.mediaType)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.filename}
                          </option>
                        ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[slot.slotNumber]?.click()}
                    disabled={uploadingSlot === slot.slotNumber}
                    className="w-full rounded-lg border border-border bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500 disabled:opacity-50"
                  >
                    {uploadingSlot === slot.slotNumber ? 'Uploading…' : 'Upload new file for this slot'}
                  </button>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[slot.slotNumber] = el
                    }}
                    type="file"
                    accept={slot.mediaType === 'image' ? 'image/*' : slot.mediaType === 'mp4' ? 'video/mp4' : 'application/pdf'}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) handleFileUpload(slot.slotNumber, slot.mediaType, file)
                      event.target.value = ''
                    }}
                  />

                  {status === 'success' && <p className="mt-2 text-xs font-semibold text-status-good">Saved.</p>}
                  {status === 'error' && <p className="mt-2 text-xs font-semibold text-status-bad">Couldn't save.</p>}
                </>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
