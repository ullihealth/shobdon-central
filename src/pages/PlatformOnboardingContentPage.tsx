import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_ONBOARDING_CONTENT_URL } from '../config/publicApi'

interface VideoSlot {
  id: string
  title: string
  url: string
}

// Platform-admin only: edit the global (not per-tenant) video
// placeholders and Terms/Privacy plain text shown on the mandatory
// onboarding gate (OnboardingTermsPage.tsx) and the ongoing Help page.
// A simple form over a single row, not a new subsystem - matches the
// "simple admin-only config" scope this was built to.
export default function PlatformOnboardingContentPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [videos, setVideos] = useState<VideoSlot[]>([])
  const [termsText, setTermsText] = useState('')
  const [privacyText, setPrivacyText] = useState('')
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
          setTermsText(data.termsText ?? '')
          setPrivacyText(data.privacyText ?? '')
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
      body: JSON.stringify({ videos, termsText, privacyText }),
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
              <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Terms &amp; Conditions</div>
              <p className="mb-3 text-xs text-muted-500">Plain text — separate paragraphs with a blank line.</p>
              <textarea
                value={termsText}
                onChange={(event) => setTermsText(event.target.value)}
                rows={12}
                className="w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-xs text-white"
              />
            </section>

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Privacy Policy</div>
              <p className="mb-3 text-xs text-muted-500">Plain text — separate paragraphs with a blank line.</p>
              <textarea
                value={privacyText}
                onChange={(event) => setPrivacyText(event.target.value)}
                rows={12}
                className="w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-xs text-white"
              />
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
