import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_ONBOARDING_CONTENT_URL } from '../config/publicApi'

interface VideoSlot {
  id: string
  title: string
  url: string
}

// Platform-admin only: edit the global (not per-tenant) video
// placeholders shown on the mandatory onboarding gate
// (OnboardingTermsPage.tsx) and the ongoing Help page.
//
// Terms-versioning round: the Terms/Privacy EDIT fields that used to
// live on this page are gone. That text is no longer sourced from this
// row at all - see src/content/legalTerms.ts's own comment for why
// (versioning needs the text in the same deploy as the version number,
// and the real documents need structural rendering a plain textarea
// can't represent). Editing those two now-dead columns here would be a
// silent trap: the save would succeed, but nothing live would change,
// since OnboardingTermsPage.tsx/HelpPage.tsx/the three public legal
// pages all read the committed content module now, never this table's
// terms_text/privacy_text. Left in place, unedited, purely as a
// historical record of the old placeholder (see migrations 0032/0042) -
// not read anywhere in the running app any more.
export default function PlatformOnboardingContentPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Onboarding Content — Airfield Central'
  }, [])

  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [videos, setVideos] = useState<VideoSlot[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    fetch(PLATFORM_ONBOARDING_CONTENT_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) {
          setVideos(data.videos ?? [])
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function updateVideo(id: string, field: 'title' | 'url', value: string) {
    setVideos((prev) => prev.map((video) => (video.id === id ? { ...video, [field]: value } : video)))
  }

  function addVideo() {
    setVideos((prev) => [...prev, { id: crypto.randomUUID(), title: '', url: '' }])
  }

  function removeVideo(id: string) {
    setVideos((prev) => prev.filter((video) => video.id !== id))
  }

  async function handleSave() {
    setSaveStatus('saving')
    const response = await fetch(PLATFORM_ONBOARDING_CONTENT_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos }),
    })
    setSaveStatus(response.ok ? 'saved' : 'error')
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <Link to="/platform/tenants" className="mb-4 inline-block text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← Platform · Tenants
        </Link>
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Onboarding Content</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Global, not per-tenant — shown on every new account's mandatory onboarding gate and the ongoing Help page.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Video placeholders</div>
                <button type="button" onClick={addVideo} className="text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
                  + Add video
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {videos.map((video) => (
                  <div key={video.id} className="flex items-center gap-2">
                    <input
                      value={video.title}
                      onChange={(event) => updateVideo(video.id, 'title', event.target.value)}
                      placeholder="Title"
                      className="w-1/3 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white"
                    />
                    <input
                      value={video.url}
                      onChange={(event) => updateVideo(video.id, 'url', event.target.value)}
                      placeholder="Video URL (leave blank for placeholder)"
                      className="flex-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white"
                    />
                    <button type="button" onClick={() => removeVideo(video.id)} className="text-xs font-semibold text-status-bad">
                      Remove
                    </button>
                  </div>
                ))}
                {videos.length === 0 && <p className="text-xs text-muted-500">No video slots configured.</p>}
              </div>
            </section>

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Terms &amp; Privacy</div>
              <p className="text-sm text-muted-400">
                No longer edited here. The real Customer Terms, Privacy Policy and Pilot's App Terms of Use are
                committed source (<code className="text-xs text-muted-300">src/content/legalTerms.ts</code>) so the
                text, the version number and the clickwrap stay in sync — a text change now means a code change
                (bump <code className="text-xs text-muted-300">TERMS_VERSION</code> too, to re-prompt everyone).
                Preview the live pages:{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                  /terms
                </Link>
                ,{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                  /privacy
                </Link>
                ,{' '}
                <Link to="/pilot-terms" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                  /pilot-terms
                </Link>
                .
              </p>
            </section>

            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="rounded-lg bg-accent-sky-500 px-6 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveStatus === 'saved' && <span className="ml-3 text-sm text-status-good">Saved.</span>}
            {saveStatus === 'error' && <span className="ml-3 text-sm text-status-bad">Couldn't save — please try again.</span>}
          </>
        )}
      </div>
    </div>
  )
}
