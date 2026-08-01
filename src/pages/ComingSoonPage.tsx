// Public marketing-domain placeholder (airfieldcentral.com root only -
// RootRoute.tsx decides between this and the real LandingPage based on
// the landing_page_mode flag, functions/api/public/landing-mode.ts).
// Reuses LandingPage.tsx's own hero image/treatment (same asset, same
// object-position/scrim approach) rather than a new visual language, so
// swapping back to the real site later isn't a jarring style change.
export default function ComingSoonPage(): JSX.Element {
  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <img
        src="/images/landing-page-runway.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[center_38%] saturate-[1.1] contrast-[1.05]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/50 to-slate-950/80" />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 text-sm font-bold uppercase tracking-[0.3em] text-sky-400">Airfield Central</div>
          <h1 className="text-5xl font-bold text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.7)] sm:text-6xl">
            Something new is coming
          </h1>
          <p className="mt-6 text-xl font-medium text-white/90 [text-shadow:0_2px_12px_rgba(0,0,0,0.7)] sm:text-2xl">
            We're rebuilding our public site. Live airfield dashboards for existing clubs are completely unaffected
            and continue running as normal.
          </p>
          <p className="mt-8 text-sm text-white/70">Check back soon.</p>
        </div>
      </div>
    </div>
  )
}
