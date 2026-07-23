import { Link } from 'react-router-dom'

// Placeholder landing page for the café/clubhouse display upsell CTA
// (FeatureUpsellPanel on Cafe Media, for a not-yet-entitled tenant).
// Deliberately NOT a real checkout/marketing page - no pricing, no
// Stripe integration exists yet (see the café-display upsell
// investigation: this app has no billing infrastructure at all today).
// This exists so the CTA link isn't dead, not to sell anything yet.
export default function UpgradeCafeDisplayPage(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
        <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-primary">Café/Clubhouse Screen Display</h1>
        <p className="mb-4 text-sm text-muted-400">
          This is a placeholder page - real checkout/signup content for this add-on hasn't been built yet.
        </p>
        <p className="mb-6 text-sm text-muted-400">
          If you're interested in this feature, please contact us directly for now.
        </p>
        <Link
          to="/cafe-media"
          className="inline-block rounded-lg border border-border bg-panel px-4 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 transition hover:border-accent-sky-500 hover:text-accent-sky-300"
        >
          ← Back to Cafe Media
        </Link>
      </div>
    </div>
  )
}
