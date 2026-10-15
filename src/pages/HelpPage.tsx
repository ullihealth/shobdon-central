import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TENANT_ONBOARDING_CONTENT_URL } from '../config/publicApi'
import LegalMarkdown from '../components/LegalMarkdown'
import {
  CUSTOMER_TERMS_TITLE,
  customerTermsMarkdown,
  privacyPolicyMarkdown,
  TERMS_VERSION,
  TERMS_EFFECTIVE_DATE,
} from '../content/legalTerms'

interface VideoSlot {
  id: string
  title: string
  url: string
}

interface OnboardingContent {
  videos: VideoSlot[]
}

// Persistent, ongoing access to the same content shown during the
// mandatory onboarding gate (OnboardingTermsPage.tsx) - re-surfaced here
// so it isn't only reachable during first-time onboarding. Read-only:
// no checkboxes/gate, since the caller has already agreed once to reach
// this page at all (bare <RequireAuth>, any role).
export default function HelpPage(): JSX.Element {
  const [content, setContent] = useState<OnboardingContent | null>(null)
  // 2026-10-14 - unconfigured video tiles ("Video not yet configured")
  // are a developer-only reminder, not tenant-facing content. Same
  // isDeveloper flag/fetch pattern as DesignPage.tsx (commit 2b47148) -
  // this page has no other reason yet to call /api/tenant/me, so it's a
  // new call here, not a new endpoint. Fails closed (false) until
  // resolved, same posture as that page's own fetch.
  const [isDeveloper, setIsDeveloper] = useState(false)
  // Stripe groundwork Part G - this user's OWN accepted version/date,
  // from the same /api/tenant/me fetch already made for isDeveloper
  // above (no new request). null means "not yet fetched" vs "never
  // accepted" (empty string/undefined from the API) - distinguished so
  // the page can show nothing rather than a flash of "not yet accepted"
  // before the real answer arrives.
  const [termsAcceptance, setTermsAcceptance] = useState<{ at: string | null; version: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(TENANT_ONBOARDING_CONTENT_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setContent(data)
      })
      .catch(() => {})
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setIsDeveloper(!!data?.isDeveloper)
        setTermsAcceptance({ at: data?.termsAcceptedAt ?? null, version: data?.termsAcceptedVersion ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Tenants only ever see a tile once it has a real video; the developer
  // keeps seeing every slot, including unconfigured ones, as a to-do
  // reminder. Configuring a video later needs no code change - it just
  // starts passing this filter the moment its url is set.
  const visibleVideos = content ? (isDeveloper ? content.videos : content.videos.filter((video) => video.url)) : []

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Help</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-400">
        Getting-started videos and the legal documents you agreed to when setting up your account.
      </p>

      {!content ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : (
        <>
          {visibleVideos.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Videos</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {visibleVideos.map((video) => (
                  <div key={video.id} className="flex aspect-video flex-col items-center justify-center rounded-xl border border-border bg-panel p-3 text-center">
                    {video.url ? (
                      <video controls src={video.url} className="h-full w-full rounded-lg object-contain" />
                    ) : (
                      <>
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-400">{video.title}</div>
                        <div className="text-xs text-muted-500">Video not yet configured</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Links out to its own route (/help/faq) rather than an
              inline section like Terms/Privacy below - a growing list of
              Q&A entries doesn't fit this page's fixed max-h-64 scroll-
              box pattern, and keeping it separate means the list can grow
              indefinitely without this page itself getting longer. */}
          <Link
            to="/help/faq"
            className="mb-8 flex items-center justify-between rounded-2xl border border-border bg-panel p-6 transition hover:border-accent-sky-500"
          >
            <span className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">FAQ</span>
            <span className="text-sm text-muted-400">View frequently asked questions →</span>
          </Link>

          <p className="mb-4 text-xs text-muted-500">
            Current version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}
            {termsAcceptance && (
              <>
                {' · '}
                {termsAcceptance.at && termsAcceptance.version
                  ? `You accepted version ${termsAcceptance.version} on ${new Date(termsAcceptance.at).toLocaleDateString('en-GB')}`
                  : 'You have not yet accepted the current Terms'}
              </>
            )}
          </p>

          <section className="mb-6 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">{CUSTOMER_TERMS_TITLE}</div>
              <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-xs text-accent-sky-400 hover:underline">
                Open full page →
              </Link>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4">
              <LegalMarkdown markdown={customerTermsMarkdown} />
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Privacy Policy</div>
              <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-xs text-accent-sky-400 hover:underline">
                Open full page →
              </Link>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4">
              <LegalMarkdown markdown={privacyPolicyMarkdown} />
            </div>
          </section>

          <a href="mailto:support@airfieldcentral.com" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
            Contact support@airfieldcentral.com
          </a>
        </>
      )}
    </div>
  )
}
