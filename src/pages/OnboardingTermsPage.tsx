import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ScrollGatedViewer from '../components/ScrollGatedViewer'
import { TENANT_ONBOARDING_CONTENT_URL, TERMS_ACCEPT_URL } from '../config/publicApi'

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

// Mandatory, no-skip gate - RequireAuth.tsx redirects here from every
// authenticated route (except /design and this route itself) until the
// caller's user.termsAcceptedAt is set. Reached both right after the
// invite-accept flow's branding step, and on any future login for an
// account that still hasn't accepted.
export default function OnboardingTermsPage(): JSX.Element {
  const navigate = useNavigate()
  const [content, setContent] = useState<OnboardingContent | null>(null)
  const [termsRead, setTermsRead] = useState(false)
  const [privacyRead, setPrivacyRead] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)
  const [disagreed, setDisagreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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

  async function handleAgree() {
    setSubmitting(true)
    const response = await fetch(TERMS_ACCEPT_URL, { method: 'POST' })
    setSubmitting(false)
    if (!response.ok) return

    const me = await fetch('/api/tenant/me')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    const landingPage =
      me?.role === 'media' ? '/media-manager' : me?.role === 'atc' ? '/atc-control' : me?.role === 'cafe' ? '/cafe-media' : '/config'
    navigate(landingPage)
  }

  if (disagreed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Access on hold</h1>
          <p className="mb-4 text-sm text-muted-400">Dashboard access requires accepting these terms.</p>
          <p className="mb-6 text-sm text-muted-400">
            Nothing has been deleted or cancelled - your account is exactly as it was. You can come back and agree at any
            time.
          </p>
          <button
            type="button"
            onClick={() => setDisagreed(false)}
            className="mb-3 block w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white hover:bg-accent-sky-400"
          >
            Review terms again
          </button>
          <a href="mailto:support@airfieldcentral.com" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
            Contact support@airfieldcentral.com
          </a>
        </div>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <p className="text-sm text-muted-400">Loading…</p>
      </div>
    )
  }

  const canAgree = termsChecked && privacyChecked

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-gradient-to-b from-page-from via-page-via to-page-to px-6 py-10 text-slate-100">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Before you continue</h1>
      <p className="mb-8 text-sm text-muted-400">
        A quick orientation, then please read and agree to the Terms & Conditions and Privacy Policy below.
      </p>

      {content.videos.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Getting started</div>
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
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Terms &amp; Conditions</div>
        <p className="mb-3 text-xs text-muted-500">Scroll to the bottom to enable the checkbox below.</p>
        <ScrollGatedViewer text={content.termsText} reachedBottom={termsRead} onReachedBottom={() => setTermsRead(true)} />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={termsChecked}
            disabled={!termsRead}
            onChange={(event) => setTermsChecked(event.target.checked)}
            className="h-4 w-4"
          />
          I have read and agree to the Terms &amp; Conditions
        </label>
      </section>

      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Privacy Policy</div>
        <p className="mb-3 text-xs text-muted-500">Scroll to the bottom to enable the checkbox below.</p>
        <ScrollGatedViewer text={content.privacyText} reachedBottom={privacyRead} onReachedBottom={() => setPrivacyRead(true)} />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={privacyChecked}
            disabled={!privacyRead}
            onChange={(event) => setPrivacyChecked(event.target.checked)}
            className="h-4 w-4"
          />
          I have read and agree to the Privacy Policy
        </label>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleAgree}
          disabled={!canAgree || submitting}
          className="flex-1 rounded-lg bg-accent-sky-500 px-4 py-3 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-40"
        >
          {submitting ? 'Continuing…' : 'Agree & continue'}
        </button>
        <button
          type="button"
          onClick={() => setDisagreed(true)}
          className="rounded-lg border border-border px-4 py-3 text-sm font-bold uppercase tracking-widest text-muted-400 hover:text-white"
        >
          Disagree
        </button>
      </div>
    </div>
  )
}
