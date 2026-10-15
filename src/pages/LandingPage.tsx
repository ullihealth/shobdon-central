import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PUBLIC_CHECK_SLUG_URL, PUBLIC_CHECK_POSTCODE_URL, TRIAL_SIGNUP_URL, SIGNUP_URL, STRIPE_CHECKOUT_URL } from '../config/publicApi'
import { LATEST_READING_URL } from '../config/captureEndpoint'
import { PRICING_PLANS, PACK_SAVINGS_GBP, PRICING_TERMS_LINE, formatGBP, type PlanId } from '../config/pricing'
import { authClient } from '../lib/auth/authClient'

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
  { before: 'No way to show visitors current status', after: 'Reception Dashboard, always visible' },
  { before: 'Paper NOTAMs board', after: 'Live digital ops panel' },
]

// Pricing/naming copy-fix round - "Live wind..." and the old "Clubhouse
// display + remote access..." line (naming neither the Reception
// Dashboard nor the Pilot's App) are gone. Weather wording specifically
// must never promise every customer gets their own live station data -
// Met Office data is the standard, a physical station is an optional,
// best-effort, not-guaranteed-everywhere upgrade (see the Pricing
// section's own disclaimer line below for the fuller version of this).
const BENEFITS: string[] = [
  'Wind, QNH, temperature, visibility — Met Office data as standard, your own weather station connectable any time',
  'Digital ops panel for runway status, NOTAMs, PPR, fuel, radio changes',
  "Reception Dashboard for your clubhouse screen, plus the Pilot's App for members and visiting pilots on their phone",
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
    answer: "No — your dashboard works from day one using Met Office weather data. Connecting your own station is an optional upgrade, whenever you're ready.",
  },
  {
    question: "What if my weather station isn't a Davis Vantage Pro2?",
    answer: "Tell us your setup — Shobdon's integration took 2 days once we got started, and we move fast on these.",
  },
  {
    question: 'When do I get charged?',
    answer: "At checkout, when you set up your plan. Billing is monthly, with a 3-month minimum term, then rolling monthly.",
  },
  {
    question: 'Can I cancel anytime?',
    answer: "After the 3-month minimum, yes — 30 days' notice to cancel.",
  },
  {
    question: 'Do I need to install anything?',
    answer: 'No — works in any browser, phone, tablet, or desktop.',
  },
]

function StatCard({ before, after }: StatCallout): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-7 text-center">
      <div className="text-base text-slate-500 line-through decoration-slate-600">{before}</div>
      <div className="my-3 text-sky-400">↓</div>
      <div className="text-xl font-semibold text-slate-100">{after}</div>
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

// Client-side mirror of functions/api/_utils/tenantSlug.ts's own
// SLUG_FORMAT - instant typo feedback with no network round-trip.
// Reserved-word/actual-availability checking still goes through
// PUBLIC_CHECK_SLUG_URL (debounced below), not a second copy of the
// reserved list here.
const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const SLUG_CHECK_DEBOUNCE_MS = 400

// Venue/café onboarding round - client-side mirror of
// tenantSlug.ts's own exported CAFE_SLUG_SUFFIX, same "mirror for
// instant feedback, server stays the real enforcement" posture
// SLUG_FORMAT above already established. The café branch's slug is
// auto-generated from the venue name (slugifyVenueName below), never
// typed directly - this suffix is always appended, never optional.
const CAFE_SLUG_SUFFIX = '-media'

type SignupType = 'airfield' | 'venue_cafe'

