import { Link } from 'react-router-dom'
import LegalMarkdown from './LegalMarkdown'
import { TERMS_VERSION, TERMS_EFFECTIVE_DATE } from '../content/legalTerms'

// Shared chrome for the three public legal pages (/terms, /privacy,
// /pilot-terms) - legal-rollout round, Oct 2026. Same dark-slate, non-
// tenant-specific palette as LandingPage.tsx/VersionsPage.tsx (this
// represents the platform itself, not any one tenant's branding - these
// pages must never mention Shobdon or any other tenant by name).
//
// Public, unauthenticated, reachable on every hostname (bare apex via
// Pages, every tenant subdomain via the Worker - both share this same
// client-rendered SPA bundle, so no per-target wiring is needed once
// both are deployed with the new build).
//
// Version + effective date are rendered here from the TERMS_VERSION/
// TERMS_EFFECTIVE_DATE constants, never hand-typed per page - keeps
// what's displayed always in sync with whatever the backend actually
// stamps on acceptance (see functions/api/tenant/terms/accept.ts).
interface LegalPageLayoutProps {
  title: string
  markdown: string
  activePage: 'terms' | 'privacy' | 'pilot-terms'
}

const NAV_LINKS: { to: string; label: string; key: LegalPageLayoutProps['activePage'] }[] = [
  { to: '/terms', label: 'Customer Terms', key: 'terms' },
  { to: '/privacy', label: 'Privacy Policy', key: 'privacy' },
  { to: '/pilot-terms', label: "Pilot's App Terms", key: 'pilot-terms' },
]

export default function LegalPageLayout({ title, markdown, activePage }: LegalPageLayoutProps): JSX.Element {
  return (
    <div className="min-h-screen w-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="mb-6 inline-block text-xs font-semibold text-sky-400 hover:text-sky-300">
          ← AirfieldCentral
        </Link>

        <nav className="mb-6 flex flex-wrap gap-4 border-b border-slate-800 pb-4 text-xs">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.key}
              to={link.to}
              className={link.key === activePage ? 'font-semibold text-sky-400' : 'text-slate-500 hover:text-slate-300'}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <h1 className="mb-1 text-2xl font-bold">{title}</h1>
        <p className="mb-8 text-xs text-slate-500">
          Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}
        </p>

        <LegalMarkdown markdown={markdown} />

        <p className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500">
          Questions:{' '}
          <a href="mailto:support@airfieldcentral.com" className="text-sky-400 hover:underline">
            support@airfieldcentral.com
          </a>
        </p>
      </div>
    </div>
  )
}
