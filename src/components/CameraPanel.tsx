import { useEffect, useState } from 'react'

interface PublicCamera {
  id: string
  name: string
  mode: 'local' | 'stream' | 'both'
  youtubeVideoId: string | null
  localStreamUrl: string | null
  pushEnabled: boolean
}

interface CameraPanelProps {
  // Same self-fetch-or-take-a-prop convention as MediaPanel.tsx/
  // RightInfoPanel.tsx - omitted on the real public dashboard (self-
  // fetches via Host resolution), provided by an authenticated admin
  // preview that's already resolved a specific tenant.
  data?: PublicCamera[]
  // Shows the push-enabled toggle + "+ Add camera" link - only ever
  // true on an authenticated admin-facing view, never the public
  // unauthenticated TV dashboard (a viewer there has no session to
  // toggle anything with, and no business seeing an admin shortcut).
  showControls?: boolean
}

// go2rtc's own built-in stream page handles the local HLS/WebRTC
// negotiation - embedding it directly avoids needing a video/HLS
// library as a new dependency. onError only reliably fires for
// connection-level failures (DNS/refused), which is the realistic
// failure mode here (viewer not on the site's local network) - not
// every possible "loaded but blank" case, so the manual toggle below
// exists as a fallback a viewer can use themselves.
function CameraTile({ camera, showControls }: { camera: PublicCamera; showControls?: boolean }): JSX.Element {
  const [viewMode, setViewMode] = useState<'local' | 'stream'>(camera.mode === 'stream' ? 'stream' : 'local')
  // Local, optimistic mirror of camera.pushEnabled - the checkbox needs
  // to reflect real server state (not just "always unchecked"), but
  // this panel doesn't re-fetch after every toggle, so the click itself
  // updates this directly rather than waiting on a round trip.
  const [pushEnabled, setPushEnabled] = useState(camera.pushEnabled)
  const [toggling, setToggling] = useState(false)

  const showLocal = viewMode === 'local' && camera.localStreamUrl
  const showYoutube = viewMode === 'stream' && camera.youtubeVideoId

  async function handleTogglePush(nextEnabled: boolean) {
    setToggling(true)
    setPushEnabled(nextEnabled)
    try {
      const response = await fetch(`/api/tenant/cameras/${camera.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushEnabled: nextEnabled }),
      })
      if (!response.ok) setPushEnabled(!nextEnabled)
    } catch {
      setPushEnabled(!nextEnabled)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-panel">
      <div className="relative aspect-video bg-black">
        {showLocal ? (
          <iframe
            src={camera.localStreamUrl ?? undefined}
            className="h-full w-full"
            style={{ border: 0 }}
            allow="autoplay"
            allowFullScreen
            title={camera.name}
            onError={() => camera.mode === 'both' && setViewMode('stream')}
          />
        ) : showYoutube ? (
          <iframe
            src={`https://www.youtube.com/embed/${camera.youtubeVideoId}`}
            className="h-full w-full"
            style={{ border: 0 }}
            allow="autoplay; encrypted-media"
            allowFullScreen
            title={camera.name}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-500">Feed not configured</div>
        )}
        {camera.mode === 'both' && (
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'local' ? 'stream' : 'local')}
            className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white hover:bg-black/80"
          >
            {viewMode === 'local' ? 'Try remote' : 'Try local'}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="text-sm font-semibold text-primary">{camera.name}</div>
        {showControls && (camera.mode === 'stream' || camera.mode === 'both') && (
          <label className="flex items-center gap-1.5 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={pushEnabled}
              disabled={toggling}
              onChange={(e) => handleTogglePush(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Go live remotely
          </label>
        )}
      </div>
    </div>
  )
}

export default function CameraPanel({ data, showControls }: CameraPanelProps): JSX.Element | null {
  const [cameras, setCameras] = useState<PublicCamera[] | null>(data ?? null)

  useEffect(() => {
    if (data !== undefined) {
      setCameras(data)
      return
    }
    let cancelled = false
    fetch('/api/public/cameras')
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!cancelled) setCameras(result?.cameras ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [data])

  // Render nothing (not an empty-state placeholder) when a tenant has
  // no cameras at all - matches RightInfoPanel.tsx's Airfield Info card
  // convention of omitting a section entirely rather than showing a
  // hardcoded placeholder that would look like real content.
  if (!cameras || cameras.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cameras.map((camera) => (
        <CameraTile key={camera.id} camera={camera} showControls={showControls} />
      ))}
      {showControls && (
        <a
          href="/platform/cameras"
          className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-border text-3xl text-muted-500 hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          +
        </a>
      )}
    </div>
  )
}