// Best-effort client-side slug derivation - deliberately looser than
// SLUG_FORMAT's own strict validation (which still runs, server-side,
// against the FULL derived value including suffix - see
// trial-signup.ts's venue_cafe branch). Collapses anything that isn't
// a-z0-9 into single hyphens and trims leading/trailing ones, same
// general shape check-slug.ts's own reserved-word/format layer expects.
function slugifyVenueName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Fork-placement round - this used to be a small toggle bar rendered
// INSIDE SignupForm, well below the CTA buttons and Pricing section, and
// styled far more lightly than either. Extracted to its own component
// and lifted above the CTA buttons in LandingPage's own render order
// (see that function below) because this decision - which of two
// completely different forms a visitor fills in - deserves the same
// visual weight as the Pricing section immediately above it, not the
// subordinate treatment a form-internal toggle implied. Card
// width/padding/border (rounded-xl, p-6) and the "Choose your setup"
// heading (text-2xl font-bold) deliberately mirror the Pricing section's
// own card/heading treatment exactly, one section up - same visual
// register, not a redesign of either. The two option cards' own content
// (label + one-line qualifier) and click behaviour (forced-choice,
// freely switchable) are unchanged from the previous round - only their
// container's size and this component's position moved.
interface ProductChoiceProps {
  signupType: SignupType | null
  setSignupType: (type: SignupType) => void
}

function ProductChoiceFork({ signupType, setSignupType }: ProductChoiceProps): JSX.Element {
  return (
    <section className="mt-20">
      <h2 className="text-center text-2xl font-bold">Choose your setup</h2>
      <div className="mx-auto mt-8 max-w-2xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setSignupType('airfield')}
            className={`rounded-xl border p-6 text-left transition ${
              signupType === 'airfield'
                ? 'border-sky-500 bg-sky-500/10'
                : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
            }`}
          >
            <div className="text-lg font-semibold text-slate-100">Airfield / Clubhouse dashboard</div>
            <p className="mt-2 text-slate-400">You manage weather, runway status, and NOTAMs for pilots</p>
          </button>
          <button
            type="button"
            onClick={() => setSignupType('venue_cafe')}
            className={`rounded-xl border p-6 text-left transition ${
              signupType === 'venue_cafe'
                ? 'border-sky-500 bg-sky-500/10'
                : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
            }`}
          >
            <div className="text-lg font-semibold text-slate-100">Café / Venue screen only</div>
            <p className="mt-2 text-slate-400">You want an ad/media screen - no aviation data needed</p>
          </button>
        </div>
        {!signupType && <p className="mt-6 text-center text-base font-medium text-slate-300">Choose one to continue.</p>}
      </div>
    </section>
  )
}

