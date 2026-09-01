import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlotAppearanceEditor } from '../components/media/CarouselSlotEditor'
import type { MediaSlotVisual } from '../components/media/MediaSlotRenderer'
import type { CropRect } from '../types/mediaLibrary'

const TENANTS_URL = '/api/platform/tenants'
const SLOT_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1)

interface CafeOwnerSlot {
  slotNumber: number
  enabled: boolean
  mediaType: 'image' | 'mp4' | 'pdf'
  durationSeconds: number
  mediaLibraryId: string | null
  // Always null for an owner-assigned slot (no webcam/gyropedia option
  // here) - present only so this shape structurally satisfies
  // CarouselSlot for SlotAppearanceEditor's own prop type.
  cameraSlotNumber: number | null
  cameraId: string | null
  fitMode: 'fill' | 'contain'
  cropRect: CropRect
  rotationDegrees: number
  brightnessPercent: number
  bannerText: string
  bannerOpacity: number
  bannerFontSize: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  zone: 'both' | 'left' | 'right'
  // Not exposed as a control on this page (not part of this round's
  // scope) - always false, present only for the same structural-typing
  // reason as cameraSlotNumber/cameraId above.
  autoFullscreen: boolean
  // Owner-assigned content is always image/mp4/pdf (MEDIA_TYPE_OPTIONS
  // above) - 'website' is never a possibility here, so both of these
  // are always null/false, present only for the same structural-typing
  // reason as cameraSlotNumber/cameraId/autoFullscreen above.
  externalUrl: string | null
  websiteFixedCanvas: boolean
  // Per-tenant Reserved Slot round (migration 0102) - is THIS slot
  // number currently designated Airfield-Central-controlled for THIS
  // tenant. Replaces the old fixed-to-5/8/12 ownerSlotUnlocked toggle;
  // any of 1-12 can be true now.
  ownerSlotReserved: boolean
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

function toVisual(slot: CafeOwnerSlot): MediaSlotVisual {
  return {
    mediaType: slot.mediaType,
    resolvedUrl: slot.resolvedUrl,
    fitMode: slot.fitMode,
    cropRect: slot.cropRect,
    rotationDegrees: slot.rotationDegrees,
    brightnessPercent: slot.brightnessPercent,
    bannerText: slot.bannerText,
    bannerOpacity: slot.bannerOpacity,
    bannerFontSize: slot.bannerFontSize,
    websiteFixedCanvas: false,
  }
}

// Platform-admin-only: assign owner-sold/leased ad content to any of a
// venue_cafe tenant's 12 café carousel slots - Café Reserved Owner Slots
// round (migration 0092), made per-tenant/per-slot dynamic (migration
// 0102) rather than fixed to slots 5/8/12 platform-wide. A near-
// duplicate of the dashboard's own PlatformCarouselOwnerSlotsPage.tsx
// (carousel_slots, still fixed to 5/8/12 - out of scope for this round),
// same duplicate-not-parameterize convention already established
// between the tenant-facing carousel/cafe-carousel route pair.
//
// One deliberate structural difference: that page is reached via a
// per-tenant Link from PlatformTenantsPage.tsx's own detail pane
// (:id in the URL). This page owns its OWN tenant selector instead -
// there's no equivalent "café tenants" detail pane to link from yet,
// and browsing straight to a dropdown of venue_cafe tenants is a
// shorter path to the one thing this page is ever used for. No :id
// route param; the selected tenant is component state, optionally
// pre-seeded from a ?tenantId= query param (PlatformTenantsPage.tsx's
// own "Manage reserved slots" link for a venue_cafe tenant sets this).
//
// No "Unlocked" text about a separate time-budget toggle (unlike the
// dashboard page's own copy) - café's isReserved is unconditional
// (functions/api/tenant/cafe-carousel/index.ts), there's no
// carousel_budget_enabled equivalent to explain here.
//
// Appearance/Duration/Fit Mode/Zone round: Source/Duration/Fit Mode/
// Zone are hand-built below (a different enough shape from the standard
// tenant-facing editor - an upload button alongside the library picker,
// no camera/gyropedia options) but the zoom/pan/rotate/brightness/
// banner editor reuses CarouselSlotEditor.tsx's own exported
// SlotAppearanceEditor directly - same underlying cafe_carousel_slots
// row shape, no reason to hand-duplicate that genuinely complex piece.
export default function PlatformCafeCarouselOwnerSlotsPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Café Reserved Slots — Airfield Central'
  }, [])

  const [searchParams] = useSearchParams()
  const preselectTenantId = searchParams.get('tenantId')

  const [tenants, setTenants] = useState<CafeTenant[]>([])
  const [tenantsLoading, setTenantsLoading] = useState(true)
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null)

  const [slots, setSlots] = useState<CafeOwnerSlot[]>([])
  const [files, setFiles] = useState<MediaFile[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  // Per-tenant Reserved Slot round - which of the 12 slots this page is
  // currently showing the detail card for. Re-picked (below, on load)
  // to the tenant's own first currently-reserved slot when one exists,
  // so switching tenants doesn't leave the picker sitting on a slot
  // that's meaningless for the newly-selected tenant.
  const [selectedSlotNumber, setSelectedSlotNumber] = useState<number>(1)
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({})
  const [appearanceOpen, setAppearanceOpen] = useState<Record<number, boolean>>({})
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
        // Pre-select from ?tenantId= (PlatformTenantsPage.tsx's own link)
        // when it names a real venue_cafe tenant; otherwise fall back to
        // the first one, same as before this query param existed.
        const preselected = preselectTenantId ? cafeTenants.find((t) => String(t.id) === preselectTenantId) : undefined
        if (preselected) setSelectedTenantId(preselected.id)
        else if (cafeTenants.length > 0) setSelectedTenantId(cafeTenants[0].id)
      })
      .finally(() => {
        if (!cancelled) setTenantsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [preselectTenantId])

  useEffect(() => {
    if (selectedTenantId === null) return
    let cancelled = false
    setSlotsLoading(true)
    setUploadError(null)
    fetch(`${TENANTS_URL}/${selectedTenantId}/cafe-carousel-owner-slots`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const loadedSlots: CafeOwnerSlot[] = data.slots ?? []
        setSlots(loadedSlots)
        setFiles(data.files ?? [])
        const firstReserved = loadedSlots.find((s) => s.ownerSlotReserved)
        setSelectedSlotNumber(firstReserved ? firstReserved.slotNumber : 1)
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
              ownerSlotReserved: updated.ownerSlotReserved,
              enabled: updated.enabled,
              mediaType: updated.mediaType,
              durationSeconds: updated.durationSeconds,
              mediaLibraryId: updated.mediaLibraryId,
              fitMode: updated.fitMode,
              cropRect: updated.cropRect,
              rotationDegrees: updated.rotationDegrees,
              brightnessPercent: updated.brightnessPercent,
              bannerText: updated.bannerText,
              bannerOpacity: updated.bannerOpacity,
              bannerFontSize: updated.bannerFontSize,
              zone: updated.zone,
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
  const reservedSlotNumbers = slots.filter((s) => s.ownerSlotReserved).map((s) => s.slotNumber)
  const slot = slots.find((s) => s.slotNumber === selectedSlotNumber) ?? null

  return (
    <div className="mx-auto max-w-3xl px-6 pb-10 pt-10">
      <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Café Reserved Slots</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Reserved, developer-only ad/marketing space on a venue_cafe tenant's Media Screen. Any of the 12 café
        carousel slots can be designated Airfield-Central-controlled per tenant - new signups start with slots 5, 8,
        and 12 reserved (unchanged from before); use the picker below to reserve a different or additional slot for
        a specific tenant.
      </p>

      <label className="mb-4 flex max-w-sm flex-col gap-1.5">
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

      {selectedTenant && !slotsLoading && (
        <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-muted-400">
          Reserved: {reservedSlotNumbers.length > 0 ? reservedSlotNumbers.join(', ') : 'none'}
        </p>
      )}

      {uploadError && (
        <p className="mb-4 rounded-lg border border-status-bad/40 bg-status-bad/10 px-3 py-2 text-xs text-status-bad">{uploadError}</p>
      )}

      {selectedTenant && slotsLoading && <div className="text-sm text-muted-400">Loading {selectedTenant.name}'s slots…</div>}

      {selectedTenant && !slotsLoading && (
        <label className="mb-6 flex max-w-xs flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Slot number</span>
          <select
            value={selectedSlotNumber}
            onChange={(event) => setSelectedSlotNumber(Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            {SLOT_NUMBERS.map((n) => (
              <option key={n} value={n}>
                Slot {n}
                {reservedSlotNumbers.includes(n) ? ' (Reserved)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {selectedTenant && !slotsLoading && slot && (
        <section className="max-w-xl rounded-2xl border border-border bg-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Slot {slot.slotNumber}</div>
            <div className="flex overflow-hidden rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => slot.ownerSlotReserved && saveSlot(slot.slotNumber, { ownerSlotReserved: false })}
                className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                  !slot.ownerSlotReserved ? 'bg-accent-sky-500 text-white' : 'bg-slate-900/80 text-muted-400 hover:text-white'
                }`}
              >
                Tenant-controlled
              </button>
              <button
                type="button"
                onClick={() => !slot.ownerSlotReserved && saveSlot(slot.slotNumber, { ownerSlotReserved: true })}
                className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                  slot.ownerSlotReserved ? 'bg-accent-sky-500 text-white' : 'bg-slate-900/80 text-muted-400 hover:text-white'
                }`}
              >
                Airfield Central
              </button>
            </div>
          </div>

          {!slot.ownerSlotReserved ? (
            <p className="text-xs text-muted-500">
              Tenant-controlled - this slot behaves as a normal slot in this tenant's own Café Media editor. Switch to
              "Airfield Central" to reserve it and assign content here.
            </p>
          ) : (
            <>
              {(() => {
                const status = saveStatus[slot.slotNumber] ?? 'idle'
                const isMp4 = slot.mediaType === 'mp4'
                const file = files.find((f) => f.id === slot.mediaLibraryId)
                const showAppearanceControls = slot.mediaType === 'image' || slot.mediaType === 'mp4'
                const isAppearanceOpen = !!appearanceOpen[slot.slotNumber]
                return (
                  <>
                    <label className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-400">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(event) => saveSlot(slot.slotNumber, { enabled: event.target.checked })}
                        className="h-3.5 w-3.5"
                      />
                      Live
                    </label>
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
                      className="mb-3 w-full rounded-lg border border-border bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500 disabled:opacity-50"
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

                    <label className="mb-2 flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Duration (seconds)</span>
                      {isMp4 ? (
                        <input
                          type="text"
                          readOnly
                          value={file?.mp4DurationSeconds ? `Detected: ${file.mp4DurationSeconds.toFixed(1)}s` : 'Detected on upload'}
                          className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm text-muted-400"
                        />
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={slot.durationSeconds}
                          onChange={(event) => saveSlot(slot.slotNumber, { durationSeconds: Number(event.target.value) || 10 })}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        />
                      )}
                    </label>

                    {(slot.mediaType === 'image' || slot.mediaType === 'mp4') && (
                      <label className="mb-2 flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Fit mode</span>
                        <select
                          value={slot.fitMode}
                          onChange={(event) => saveSlot(slot.slotNumber, { fitMode: event.target.value as CafeOwnerSlot['fitMode'] })}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        >
                          <option value="contain">Fit (show whole image, letterboxed if needed)</option>
                          <option value="fill">Fill (crop to fill the box)</option>
                        </select>
                      </label>
                    )}

                    <label className="mb-2 flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Zone (Café split-pane)</span>
                      <select
                        value={slot.zone}
                        onChange={(event) => saveSlot(slot.slotNumber, { zone: event.target.value as CafeOwnerSlot['zone'] })}
                        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                      >
                        <option value="both">Both</option>
                        <option value="left">Left only</option>
                        <option value="right">Right only</option>
                      </select>
                    </label>

                    {showAppearanceControls && (
                      <button
                        type="button"
                        onClick={() => setAppearanceOpen((prev) => ({ ...prev, [slot.slotNumber]: !prev[slot.slotNumber] }))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 transition hover:border-sky-500"
                      >
                        {isAppearanceOpen ? '▾ Close appearance editor' : '🎨 Edit appearance'}
                      </button>
                    )}

                    {isAppearanceOpen && showAppearanceControls && (
                      <SlotAppearanceEditor
                        slot={slot}
                        visual={toVisual(slot)}
                        onChange={(patch) => saveSlot(slot.slotNumber, patch)}
                      />
                    )}

                    {status === 'success' && <p className="mt-2 text-xs font-semibold text-status-good">Saved.</p>}
                    {status === 'error' && <p className="mt-2 text-xs font-semibold text-status-bad">Couldn't save.</p>}
                  </>
                )
              })()}
            </>
          )}
        </section>
      )}
    </div>
  )
}
