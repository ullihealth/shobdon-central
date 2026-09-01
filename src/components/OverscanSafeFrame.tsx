import type { CSSProperties, ReactNode } from 'react'

interface OverscanSafeFrameProps {
  enabled: boolean
  // Percent of margin visible on EACH of the four edges, not a
  // combined/total figure - see scale's own comment below for the
  // derivation. Validated 2-10 server-side (functions/api/tenant/
  // config.ts's own PUT), but this component clamps defensively too so
  // a stale/out-of-range stored value can never invert or blow up the
  // transform.
  marginPercent: number
  themeOverride: CSSProperties
  children: ReactNode
  // 'h-screen w-screen' (the default) for the real live dashboard -
  // DashboardPage.tsx/TenantDisplayPage.tsx wrap the true viewport.
  // DesignPage.tsx's own preview passes 'h-full w-full' instead, since
  // there this sits inside an already-sized/already-scaled preview box,
  // not the true browser viewport.
  outerClassName?: string
}

// Overscan safe-margin round - a real tenant's mounted TV applies
// hardware overscan (crops the incoming HDMI signal a few percent on
// every edge), confirmed via photo cutting off the footer ticker's text.
// Unlike TEMPLATE_EDGE_PADDING (src/config/templateLayout.ts, an
// always-on content-box padding every template already applies), this
// is opt-in and shrinks the ENTIRE rendered canvas toward its own
// center, so a TV that crops further still can't reach anything that
// matters - see migration 0101's own comment for the full "why"
// per-tenant/self-service/default-off design.
//
// Deliberately NOT the ResizeObserver + fixed-1920x1080-reference
// pattern MediaSlotRenderer.tsx's websiteFixedCanvas uses - that solves
// a different problem (fitting UNKNOWN fixed-size content into an
// UNKNOWN-size container). Every display template's own root is already
// sized with w-screen/h-screen (vw/vh units, which resolve against the
// true viewport regardless of any ancestor's transform), so shrinking
// the whole already-viewport-sized canvas toward its own center needs no
// measurement at all - a single CSS transform: scale(), computed once
// from a stored percentage, does it with zero JS layout work.
//
// scale derivation: a uniform scale(s) anchored at the element's own
// center shrinks BOTH axes toward the middle equally, so the empty gap
// on each edge (as a fraction of that axis's original size) is always
// (1-s)/2 - identical on left/right AND top/bottom, regardless of aspect
// ratio, which is exactly the "small EVEN margin on all four edges" the
// feature asks for. Solving (1-s)/2 = marginPercent/100 for s:
export function overscanSafeScale(marginPercent: number): number {
  const clamped = Math.min(10, Math.max(0, marginPercent))
  return 1 - (clamped * 2) / 100
}

export default function OverscanSafeFrame({
  enabled,
  marginPercent,
  themeOverride,
  children,
  outerClassName = 'h-screen w-screen',
}: OverscanSafeFrameProps): JSX.Element {
  if (!enabled || marginPercent <= 0) return <>{children}</>

  const scale = overscanSafeScale(marginPercent)

  return (
    // Same bg-gradient-to-b from-page-from/via/to-page-to every real
    // display template's own root already applies unconditionally
    // (gradientMode's solid/gradient choice is baked into what those
    // three CSS custom properties actually resolve to, not into which
    // Tailwind class renders - a solid theme just sets from/via/to to
    // the same colour) - so the margin this reveals reads as the
    // tenant's own themed background, not a black/white void, with zero
    // extra prop needed here.
    <div
      className={`${outerClassName} overflow-hidden bg-gradient-to-b from-page-from via-page-via to-page-to`}
      style={themeOverride}
    >
      <div className="h-full w-full" style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        {children}
      </div>
    </div>
  )
}
