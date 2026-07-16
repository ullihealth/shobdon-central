import { useEffect, useRef, useState } from 'react'
import { TRIAL_SIGNUP_URL } from '../config/publicApi'
import { LATEST_READING_URL } from '../config/captureEndpoint'

// Public marketing/landing page for Airfield Central, live at the bare
// airfieldcentral.com root domain (see src/components/RootRoute.tsx for
// the hostname-based routing that gets a visitor here instead of
// DashboardPage). Every word of copy below is agreed, final content,
// not placeholder text.
//
// Deliberately NOT using the theme-token classes (bg-page-from etc.)
// DashboardPage.tsx applies, same reasoning as GlobalDashboardPage.tsx
// (/global) - this page represents the platform itself, not any one
// tenant's branding. Uses the same dark slate palette as /global for a
// consistent "Airfield Central" identity across both public,
// non-tenant-specific pages.

const SHOBDON_LIVE_URL = 'https://shobdon.airfieldcentral.com'
const SUPPORT_EMAIL = 'support@airfieldcentral.com'

interface StatCallout {
  before: string
  after: string
}

// Pain point -> solution, rendered as a before/after card. Not wired to
// any real usage data - these are the agreed marketing framing, not
// measured statistics.
const STAT_CALLOUTS: StatCallout[] = [
  { before: 'Phone ATC to check conditions', after: 'One glance at your dashboard' },
  { before: 'No way to show visitors live status', after: 'Clubhouse TV, always current' },
  { before: 'Paper NOTAMs board', after: 'Live digital ops panel' },
]

const BENEFITS: string[] = [
  'Live wind, QNH, temperature, visibility — from your own station or regional data from day one',
  'Digital ops panel for runway status, NOTAMs, PPR, fuel, radio changes',
  'Clubhouse display + remote access for members and visiting pilots from home',
  'Your own branded address (yourclub.airfieldcentral.com)',
  'Camera feeds and photo/video slides on the same screen',
]

interface FaqEntry {
  question: string
  answer: string
}

const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: 'Do I need a weather station to start?',
    answer: "No — your dashboard works from day one using regional weather data. Connect your own station whenever you're ready.",
  },
  {
    question: "What if my weather station isn't a Davis Vantage Pro2?",
    answer: "Tell us your setup — Shobdon's integration took 2 days once we got started, and we move fast on these.",
  },
  {
    question: 'When do I get charged?',
    answer: "Nothing for 14 days. You'll get a reminder before your first payment, with clear instructions to cancel if you don't want to continue.",
  },
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes, monthly plans cancel with one click.',
  },
  {
    question: 'Do I need to install anything?',
    answer: 'No — works in any browser, phone, tablet, or desktop.',
  },
]

function StatCard({ before, after }: StatCallout): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 text-center">
      <div className="text-sm text-slate-500 line-through decoration-slate-600">{before}</div>
      <div className="my-2 text-sky-400">↓</div>
      <div className="text-base font-semibold text-slate-100">{after}</div>
    </div>
  )
}

function FaqRow({ question, answer }: FaqEntry): JSX.Element {
  return (
    <div className="border-b border-slate-800 py-4 last:border-b-0">
      <div className="font-semibold text-slate-100">{question}</div>
      <div className="mt-1 text-sm text-slate-400">{answer}</div>
    </div>
  )
}

type SignupStatus = 'idle' | 'submitting' | 'success' | 'error'

interface SignupResult {
  subdomain: string
}

