import type { MediaItem } from '../../types/media'

function renderMediaContent(item: MediaItem) {
  switch (item.type) {
    case 'image':
      return <img src={item.src} alt={item.alt} className="h-full w-full object-contain" />
    case 'empty':
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold text-white">Media Panel</div>
          <div className="text-sm text-slate-400">Images, webcam, alerts, or slideshow content</div>
        </div>
      )
  }
}

function mediaTypeLabel(item: MediaItem): string {
  return item.type === 'empty' ? 'Placeholder' : item.type
}

interface MediaPanelProps {
  item: MediaItem
}

export default function MediaPanel({ item }: MediaPanelProps): JSX.Element {
  return (
    <div
      className="aspect-video h-full max-w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950/90 shadow-lg shadow-slate-950/30"
    >
      <div className="flex h-full flex-col rounded-lg border border-dashed border-slate-700 bg-slate-900/60">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
          <div className="text-sm font-semibold uppercase tracking-widest text-slate-400">Media</div>
          <div className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
            {mediaTypeLabel(item)}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-hidden p-6 text-center">
          {renderMediaContent(item)}
        </div>
      </div>
    </div>
  )
}
