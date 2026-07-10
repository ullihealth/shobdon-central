import { useEffect, useState } from 'react'
import type { MediaItem } from '../../types/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'

function renderMediaContent(item: MediaItem) {
  switch (item.type) {
    case 'image':
      return <img src={item.src} alt={item.alt} className="h-full w-full object-contain" />
    case 'empty':
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold text-primary">Media Panel</div>
          <div className="text-sm text-muted-400">Images, webcam, alerts, or slideshow content</div>
        </div>
      )
  }
}

function mediaTypeLabel(item: MediaItem, webcamUrl: string): string {
  if (webcamUrl) return 'webcam'
  return item.type === 'empty' ? 'Placeholder' : item.type
}

interface MediaPanelProps {
  item: MediaItem
}

export default function MediaPanel({ item }: MediaPanelProps): JSX.Element {
  // Club-configured live webcam takes priority over item (image/placeholder)
  // whenever it's set - empty string (no webcam configured, or not yet
  // loaded) falls back to item exactly as before. Was a synchronous
  // loadClubProfile().webcamUrl (localStorage) read - now camera slot 1
  // from the tenant-scoped public config endpoint (the single webcamUrl
  // became a fixed 3-slot camera array in phase 0; slot 1 is the direct
  // successor of the old webcamUrl). No auth here deliberately - this is
  // the live public dashboard, unauthenticated for everyone, same as today.
  const [webcamUrl, setWebcamUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const slotOne = data?.cameraSlots?.find((slot: { slot: number; url: string }) => slot.slot === 1)
        if (!cancelled && slotOne?.url) setWebcamUrl(slotOne.url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="aspect-video h-full max-h-full max-w-full overflow-hidden rounded-xl border border-border bg-slate-950/90 shadow-lg shadow-slate-950/30"
    >
      <div className="flex h-full flex-col rounded-lg border border-dashed border-border bg-slate-900/60">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="text-sm font-semibold uppercase tracking-widest text-muted-400">Media</div>
          <div className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-widest text-muted-400">
            {mediaTypeLabel(item, webcamUrl)}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-hidden p-6 text-center">
          {webcamUrl ? (
            <iframe
              src={webcamUrl}
              className="h-full w-full"
              style={{ border: 0 }}
              allowFullScreen
              title="Aeroclub webcam"
            />
          ) : (
            renderMediaContent(item)
          )}
        </div>
      </div>
    </div>
  )
}
