import { Link } from 'react-router-dom'

interface FeatureUpsellPanelProps {
  title: string
  description: string
  ctaLabel: string
  ctaHref: string
}

// Generic "this feature isn't on your plan yet" panel - first user is
// Cafe Media (cafe-tv's entitled=0 case, migration 0034), but built
// reusable so future paid add-ons don't each invent their own version.
// Deliberately NOT styled like RequireAuth.tsx's/PlatformTenantsPage.tsx's
// shared "Not authorized" card (text-status-bad heading, error-red
// tone) - this is a "here's something you can buy" invitation, not an
// error state, so it uses the same accent-sky-400 CTA language as
// every other primary action button in this app (e.g. "Onboard new
// tenant", "Save Settings") instead of red.
export default function FeatureUpsellPanel({ title, description, ctaLabel, ctaHref }: FeatureUpsellPanelProps): JSX.Element {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
      <h2 className="mb-3 text-xl font-black uppercase tracking-wide text-primary">{title}</h2>
      <p className="mb-6 text-sm text-muted-400">{description}</p>
      <Link
        to={ctaHref}
        className="inline-block rounded-lg bg-accent-sky-500 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}
