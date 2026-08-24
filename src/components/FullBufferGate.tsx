import { useBufferingGate } from '../hooks/useVideoDownloadStates'
import VenueCornerBadge from './VenueCornerBadge'

interface FullBufferGateProps {
  // Per-tenant opt-in (tenants.full_buffer_gate_enabled, migration
  // 0094) - false renders children immediately with zero registration/
  // download side effects from this component at all, preserving every
  // non-opted-in tenant's current behaviour exactly (Shobdon: weather/
  // compass/runway display immediately, only MediaPanel's own box-scoped
  // gate applies).
  enabled: boolean
  // Every currently-included mp4 slot's resolvedUrl this page's real
  // template will show, in rotation order - registering them here (via
  // useBufferingGate, unconditionally on every render regardless of
  // whether the gate is still showing) is what actually starts their
  // downloads through the shared queue, since `children` - and the
  // MediaPanel instances nested inside it - stay entirely UNMOUNTED
  // until this gate clears. Without this component registering them
  // itself, nothing would ever start downloading while the black screen
  // is up.
  videoUrls: string[]
  airfieldName?: string | null
  logoUrl?: string | null
  children: React.ReactNode
}

// Whole-page black-screen buffering gate (byte-verified buffering gate
// round) - the real public display route's equivalent of MediaPanel.tsx's
// own existing box-scoped overlay, sharing the exact same underlying
// readiness signal via useBufferingGate (see that hook's own comment on
// why there is only ever ONE definition of "ready"). Renders NOTHING of
// the real dashboard while gating - no weather, no compass, no runway
// status, no partial UI, no per-slot buffering percentages underneath -
// only this full-screen view, until every currently-included asset has
// resolved (byte-verified complete, or excluded as stalled - see that
// hook's own comment on why a stall counts as resolved here too), at
// which point it's a clean cut straight to the real, already-warm
// dashboard/carousel, never a partial/degrading state in between.
export default function FullBufferGate({
  enabled,
  videoUrls,
  airfieldName,
  logoUrl,
  children,
}: FullBufferGateProps): JSX.Element {
  const { resolvedCount, total, gateCleared } = useBufferingGate(videoUrls, enabled)

  if (!enabled || gateCleared) return <>{children}</>

  const progress = total > 0 ? resolvedCount / total : 0

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black text-center">
      <div className="text-2xl font-bold uppercase tracking-widest text-primary">Buffering Media</div>
      <div className="text-sm font-semibold text-muted-300">
        {resolvedCount} of {total} ready
      </div>
      <div className="h-2 w-64 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-accent-sky-500 transition-all duration-300" style={{ width: `${progress * 100}%` }} />
      </div>
      {/* Same clickable logo/link-back-to-config behaviour every other
          public screen already has (Header.tsx/VenueCornerBadge.tsx's
          own role-aware destination resolution) - z-50, above this
          gate's own z-40, so it stays reachable while the gate is up,
          not just once the real dashboard renders. */}
      <div className="fixed left-4 top-4 z-50">
        <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
      </div>
    </div>
  )
}
