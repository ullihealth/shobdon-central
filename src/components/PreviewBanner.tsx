import { isPreviewDeploymentHost } from '../utils/isPagesPlatformHost'

// Fixed-position, unmissable "this isn't the live site" indicator -
// added after a real report: Jeff mistook a Cloudflare Pages preview
// deployment for production because the header just shows "Shobdon
// Airfield" like the real site does (correctly - it's real seeded
// data, not a bug to fix there). Rendered once, globally, as a sibling
// of <Routes> in App.tsx rather than threaded into every page/template
// individually - guarantees it shows on every route (admin pages AND
// every public dashboard template) with no risk of a future new page
// forgetting to include it.
//
// isPreviewDeploymentHost (not isPagesPlatformHost) is the right check
// here specifically - the latter also matches production's own bare
// shobdon-central.pages.dev alias, which is genuinely live production
// traffic for any tenant without per-tenant DNS yet and must NEVER show
// this banner. Renders null outright on that host and on every real
// custom domain (*.airfieldcentral.com) - this component is inert in
// production by construction, not by an easily-forgotten flag.
//
// position: fixed + high z-index, not a layout element that pushes
// content down - the live dashboard templates use pixel-precise
// h-screen/overscan-safe padding for TV kiosks, and reserving space for
// this would mean touching that layout math on every template for a
// component that must never actually render there anyway. A thin top
// strip instead slightly overlays the outer clamp() padding zone most
// pages already have, which is an acceptable trade-off for a preview-
// only indicator - the correctness that actually matters (never
// appearing in production) doesn't depend on pixel-perfect placement.
export default function PreviewBanner(): JSX.Element | null {
  if (!isPreviewDeploymentHost(window.location.hostname)) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        height: '26px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f59e0b',
        color: '#1a1200',
        fontSize: '12px',
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 1px 6px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
      }}
    >
      Preview — not the live site ({window.location.hostname})
    </div>
  )
}
