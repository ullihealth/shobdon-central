import { useEffect, useState } from 'react'
import { TENANT_ONBOARDING_CONTENT_URL } from '../config/publicApi'
import { splitParagraphs } from '../utils/splitParagraphs'

interface VideoSlot {
  id: string
  title: string
  url: string
}

interface OnboardingContent {
  videos: VideoSlot[]
  termsText: string
  privacyText: string
}

// Persistent, ongoing access to the same content shown during the
// mandatory onboarding gate (OnboardingTermsPage.tsx) - re-surfaced here
// so it isn't only reachable during first-time onboarding. Read-only:
// no checkboxes/gate, since the caller has already agreed once to reach
// this page at all (bare <RequireAuth>, any role).
export default function HelpPage(): JSX.Element {
  const [content, setContent] = useState<OnboardingContent | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(TENANT_ONBOARDING_CONTENT_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setContent(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
          {content.videos.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Videos</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {content.videos.map((video) => (
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

          <section className="mb-6 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Terms &amp; Conditions</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4 text-sm leading-relaxed text-muted-300">
              {splitParagraphs(content.termsText).map((paragraph, index) => (
                <p key={index} className="mb-3 whitespace-pre-wrap last:mb-0">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Privacy Policy</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4 text-sm leading-relaxed text-muted-300">
              {splitParagraphs(content.privacyText).map((paragraph, index) => (
                <p key={index} className="mb-3 whitespace-pre-wrap last:mb-0">
                  {paragraph}
                </p>
              ))}
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
