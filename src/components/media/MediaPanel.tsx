import { useState } from 'react'
import type { MediaItem } from '../../types/media'
import { loadClubProfile } from '../../services/clubProfileStore'

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
  // whenever it's set - empty string (no webcam configured) falls back to
  // item exactly as before. Configurable via clubProfileStore.ts, not a
  // code deploy.
  const [webcamUrl] = useState(() => loadClubProfile().webcamUrl)

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
