import { useBufferingGate, type GateAsset } from '../hooks/useVideoDownloadStates'
import VenueCornerBadge from './VenueCornerBadge'

interface FullBufferGateProps {
  // Per-tenant opt-in (tenants.full_buffer_gate_enabled, migration
  // 0094) - false renders children immediately with zero registration/
  // download side effects from this component at all, preserving every
  // non-opted-in tenant's current behaviour exactly (Shobdon: weather/
  // compass/runway display immediately, only MediaPanel's own box-scoped
  // gate applies).
  enabled: boolean
  // Every currently-included slot this page's real template will show,
  // in rotation order - registering them here (via useBufferingGate,
  // unconditionally on every render regardless of whether the gate is
  // still showing) is what actually starts mp4 downloads through the
  // shared queue, since `children` - and the MediaPanel instances
  // nested inside it - stay entirely UNMOUNTED until this gate clears.
  // Without this component registering them itself, nothing would ever
  // start downloading while the black screen is up. Non-mp4 assets
  // (url null, sizeBytes their real file size) feed the byte-weighted
  // percentage below without being tracked/downloaded here at all.
  assets: GateAsset[]
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
  assets,
  airfieldName,
  logoUrl,
  children,
}: FullBufferGateProps): JSX.Element {
  const { resolvedCount, total, gateCleared, byteProgress } = useBufferingGate(assets, enabled)

  if (!enabled || gateCleared) return <>{children}</>

  const percent = Math.round(byteProgress * 100)

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black text-center">
      <div className="text-2xl font-bold uppercase tracking-widest text-primary">Buffering Media</div>
      {/* Byte-weighted percentage (primary) - continuous, driven by
          actual bytes received across every currently-included,
          non-excluded asset, not file-completion count, so a single
          large video doesn't leave this looking frozen for a long
          stretch while it's genuinely downloading fine. */}
      <div className="text-5xl font-black tabular-nums text-primary">{percent}%</div>
      <div className="h-2 w-64 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-accent-sky-500 transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      {/* Secondary count (discrete, file-completion based) - kept
          alongside the percentage above for extra context, not as the
          primary readout anymore. */}
      <div className="text-sm font-semibold text-muted-300">
        {resolvedCount} of {total} assets ready
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
