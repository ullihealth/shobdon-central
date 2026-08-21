import { useEffect, useRef, useState } from 'react'

const TENANTS_URL = '/api/platform/tenants'

interface CafeOwnerSlot {
  slotNumber: number
  enabled: boolean
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

interface CafeTenant {
  id: number
  name: string
  slug: string
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

const MEDIA_TYPE_OPTIONS: CafeOwnerSlot['mediaType'][] = ['image', 'mp4', 'pdf']

// Platform-admin-only: assign owner-sold/leased ad content to a
// venue_cafe tenant's reserved café carousel slots (5/8/12) - Café
// Reserved Owner Slots round (migration 0092). A near-duplicate of the
// dashboard's own PlatformCarouselOwnerSlotsPage.tsx (carousel_slots),
// same duplicate-not-parameterize convention already established
// between the tenant-facing carousel/cafe-carousel route pair.
//
// One deliberate structural difference: that page is reached via a
// per-tenant Link from PlatformTenantsPage.tsx's own detail pane
// (:id in the URL). This page owns its OWN tenant selector instead -
// there's no equivalent "café tenants" detail pane to link from yet,
// and browsing straight to a dropdown of venue_cafe tenants is a
// shorter path to the one thing this page is ever used for. No :id
// route param; the selected tenant is component state.
//
// No "Unlocked" text about a separate time-budget toggle (unlike the
// dashboard page's own copy) - café's isReserved is unconditional
// (functions/api/tenant/cafe-carousel/index.ts), there's no
// carousel_budget_enabled equivalent to explain here.
export default function PlatformCafeCarouselOwnerSlotsPage(): JSX.Element {
  const [tenants, setTenants] = useState<CafeTenant[]>([])
  const [tenantsLoading, setTenantsLoading] = useState(true)
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null)

  const [slots, setSlots] = useState<CafeOwnerSlot[]>([])
  const [files, setFiles] = useState<MediaFile[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({})
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    let cancelled = false
    fetch(TENANTS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const cafeTenants: CafeTenant[] = (data.tenants ?? [])
          .filter((t: { tenantType?: string }) => t.tenantType === 'venue_cafe')
          .map((t: { id: number; name: string; slug: string }) => ({ id: t.id, name: t.name, slug: t.slug }))
        setTenants(cafeTenants)
        if (cafeTenants.length > 0) setSelectedTenantId(cafeTenants[0].id)
      })
      .finally(() => {
        if (!cancelled) setTenantsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedTenantId === null) return
    let cancelled = false
    setSlotsLoading(true)
    setUploadError(null)
    fetch(`${TENANTS_URL}/${selectedTenantId}/cafe-carousel-owner-slots`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setSlots(data.slots ?? [])
        setFiles(data.files ?? [])
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedTenantId])

  async function saveSlot(slotNumber: number, patch: Partial<CafeOwnerSlot>) {
    if (selectedTenantId === null) return
    const current = slots.find((s) => s.slotNumber === slotNumber)
    if (!current) return
    const updated = { ...current, ...patch }
    setSlots((prev) => prev.map((s) => (s.slotNumber === slotNumber ? updated : s)))
    setSaveStatus((prev) => ({ ...prev, [slotNumber]: 'working' }))
    try {
      const response = await fetch(`${TENANTS_URL}/${selectedTenantId}/cafe-carousel-owner-slots`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: [
            {
              slotNumber,
              enabled: updated.enabled,
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

  async function handleFileUpload(slotNumber: number, mediaType: CafeOwnerSlot['mediaType'], file: File) {
    if (selectedTenantId === null) return
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
      const response = await fetch(`${TENANTS_URL}/${selectedTenantId}/media-library-upload?${params.toString()}`, {
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

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null

  return (
    <div className="mx-auto max-w-5xl px-6 pb-10 pt-10">
      <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Café Reserved Slots</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Café carousel slots 5, 8, and 12 - reserved, developer-only ad/marketing space on every venue_cafe tenant's
        Media Screen, assigned automatically on signup (migration 0092). Assign content and manage the per-slot
        manual unlock here, using that tenant's own media library/storage.
      </p>

      <label className="mb-6 flex max-w-sm flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Café tenant</span>
        <select
          value={selectedTenantId ?? ''}
          onChange={(event) => setSelectedTenantId(event.target.value ? Number(event.target.value) : null)}
          disabled={tenantsLoading || tenants.length === 0}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          {tenants.length === 0 && <option value="">{tenantsLoading ? 'Loading…' : 'No venue_cafe tenants found'}</option>}
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.slug})
            </option>
          ))}
        </select>
      </label>

      {uploadError && (
        <p className="mb-4 rounded-lg border border-status-bad/40 bg-status-bad/10 px-3 py-2 text-xs text-status-bad">{uploadError}</p>
      )}

      {selectedTenant && slotsLoading && <div className="text-sm text-muted-400">Loading {selectedTenant.name}'s slots…</div>}

      {selectedTenant && !slotsLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {slots.map((slot) => {
            const status = saveStatus[slot.slotNumber] ?? 'idle'
            return (
              <section key={slot.slotNumber} className="rounded-2xl border border-border bg-panel p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Slot {slot.slotNumber}</div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-400">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(event) => saveSlot(slot.slotNumber, { enabled: event.target.checked })}
                        className="h-3.5 w-3.5"
                      />
                      Live
                    </label>
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
                </div>

                {slot.ownerSlotUnlocked ? (
                  <p className="text-xs text-muted-500">
                    Unlocked - this slot behaves as a normal tenant-controlled slot for this tenant. Uncheck "Unlocked"
                    to reserve it again.
                  </p>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted-500">
                      {slot.enabled
                        ? 'Live on this tenant\'s café screen now.'
                        : 'Not enabled - invisible on the live café screen until "Live" is checked.'}
                    </p>
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
                        <span className="text-xs uppercase tracking-widest text-muted-600">No content assigned yet</span>
                      )}
                    </div>

                    <label className="mb-2 flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Content type</span>
                      <select
                        value={slot.mediaType}
                        onChange={(event) => saveSlot(slot.slotNumber, { mediaType: event.target.value as CafeOwnerSlot['mediaType'], mediaLibraryId: null })}
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
                        <option value="">— None —</option>
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
      )}
    </div>
  )
}