// Real provisioning on submit (a genuine organization + tenants row via
// TRIAL_SIGNUP_URL), not a fake lead-capture form - but deliberately
// does not create a login (no password collected, by design - see
// functions/api/public/trial-signup.ts's own comment). The success
// state reflects that honestly rather than implying a working login
// exists yet.
//
// Venue/café onboarding round - forks into two field sets sharing one
// submission path. signupType picked via a fork BEFORE any field
// renders, so a visitor never sees a field for the product they didn't
// pick. contactEmail/lat/lon are shared state either way (same field,
// same purpose, same validation in both branches) - clubName/location
// (airfield) and venueName/interestedParentAirfield (venue_cafe) are
// branch-specific. Slug handling differs the most: airfield keeps the
// existing manually-typed + live-checked field; venue_cafe derives it
// from venueName (slugifyVenueName + the mandatory -media suffix) and
// shows it as a read-only preview, never a text input - see the café
// branch's own JSX below.
//
// Fork-placement round - signupType/setSignupType are now owned by
// LandingPage itself and passed down as props, not local state here.
// The picker UI (ProductChoiceFork, below) moved out of this form
// entirely, up above the CTA buttons, so it needed to be visible - and
// clickable - before this component (rendered further down the page,
// at the "Start Your Free Trial" scroll target) ever mounts anything
// meaningful. This component still owns every field's own state and
// still gates the field set on signupType being non-null - only WHERE
// the selection itself is made moved, not how the fields respond to it.
function SignupForm({ signupType, setSignupType }: ProductChoiceProps): JSX.Element {
  // Airfield-branch-only fields
  const [clubName, setClubName] = useState('')
  const [location, setLocation] = useState('')
  const [slug, setSlug] = useState('')

  // Venue/café-branch-only fields
  const [venueName, setVenueName] = useState('')
  const [interestedParentAirfield, setInterestedParentAirfield] = useState('')
  // Postcode round - replaces the airfield branch's raw Lat/Long for
  // this branch specifically: a café owner has no reason to know their
  // own coordinates, unlike the airfield branch's audience. Geocoded via
  // postcodes.io, both here (live check, advisory only) and
  // authoritatively server-side in trial-signup.ts - see that file's own
  // comment for why the server never trusts a client-supplied lat/lon
  // for this branch at all.
  const [postcode, setPostcode] = useState('')
  const [postcodeCheck, setPostcodeCheck] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid'; reason?: string }>(
    { status: 'idle' }
  )

  // Shared - same field/purpose/validation in both branches
  const [contactEmail, setContactEmail] = useState('')
  // Required (weather-share investigation round) - the free-text
  // `location` field above was never actually wired to weather despite
  // its own "for weather lookup" label, which let a real tenant get
  // created with no usable coordinates at all. Kept separate from that
  // field rather than replacing it - `location` is a human-readable note
  // for Jeff's own manual follow-up (see this file's own top comment),
  // these two are the real, geocodable values. Airfield-branch-only as
  // of the postcode round - venue_cafe now collects Postcode instead
  // (above), never raw lat/lon.
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')

  const [status, setStatus] = useState<SignupStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<SignupResult | null>(null)

  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable'; reason?: string }>(
    { status: 'idle' }
  )

  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  const latValid = lat.trim() !== '' && Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
  const lonValid = lon.trim() !== '' && Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180

  // Loose client-side format check - same "instant feedback, server
  // stays the real authority" posture SLUG_FORMAT already has for slugs.
  // postcodes.io's own response (debounced below) is what actually
  // decides valid/invalid; this only avoids firing a network call for an
  // obviously-incomplete value while someone's still typing.
  const trimmedPostcode = postcode.trim()
  const postcodeFormatLooksComplete = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/.test(trimmedPostcode)

  useEffect(() => {
    if (signupType !== 'venue_cafe' || !postcodeFormatLooksComplete) {
      setPostcodeCheck({ status: 'idle' })
      return
    }
    let cancelled = false
    setPostcodeCheck({ status: 'checking' })
    const timeoutId = window.setTimeout(() => {
      fetch(`${PUBLIC_CHECK_POSTCODE_URL}?postcode=${encodeURIComponent(trimmedPostcode)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          setPostcodeCheck(data.valid ? { status: 'valid' } : { status: 'invalid', reason: data.error })
        })
        .catch(() => {
          if (!cancelled) setPostcodeCheck({ status: 'idle' })
        })
    }, SLUG_CHECK_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [trimmedPostcode, postcodeFormatLooksComplete, signupType])

  // Airfield branch - required here, unlike the platform-admin invite
  // flow's own optional version of this same field - Jeff's own
  // reasoning: a self-serve customer choosing their address up front
  // avoids ever having to tell them afterward "actually, please switch
  // to this new URL instead" - there's no admin relationship here to
  // smooth that over.
  const trimmedSlug = slug.trim()
  const slugFormatError =
    trimmedSlug && !SLUG_FORMAT.test(trimmedSlug)
      ? '3-63 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen'
      : null

  // Venue/café branch - derived, not typed. Truncates the venue-name
  // portion (not the suffix) to stay under the 63-char DNS-label ceiling
  // SLUG_FORMAT/tenantSlug.ts's own isValidSlugFormat both enforce.
  const cafeSlugBase = slugifyVenueName(venueName).slice(0, 63 - CAFE_SLUG_SUFFIX.length)
  const cafeSlug = cafeSlugBase ? `${cafeSlugBase}${CAFE_SLUG_SUFFIX}` : ''

  const effectiveSlug = signupType === 'venue_cafe' ? cafeSlug : trimmedSlug
  const effectiveSlugCheckable = signupType === 'venue_cafe' ? !!cafeSlug : !!trimmedSlug && !slugFormatError

  useEffect(() => {
    if (!effectiveSlugCheckable) {
      setSlugCheck({ status: 'idle' })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking' })
    const timeoutId = window.setTimeout(() => {
      const signupTypeParam = signupType === 'venue_cafe' ? '&signupType=venue_cafe' : ''
      fetch(`${PUBLIC_CHECK_SLUG_URL}?slug=${encodeURIComponent(effectiveSlug)}${signupTypeParam}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          setSlugCheck(data.available ? { status: 'available' } : { status: 'unavailable', reason: data.reason })
        })
        .catch(() => {
          if (!cancelled) setSlugCheck({ status: 'idle' })
        })
    }, SLUG_CHECK_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [effectiveSlug, effectiveSlugCheckable, signupType])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    // Belt-and-braces - the submit button itself is only ever rendered
    // once signupType is set (see the JSX below), so this should be
    // unreachable, but this keeps the branch below (which assumes one
    // of the two literal values) honest without needing a non-null
    // assertion.
    if (!signupType) return
    if (signupType === 'venue_cafe') {
      if (postcodeCheck.status !== 'valid') return
    } else if (!latValid || !lonValid) {
      return
    }
    setStatus('submitting')
    setErrorMessage('')

    const body =
      signupType === 'venue_cafe'
        ? {
            signupType,
            venueName,
            contactEmail,
            slug: cafeSlug,
            postcode: trimmedPostcode,
            interestedParentAirfield: interestedParentAirfield.trim() || undefined,
          }
        : { signupType, clubName, contactEmail, location, slug: trimmedSlug, lat: parsedLat, lon: parsedLon }

    try {
      const response = await fetch(TRIAL_SIGNUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          {(signupType === 'venue_cafe' ? venueName : clubName)}'s space is reserved at{' '}
          <span className="font-mono text-sky-400">{result.subdomain}</span>. We'll be in touch to finish setting
          things up — if you have any questions in the meantime, contact us at{' '}
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
      {signupType && (
      <>
      <div className="space-y-4">
        {signupType === 'airfield' ? (
          <>
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
              <label htmlFor="slug" className="mb-1 block text-sm font-medium text-slate-300">
                Your dashboard address
              </label>
              <input
                id="slug"
                type="text"
                required
                maxLength={63}
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="e.g. shobdon"
              />
              <p className="mt-1 text-xs text-slate-500">
                {trimmedSlug || 'yourclub'}.airfieldcentral.com
                {slugFormatError && <span className="ml-2 text-red-400">{slugFormatError}</span>}
                {!slugFormatError && slugCheck.status === 'checking' && <span className="ml-2 text-slate-400">Checking…</span>}
                {!slugFormatError && slugCheck.status === 'available' && <span className="ml-2 text-emerald-400">Available</span>}
                {!slugFormatError && slugCheck.status === 'unavailable' && <span className="ml-2 text-red-400">{slugCheck.reason}</span>}
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="venueName" className="mb-1 block text-sm font-medium text-slate-300">
                Venue name
              </label>
              <input
                id="venueName"
                type="text"
                required
                maxLength={100}
                value={venueName}
                onChange={(event) => setVenueName(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="e.g. Goodwood Clubhouse Café"
              />
              {/* Read-only preview, not an input - the whole point of
                  this branch's slug rule is that it's never freely
                  typed, see this file's own top comment on SignupForm. */}
              <p className="mt-1 text-xs text-slate-500">
                {cafeSlug || 'yourvenue-media'}.airfieldcentral.com
                {venueName.trim() && !cafeSlug && (
                  <span className="ml-2 text-red-400">Venue name needs at least one letter or number</span>
                )}
                {cafeSlug && slugCheck.status === 'checking' && <span className="ml-2 text-slate-400">Checking…</span>}
                {cafeSlug && slugCheck.status === 'available' && <span className="ml-2 text-emerald-400">Available</span>}
                {cafeSlug && slugCheck.status === 'unavailable' && <span className="ml-2 text-red-400">{slugCheck.reason}</span>}
              </p>
            </div>
            <div>
              <label htmlFor="interestedParentAirfield" className="mb-1 block text-sm font-medium text-slate-300">
                Which airfield is this venue based at? <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="interestedParentAirfield"
                type="text"
                maxLength={200}
                value={interestedParentAirfield}
                onChange={(event) => setInterestedParentAirfield(event.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="e.g. Shobdon Airfield"
              />
              <p className="mt-1 text-xs text-slate-500">
                We won't link your venue to their dashboard automatically - just tell us, and we'll connect it by
                hand.
              </p>
            </div>
            <div>
              <label htmlFor="postcode" className="mb-1 block text-sm font-medium text-slate-300">
                Postcode
              </label>
              <input
                id="postcode"
                type="text"
                required
                maxLength={10}
                value={postcode}
                onChange={(event) => setPostcode(event.target.value.toUpperCase())}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="e.g. HR6 9HB"
              />
              <p className="mt-1 text-xs text-slate-500">
                Gives your screen's regional weather line from day one.
                {postcodeFormatLooksComplete && postcodeCheck.status === 'checking' && (
                  <span className="ml-1 text-slate-400">Checking…</span>
                )}
                {postcodeCheck.status === 'valid' && <span className="ml-1 text-emerald-400">Recognised</span>}
                {postcodeCheck.status === 'invalid' && <span className="ml-1 text-red-400">{postcodeCheck.reason}</span>}
              </p>
            </div>
          </>
        )}
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
        {signupType === 'airfield' && (
          <div>
            <label htmlFor="location" className="mb-1 block text-sm font-medium text-slate-300">
              Location
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
        )}
        {signupType === 'airfield' && (
          <>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="lat" className="mb-1 block text-sm font-medium text-slate-300">
                  Latitude
                </label>
                <input
                  id="lat"
                  required
                  value={lat}
                  onChange={(event) => setLat(event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  placeholder="52.2416"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="lon" className="mb-1 block text-sm font-medium text-slate-300">
                  Longitude
                </label>
                <input
                  id="lon"
                  required
                  value={lon}
                  onChange={(event) => setLon(event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  placeholder="-2.8821"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Latitude/longitude power your dashboard's weather - find yours at{' '}
              <a href="https://www.latlong.net" target="_blank" rel="noreferrer" className="text-sky-500 hover:underline">
                latlong.net
              </a>
              .
            </p>
          </>
        )}
      </div>

      {status === 'error' && <p className="mt-4 text-sm text-red-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={
          status === 'submitting' ||
          !effectiveSlugCheckable ||
          slugCheck.status !== 'available' ||
          (signupType === 'venue_cafe'
            ? postcodeCheck.status !== 'valid'
            : (lat.trim() !== '' && !latValid) || (lon.trim() !== '' && !lonValid))
        }
        className="mt-5 w-full rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Submitting…' : 'Start Your Free Trial'}
      </button>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-400">Privacy:</span> When you request a trial, we collect your{' '}
        {signupType === 'venue_cafe' ? 'venue name' : 'club/airfield name'}, contact email, and location so we can
        set up your dashboard and follow up with you. We don't sell or share this information with third parties
        beyond what's needed to run the service (for example, payment processing once billing is set up). You can
        ask us to delete your information at any time by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-500 hover:underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      </>
      )}
    </form>
  )
}

// Stripe groundwork Part B - paid signup, airfield branch only (see
// functions/api/public/signup.ts's own top comment for why venue_cafe
// stays on the trial-signup.ts/SignupForm path above, unchanged). A
// genuinely separate component and submission path from SignupForm -
// trial-signup.ts's existing behaviour for its existing callers
// (venue_cafe signups on this same page) must not change, per the
// go-ahead's own instruction, so this doesn't touch or reuse that
// component's own state/fields at all, even though several fields
// overlap in spirit (business name, location/parent-airfield).
//
// On success: creates the real user/account/member row server-side,
// then signs the new user in immediately (authClient.signIn.email, same
// call LoginPage.tsx itself makes) so the very next step - starting
// Stripe Checkout - can hit the authenticated /api/stripe/checkout
// endpoint without a separate login step the visitor never asked for.
type PaidSignupStatus = 'idle' | 'submitting' | 'redirecting' | 'error'

function PaidSignupForm(): JSX.Element {
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [slug, setSlug] = useState('')
  const [parentTenantSlug, setParentTenantSlug] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [plan, setPlan] = useState<PlanId>('pack')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [status, setStatus] = useState<PaidSignupStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable'; reason?: string }>({
    status: 'idle',
  })
  const slugCheckTimer = useRef<number | undefined>(undefined)

  function handleSlugChange(value: string) {
    const next = value.trim().toLowerCase()
    setSlug(next)
    window.clearTimeout(slugCheckTimer.current)
    if (!next || !SLUG_FORMAT.test(next)) {
      setSlugCheck({ status: 'idle' })
      return
    }
    setSlugCheck({ status: 'checking' })
    slugCheckTimer.current = window.setTimeout(() => {
      fetch(`${PUBLIC_CHECK_SLUG_URL}?slug=${encodeURIComponent(next)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data) return
          setSlugCheck({ status: data.available ? 'available' : 'unavailable', reason: data.reason })
        })
        .catch(() => setSlugCheck({ status: 'idle' }))
    }, SLUG_CHECK_DEBOUNCE_MS)
  }

  const purchasablePlans = PRICING_PLANS.filter((p) => !p.requiresPack)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus('submitting')
    setErrorMessage('')

    const latNum = lat.trim() ? Number(lat) : null
    const lonNum = lon.trim() ? Number(lon) : null

    const response = await fetch(SIGNUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName,
        contactName,
        email,
        password,
        slug,
        lat: latNum,
        lon: lonNum,
        parentTenantSlug: parentTenantSlug || undefined,
        plan,
        termsAccepted,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      setStatus('error')
      setErrorMessage(data?.error ?? 'Signup failed - please try again.')
      return
    }

    // Signs the new account in immediately - same call LoginPage.tsx
    // itself makes - so the checkout request right after this can use
    // the resulting session. A sign-in failure here is unexpected (the
    // password just worked server-side) but handled the same honest way
    // as any other unexpected failure: a clear error, not a silent dead
    // end.
    const signInResult = await authClient.signIn.email({ email, password })
    if (signInResult.error) {
      setStatus('error')
      setErrorMessage('Account created, but signing you in failed - please sign in manually and contact support@airfieldcentral.com.')
      return
    }

    setStatus('redirecting')
    const checkoutResponse = await fetch(STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
    const checkoutData = await checkoutResponse.json().catch(() => null)
    if (!checkoutResponse.ok || !checkoutData?.checkoutUrl) {
      setStatus('error')
      setErrorMessage(checkoutData?.error ?? 'Your account was created, but starting checkout failed - please contact support@airfieldcentral.com.')
      return
    }
    window.location.href = checkoutData.checkoutUrl
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
      <h3 className="mb-4 text-lg font-bold text-slate-100">Create your account</h3>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Business / airfield name</span>
        <input
          required
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Your name</span>
        <input
          required
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Password</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>

      <label className="mb-1 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Your subdomain</span>
        <div className="flex items-center gap-1">
          <input
            required
            value={slug}
            onChange={(event) => handleSlugChange(event.target.value)}
            placeholder="yourclub"
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
          <span className="text-sm text-slate-500">.airfieldcentral.com</span>
        </div>
      </label>
      {slugCheck.status === 'checking' && <p className="mb-3 text-xs text-slate-500">Checking…</p>}
      {slugCheck.status === 'available' && <p className="mb-3 text-xs text-emerald-400">Available</p>}
      {slugCheck.status === 'unavailable' && <p className="mb-3 text-xs text-rose-400">{slugCheck.reason ?? 'Not available'}</p>}
      {slugCheck.status === 'idle' && <div className="mb-3" />}

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Parent airfield (optional)</span>
        <input
          value={parentTenantSlug}
          onChange={(event) => setParentTenantSlug(event.target.value)}
          placeholder="e.g. shobdon - leave blank if none"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
        <span className="text-xs text-slate-500">If set, your weather source links to theirs - same as Decision #12.</span>
      </label>

      {!parentTenantSlug.trim() && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Latitude</span>
            <input
              required
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Longitude</span>
            <input
              required
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>
      )}

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Plan</span>
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value as PlanId)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          {purchasablePlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatGBP(p.priceGBP)}/mo{p.highlighted ? ' (recommended)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-4 flex items-start gap-3 text-sm text-slate-300">
        <input
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          I agree to the{' '}
          <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
            Customer Terms
          </Link>{' '}
          (incl. Schedule 1 Media Box loan and card-charge authority up to £99 per incident) and{' '}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {status === 'error' && <p className="mb-4 text-sm font-semibold text-rose-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === 'submitting' || status === 'redirecting'}
        className="w-full rounded-lg bg-sky-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
      >
        {status === 'submitting' ? 'Creating your account…' : status === 'redirecting' ? 'Taking you to checkout…' : 'Continue to payment'}
      </button>
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
  // Fork-placement round - lifted from SignupForm's own local state so
  // ProductChoiceFork (rendered here, above the CTA buttons) and
  // SignupForm (rendered further down, at signupRef) share one selection
  // instead of each owning a disconnected copy.
  const [signupType, setSignupType] = useState<SignupType | null>(null)

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
      <section className="relative h-[640px] w-full overflow-hidden sm:h-[760px]">
        <img
          src="/images/landing-page-runway.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[center_38%] saturate-[1.1] contrast-[1.05]"
        />
        {/* Gradient scrim, not a flat overlay - darker at top/bottom for
            edge blending, much lighter through the middle band (where the
            runway/sky/signage actually are) so the photo's real color and
            detail read through instead of being crushed. */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/45 via-slate-950/10 to-slate-950/55" />

        {/* Headline - centered, upper-middle of the image. */}
        <div className="relative flex h-full w-full items-center justify-center px-6 pb-56 text-center sm:px-10 sm:pb-64">
          <div className="mx-auto max-w-7xl">
            <h1 className="text-6xl font-bold text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.7)] sm:text-7xl">
              Weather &amp; Airfield Conditions
            </h1>
            <p className="mt-4 text-2xl font-semibold text-white/95 [text-shadow:0_2px_12px_rgba(0,0,0,0.7)] sm:text-3xl">
              For Clubhouse Screens &amp; Mobile Devices
            </p>
          </div>
        </div>

        {/* PROOF - moved off the dark page background and onto the hero
            image itself, lower-right over the apron/grass strip rather
            than centered under the headline. Sits inside a frosted card
            (semi-opaque + backdrop-blur) since it's now over a busy,
            colourful photo rather than a solid dark background - without
            it, "See it live" and the live reading would disappear into
            the grass/tarmac behind them. */}
        <div className="absolute inset-x-6 bottom-6 sm:inset-x-10 sm:bottom-10">
          <div className="mx-auto max-w-7xl">
            <div className="ml-auto w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-5 text-left shadow-2xl shadow-black/40 backdrop-blur-md sm:translate-x-[35px] sm:-translate-y-[35px]">
              <h2 className="text-lg font-bold text-white">See it live</h2>
              <p className="mt-2 text-sm text-white/80">
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
              <div className="mt-4">
                <LiveDashboardPreview />
              </div>
            </div>
          </div>
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

        {/* PRICING - Stripe groundwork Part A: 3 plans read from ONE
            config object (src/config/pricing.ts) instead of being typed
            out here directly - the figures used to be hardcoded in up to
            3 places (here, PlatformTenantsPage.tsx's own settings cards),
            with the Pilot's App figure already stale (£19.99, pre-
            reprice) in one of them. Airfield Pack highlighted as the
            recommended, best-value combo per the go-ahead's own
            instruction - a visually distinct card plus the savings line
            below it. */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold">Pricing</h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-4">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-xl border p-6 ${
                  plan.highlighted ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold text-slate-100">
                    {plan.name} — {formatGBP(plan.priceGBP)}/month
                  </div>
                  {plan.highlighted && (
                    <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-950">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-2 text-slate-400">{plan.description}</p>
                {plan.highlighted && (
                  <p className="mt-2 text-sm font-semibold text-sky-400">
                    Save {formatGBP(PACK_SAVINGS_GBP)}/mo vs buying separately
                  </p>
                )}
              </div>
            ))}
          </div>
          {/* Weather-wording round - must never read as "every customer
              gets live station data". Met Office data is the standard;
              a physical station is an optional, best-effort, not-
              guaranteed-everywhere upgrade - same posture BENEFITS and
              the FAQ above now use. */}
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-slate-500">
            Weather is Met Office-based as standard on every plan. Connecting your own weather station is an
            optional, best-effort upgrade, available any time — not guaranteed at every site.
          </p>
          {/* No-free-trial round - this line replaces the old "14-day
              free trial" copy (there isn't one on the paid plans below -
              see PaidSignupForm's own comment on why trial-signup.ts's
              separate, still-live 14-day trial is a different thing).
              Terms link added here directly, not just in the footer, per
              the go-ahead's own instruction. */}
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-500">
            {PRICING_TERMS_LINE}{' '}
            <Link to="/terms" className="text-slate-400 underline hover:text-sky-400">
              Read the full Terms
            </Link>
            .
          </p>
        </section>

        {/* PRODUCT CHOICE - fork-placement round: moved above the CTA
            buttons (was previously inside SignupForm itself, well below
            them) so the decision that determines which entire form a
            visitor sees reads with the same weight as Pricing directly
            above it, and is made before "Start Your Free Trial" rather
            than after. See ProductChoiceFork's own comment for the full
            reasoning. */}
        <ProductChoiceFork signupType={signupType} setSignupType={setSignupType} />

        {/* CTA FORK - Stripe groundwork Part B: button copy changed from
            "Start Your Free Trial" (go-ahead's own instruction to
            replace the old free-trial CTA with the paid signup/pricing
            flow). "Get Started" works for both branches below - the
            airfield branch now leads to paid signup (PaidSignupForm),
            the venue_cafe branch is UNCHANGED (still trial-signup.ts's
            own free trial, via SignupForm) - see PaidSignupForm's own
            top comment for why venue_cafe wasn't moved too. */}
        <section className="mt-20 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={scrollToSignup}
            className="w-full rounded-lg bg-sky-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-400 sm:w-auto"
          >
            Get Started
          </button>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Airfield Central consultation request')}`}
            className="w-full rounded-lg border border-slate-600 px-6 py-3 text-center font-semibold text-slate-100 transition hover:border-slate-400 sm:w-auto"
          >
            Book a Consultation
          </a>
        </section>

        {/* Signup form itself - target of "Get Started" above, scrolled
            to rather than a separate route/modal. signupType is owned by
            LandingPage and passed down - see ProductChoiceFork's own
            comment. signupRef sits on its own always-present anchor
            rather than on this section directly - see this section's
            own prior comment on why (mounting a form unconditionally
            leaves an awkward empty box before a choice is made). Forks
            on signupType: airfield gets the new paid flow
            (PaidSignupForm), venue_cafe keeps the existing free-trial
            flow (SignupForm) exactly as before. */}
        <div ref={signupRef} />
        {signupType === 'airfield' && (
          <section className="mx-auto mt-12 max-w-md">
            <PaidSignupForm />
          </section>
        )}
        {signupType === 'venue_cafe' && (
          <section className="mx-auto mt-12 max-w-md">
            <SignupForm signupType={signupType} setSignupType={setSignupType} />
          </section>
        )}

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

      {/* FOOTER - legal-rollout round: Privacy/Terms are now real links
          to the public legal pages (/privacy, /terms), replacing the
          previous deliberately non-clickable placeholder text from
          before those pages existed. */}
      <footer className="border-t border-slate-800 px-6 py-8 text-center text-sm text-slate-500">
        <p>Airfield Central © 2026 · Built for UK airfields and flying clubs</p>
        <p className="mt-2">
          <Link to="/privacy" className="text-slate-400 hover:text-sky-400 hover:underline">
            Privacy
          </Link>{' '}
          ·{' '}
          <Link to="/terms" className="text-slate-400 hover:text-sky-400 hover:underline">
            Terms
          </Link>{' '}
          ·{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-500 hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </footer>
    </div>
  )
}