// Real provisioning on submit (a genuine organization + tenants row via
// TRIAL_SIGNUP_URL), not a fake lead-capture form - but deliberately
// does not create a login (no password collected, by design - see
// functions/api/public/trial-signup.ts's own comment). The success
// state reflects that honestly rather than implying a working login
// exists yet.
function SignupForm(): JSX.Element {
  const [clubName, setClubName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<SignupStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<SignupResult | null>(null)

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setStatus('submitting')
    setErrorMessage('')

    try {
      const response = await fetch(TRIAL_SIGNUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubName, contactEmail, location }),
      })
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; slug?: string; subdomain?: string; error?: string }
        | null

      if (!response.ok || !data?.ok || !data.subdomain) {
        setErrorMessage(data?.error ?? 'Something went wrong - please try again.')
        setStatus('error')
        return
      }

      setResult({ subdomain: data.subdomain })
      setStatus('success')
    } catch {
      setErrorMessage('Something went wrong - please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success' && result) {
    return (
      <div className="rounded-xl border border-emerald-600/40 bg-emerald-500/10 p-6 text-center">
        <p className="text-lg font-semibold text-slate-100">You're set up.</p>
        <p className="mt-2 text-slate-300">
          {clubName}'s space is reserved at <span className="font-mono text-sky-400">{result.subdomain}</span>. We'll
          be in touch to finish setting things up — if you have any questions in the meantime, contact us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-400 hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700 bg-slate-900/80 p-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="clubName" className="mb-1 block text-sm font-medium text-slate-300">
            Club / airfield name
          </label>
          <input
            id="clubName"
            type="text"
            required
            maxLength={100}
            value={clubName}
            onChange={(event) => setClubName(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            placeholder="e.g. Shobdon Airfield"
          />
        </div>
        <div>
          <label htmlFor="contactEmail" className="mb-1 block text-sm font-medium text-slate-300">
            Contact email
          </label>
          <input
            id="contactEmail"
            type="email"
            required
            maxLength={200}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="location" className="mb-1 block text-sm font-medium text-slate-300">
            Location (for weather lookup)
          </label>
          <input
            id="location"
            type="text"
            required
            maxLength={200}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            placeholder="e.g. Shobdon, Herefordshire or EGBS"
          />
        </div>
      </div>

      {status === 'error' && <p className="mt-4 text-sm text-red-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="mt-5 w-full rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Submitting…' : 'Start Your Free Trial'}
      </button>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-400">Privacy:</span> When you request a trial, we collect your
        club/airfield name, contact email, and location so we can set up your dashboard and follow up with you. We
        don't sell or share this information with third parties beyond what's needed to run the service (for
        example, payment processing once billing is set up). You can ask us to delete your information at any time
        by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-500 hover:underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </form>
  )
}

// Live-preview widget for the hero's 16:9 panel. Deliberately does NOT
// reuse WeatherContext/useWeather (DashboardPage.tsx's own weather
// plumbing) - that reads its provider choice (ATC station / internet /
// mock) from a PER-BROWSER, PER-ORIGIN localStorage key
// ('shobdon-central.weather-config.v1'), defaulting to 'mock' whenever
// that key has never been set - which, on this origin (airfieldcentral.
// com, never shobdon.airfieldcentral.com), it never has. Reusing that
// context here would silently show FAKE numbers on the marketing page
// by default - a real, actively misleading bug, not just a visual one.
//
// Instead this fetches LATEST_READING_URL directly - the same capture-
// worker endpoint src/services/weatherProviders/atcProvider.ts already
// calls for the real dashboard's ATC-provider path. That endpoint's CORS
// is wide open (Access-Control-Allow-Origin: '*', worker/src/index.ts),
// and it's already proven reliable all session - genuinely live real
// Shobdon numbers, zero new backend.
//
// STALE_THRESHOLD_MS mirrors atcProvider.ts's own threshold (PC2's
// capture cadence is 60s; a few missed cycles' grace before treating a
// reading as unusable). Unlike atcProvider.ts, there's no separate
// "stale but shown dimmed" state - stale and absent are both folded into
// one 'unavailable' fallback, same philosophy as atcProvider.ts's own
// "stale is just as unusable as missing", kept simple rather than a
// three-way state machine for a marketing widget.
const STALE_THRESHOLD_MS = 3 * 60 * 1000

interface LivePreviewReading {
  windDirDeg: number
  windSpeedKt: number
  tempC: number
  qnhHpa: number
  capturedAt: string
}

type PreviewStatus = 'loading' | 'live' | 'unavailable'

function formatCapturedAt(iso: string): string {
  const date = new Date(iso)
  return `${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`
}

function LiveDashboardPreview(): JSX.Element {
  const [status, setStatus] = useState<PreviewStatus>('loading')
  const [reading, setReading] = useState<LivePreviewReading | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(LATEST_READING_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((data: { capturedAt?: unknown; parsed?: Record<string, unknown> } | null) => {
        if (cancelled) return
        if (!data || typeof data.capturedAt !== 'string' || !data.parsed) {
          throw new Error('no reading available yet')
        }

        const capturedAtMs = Date.parse(data.capturedAt)
        if (Number.isNaN(capturedAtMs) || Date.now() - capturedAtMs > STALE_THRESHOLD_MS) {
          throw new Error('reading is stale')
        }

        const p = data.parsed
        const windDirDeg = typeof p.wind_dir_deg === 'number' ? p.wind_dir_deg : null
        const windSpeedKt = typeof p.wind_speed_kt === 'number' ? p.wind_speed_kt : null
        const tempC = typeof p.temp_c === 'number' ? p.temp_c : null
        const qnhHpa = typeof p.qnh_hpa === 'number' ? p.qnh_hpa : null

        if (windDirDeg === null || windSpeedKt === null || tempC === null || qnhHpa === null) {
          throw new Error('reading is missing required fields')
        }

        if (!cancelled) {
          setReading({ windDirDeg, windSpeedKt, tempC, qnhHpa, capturedAt: data.capturedAt })
          setStatus('live')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const panelClass =
    'aspect-video w-full overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/90 shadow-2xl shadow-black/40 backdrop-blur-sm'

  if (status === 'loading') {
    return (
      <div className={`${panelClass} flex items-center justify-center`}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className={`${panelClass} flex flex-col items-center justify-center gap-3 p-6 text-center`}>
        <div className="text-3xl">✈️</div>
        <p className="text-sm font-medium text-slate-300">Live preview temporarily unavailable</p>
        <p className="max-w-xs text-xs text-slate-500">
          This happens occasionally between captures.{' '}
          <a
            href={SHOBDON_LIVE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline"
          >
            See the full live dashboard →
          </a>
        </p>
      </div>
    )
  }

  // live
  return (
    <div className={`${panelClass} p-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            Live from Shobdon Airfield
          </span>
        </div>
        {reading && <span className="text-xs text-slate-500">{formatCapturedAt(reading.capturedAt)}</span>}
      </div>
      {reading && (
        <div className="mt-6 grid grid-cols-2 gap-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Wind</div>
            <div className="mt-1 text-2xl font-bold text-slate-100">
              {Math.round(reading.windDirDeg)}° / {Math.round(reading.windSpeedKt)}kt
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">QNH</div>
            <div className="mt-1 text-2xl font-bold text-slate-100">{Math.round(reading.qnhHpa)} hPa</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Temperature</div>
            <div className="mt-1 text-2xl font-bold text-slate-100">{Math.round(reading.tempC)}°C</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Airfield</div>
            <div className="mt-1 text-lg font-semibold text-slate-100">Shobdon EGBS</div>
          </div>
        </div>
      )}
      <a
        href={SHOBDON_LIVE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-block text-sm text-sky-400 hover:underline"
      >
        Open full dashboard →
      </a>
    </div>
  )
}

export default function LandingPage(): JSX.Element {
  const signupRef = useRef<HTMLDivElement>(null)

  function scrollToSignup(): void {
    signupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto max-w-7xl text-lg font-bold">Airfield Central</div>
      </header>

      {/* HERO - landing-page-runway.jpg (Jeff's own asset, replacing the
          earlier sourced Pexels photo). Deliberately OUTSIDE <main>'s
          max-w-7xl wrapper - the previous version nested the hero inside
          that constrained column, so the background image was never
          wider than the content column even on desktop, not a true
          full-bleed. This section is a direct child of the outer
          min-h-screen w-screen div instead, so it genuinely spans the
          viewport; only the TEXT inside it gets its own max-w-7xl
          wrapper, matching every other section's width so the whole page
          reads as one deliberate width rather than a mix (header, hero
          text, and <main> all share max-w-7xl now - widened from 5xl,
          which left too much dead space on large desktop viewports).
          Pure visual/headline moment now - no competing panel fighting
          for attention; the live-preview widget moved down into the
          Proof section below, where "here's real live data" actually
          belongs narratively. White text directly over the image (not a
          dark panel-on-panel treatment) - a lighter gradient than the
          previous version so the image (including the "AIRFIELD
          CENTRAL" signage baked into the terminal building) actually
          reads, while staying dark enough at the bottom for the page's
          own background to blend in. */}
      <section className="relative w-full overflow-hidden">
        <img
          src="/images/landing-page-runway.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/40 to-slate-950" />
        <div className="relative mx-auto max-w-7xl px-6 py-28 text-center sm:px-10">
          <h1 className="text-4xl font-bold text-white sm:text-5xl">
            Live Weather &amp; Airfield Conditions — Not a Phone Call, Not a Guess
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/90">
            Real-time wind, QNH, and airfield status on your clubhouse screen and every member's phone — set up in
            minutes, no weather station required to start.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-6 py-16">
        {/* STAT CALLOUTS - moved out of the hero image panel too, now
            its own plain section on the regular page background. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STAT_CALLOUTS.map((stat) => (
            <StatCard key={stat.before} {...stat} />
          ))}
        </section>

        {/* PROOF SECTION - the live-preview widget lives here now, not
            in the hero - this is where "here's real live data, not a
            demo" actually belongs narratively, right next to the text
            making that same claim. */}
        <section className="mt-20 text-center">
          <h2 className="text-2xl font-bold">See it live</h2>
          <p className="mt-3 text-slate-400">
            This is a real airfield's real dashboard, right now — not a demo.{' '}
            <a
              href={SHOBDON_LIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline"
            >
              {SHOBDON_LIVE_URL.replace('https://', '')}
            </a>
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <LiveDashboardPreview />
          </div>
        </section>

        {/* BENEFITS */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold">What you get</h2>
          <ul className="mx-auto mt-6 max-w-2xl space-y-3">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex gap-3 text-slate-300">
                <span className="mt-1 text-sky-400">✓</span>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* PRICING */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold">Pricing</h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-4">
            <div className="rounded-xl border border-sky-600/40 bg-slate-900/80 p-6">
              <div className="text-lg font-semibold text-slate-100">
                Airfield Central Dashboard — £29/month (£290/year)
              </div>
              <p className="mt-2 text-slate-400">
                Everything above, using regional weather data — live and working from day one, no hardware needed.
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-6">
              <div className="text-lg font-semibold text-slate-100">
                + Davis Vantage Pro2 Integration — £20/month (£200/year)
              </div>
              <p className="mt-2 text-slate-400">
                Add your own weather station for live, on-site readings. Available any time — no need to decide
                today.
              </p>
              <p className="mt-2 text-sm text-slate-500">Other station makes/models: get in touch.</p>
            </div>
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-slate-500">
            14-day free trial on the dashboard. Card required, nothing charged until day 15 — you'll get a reminder
            first, and cancelling takes one click.
          </p>
        </section>

        {/* CTA FORK */}
        <section className="mt-20 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={scrollToSignup}
            className="w-full rounded-lg bg-sky-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-400 sm:w-auto"
          >
            Start Your Free Trial
          </button>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Airfield Central consultation request')}`}
            className="w-full rounded-lg border border-slate-600 px-6 py-3 text-center font-semibold text-slate-100 transition hover:border-slate-400 sm:w-auto"
          >
            Book a Consultation
          </a>
        </section>

        {/* Signup form itself - target of "Start Your Free Trial" above,
            scrolled to rather than a separate route/modal. */}
        <section ref={signupRef} className="mx-auto mt-12 max-w-md">
          <SignupForm />
        </section>

        {/* FAQ */}
        <section className="mx-auto mt-20 max-w-2xl">
          <h2 className="text-center text-2xl font-bold">Frequently asked questions</h2>
          <div className="mt-6">
            {FAQ_ENTRIES.map((entry) => (
              <FaqRow key={entry.question} {...entry} />
            ))}
          </div>
        </section>
      </main>

      {/* FOOTER - Privacy/Terms deliberately non-clickable placeholder
          text: a real policy document, not built yet, and not needed
          for tonight per explicit instruction. */}
      <footer className="border-t border-slate-800 px-6 py-8 text-center text-sm text-slate-500">
        <p>Airfield Central © 2026 · Built for UK airfields and flying clubs</p>
        <p className="mt-2">
          <span className="text-slate-600">Privacy</span> · <span className="text-slate-600">Terms</span> ·{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-500 hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </footer>
    </div>
  )
}
