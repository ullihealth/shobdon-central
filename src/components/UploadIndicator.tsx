import { useEffect } from 'react'
import { useUpload } from '../context/UploadContext'

// Same "fixed-position, global, sibling of <Routes>" placement
// convention as PreviewBanner.tsx - rendered once in App.tsx so it
// shows on every route (admin pages AND every public dashboard
// template) regardless of which page started the upload, since
// UploadProvider (also mounted in App.tsx) keeps tracking it long
// after MediaLibraryPage itself may have unmounted. Bottom-right, not
// PreviewBanner's top strip - avoids any visual collision with that
// banner and with Header.tsx's own clock/status row, on the rare
// occasion both could theoretically be visible together.
//
// pointerEvents: 'none', no close button - matches this project's own
// established posture for anything that can render on the unattended
// public dashboard templates (nothing dismissible or attention-
// grabbing): a developer/media-role admin uploading a file is the only
// audience who'll ever see this in practice, but the component itself
// has no way to know which route it's currently rendering on, so it's
// built to the same standard as anything else global-and-always-
// mounted rather than assuming admin-only context.
const AUTO_DISMISS_MS = 4000

export default function UploadIndicator(): JSX.Element | null {
  const { status, filename, percent, errorMessage, dismiss } = useUpload()

  // Success/error states auto-clear after a few seconds so the
  // indicator doesn't sit there forever after an upload has actually
  // finished - 'uploading' never triggers this (only a completed status
  // schedules its own dismissal), and MediaLibraryPage's own effect
  // (see that file's comment) already reacts to 'success' to refresh
  // its file list before this timer fires.
  useEffect(() => {
    if (status !== 'success' && status !== 'error') return
    const timeoutId = window.setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timeoutId)
  }, [status, dismiss])

  if (status === 'idle') return null

  const label =
    status === 'uploading'
      ? `Uploading ${filename} — ${percent}%`
      : status === 'success'
        ? `✅ ${filename} uploaded`
        : `❌ ${errorMessage ?? 'Upload failed'}`

  const accentColor = status === 'error' ? '#ef4444' : status === 'success' ? '#22c55e' : '#38bdf8'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 2147483647,
        maxWidth: '360px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px 14px',
        borderRadius: '10px',
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        border: `1px solid ${accentColor}`,
        color: '#e2e8f0',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {status === 'uploading' && (
        <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'rgba(148, 163, 184, 0.3)' }}>
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              borderRadius: '2px',
              backgroundColor: accentColor,
              transition: 'width 150ms linear',
            }}
          />
        </div>
      )}
    </div>
  )
}
