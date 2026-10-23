import { useEffect, useRef, useState } from 'react'
import { PLATFORM_CHECK_SLUG_URL, PLATFORM_ONBOARD_TENANT_URL, PLATFORM_GEOCODE_POSTCODE_URL } from '../../../config/publicApi'
import type { PlatformTenant } from './tenantEditors'

// The "Onboard New Tenant" form, moved unchanged from the old single-file
// PlatformTenantsPage.tsx (same fields, same validation, same requests to
// check-slug / geocode-postcode / onboard). The only difference is that the
// post-create list refresh is delegated to onCreated().
// Client-side mirror of functions/api/_utils/tenantSlug.ts's own
// SLUG_FORMAT - instant typo feedback without a network round-trip.
// Reserved-word/actual-availability checking still goes through
// PLATFORM_CHECK_SLUG_URL (debounced below) rather than a second copy
// of the reserved list here - that's a single source of truth question,
// this is just "does this look like a DNS label at all."
export const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
export const SLUG_CHECK_DEBOUNCE_MS = 400

// Onboard-tool venue/café fork round - mirrors functions/api/_utils/
// tenantSlug.ts's own exported CAFE_SLUG_SUFFIX, same "mirror for
// instant client-side feedback, server stays the real authority"
// posture as SLUG_FORMAT just above (and LandingPage.tsx's own
// identical local copy of this same constant).
export const CAFE_SLUG_SUFFIX = '-media'

// Required-subdomain round: derives a starting-point suggestion from the
// airfield name field as Jeff types (e.g. "Herefordshire Gliding Club" ->
// "herefordshire-gliding") - purely a convenience pre-fill, never the
// value actually submitted unless left untouched. Drops one trailing
// generic word (club/airfield/etc.) since that's the part real airfield
// names most often share and least usefully identifies the subdomain -
// only ever one such word, not all matches, so a genuine name like
// "Airfield Flying Club" still yields something ("airfield-flying"),
// not an empty string.
export const SLUG_STOP_WORDS = new Set(['club', 'airfield', 'aerodrome', 'flying', 'association', 'society', 'centre', 'center'])

export function slugifyTenantName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
  if (words.length > 1 && SLUG_STOP_WORDS.has(words[words.length - 1])) words.pop()
  return words.join('-').slice(0, 63).replace(/-+$/, '')
}


export default function OnboardTenantPanel({
  tenants,
  onCreated,
}: {
  tenants: PlatformTenant[]
  onCreated: () => Promise<void>
}): JSX.Element {
  const [onboarding, setOnboarding] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; slug: string; email: string } | null>(null)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Onboard-tool venue/café fork round - mirrors LandingPage.tsx's own
  // ProductChoiceFork: forced choice, no default, freely switchable.
  // null (nothing chosen yet) blocks submission the same way an unfilled
  // required field does - see the submit button's disabled logic below.
  const [onboardTenantType, setOnboardTenantType] = useState<'airfield' | 'venue_cafe' | null>(null)

  // name/email round: name sets organization.name/tenants.name directly
  // (previously always onboard.ts's own hardcoded "Your Airfield Name"
  // placeholder, never overwritten anywhere in the invite flow). email
  // is validated server-side and LOCKED onto the invite itself
  // (migration 0084_tenant_invite_email.sql) - not a suggestion, this
  // becomes the resulting owner account's permanent login identity, and
  // OnboardInvitePage.tsx's own email field is read-only precisely
  // because of that. Same plain-text-input pattern as the existing
  // subdomain/lat/lon fields below, not the landing page's mobile-first
  // signup form styling - this page is desktop-only by design.
  const [tenantName, setTenantName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  // Wildcard DNS/Worker migration round: custom subdomain for the new
  // tenant. Required-subdomain round: no more blank-falls-back-to-random
  // behaviour - onboard.ts now rejects a blank slug outright, so this
  // field must be filled before submitting. Lowercased as typed (server
  // requires lowercase, not silently normalized there - forcing it here
  // means what's typed is always exactly what gets validated, no
  // surprise mismatch).
  const [desiredSlug, setDesiredSlug] = useState('')
  // Required-subdomain round: auto-fills desiredSlug from tenantName as
  // Jeff types (slugifyTenantName), but only for as long as the field
  // still holds exactly what was last auto-generated - the instant he
  // types into the subdomain field directly, this ref stops matching and
  // the auto-fill permanently steps aside, same "suggest until diverged"
  // pattern as GitHub's own repo-name-from-title field.
  const lastAutoSlugRef = useRef('')
  useEffect(() => {
    if (desiredSlug !== lastAutoSlugRef.current) return
    const base = slugifyTenantName(tenantName)
    // venue_cafe suggestion includes the required -media suffix - still
    // fully editable (this form keeps its existing editable+live-checked
    // slug UX rather than the public form's read-only-derived one, more
    // appropriate for a trusted developer who might want to tweak it),
    // the suffix is enforced by validation below regardless of whether
    // the suggestion is kept as-is or overridden.
    const suggestion = onboardTenantType === 'venue_cafe' && base ? `${base.slice(0, 63 - CAFE_SLUG_SUFFIX.length)}${CAFE_SLUG_SUFFIX}` : base
    lastAutoSlugRef.current = suggestion
    setDesiredSlug(suggestion)
  }, [tenantName, onboardTenantType])
  // idle: empty field (blocked at submit, see slugRequiredError below) or
  // format-invalid (shown via slugFormatError below, not this).
  // checking/available/unavailable only apply once the debounced
  // PLATFORM_CHECK_SLUG_URL call actually resolves - advisory only,
  // onboard.ts's own UNIQUE-constraint try/catch is the real guarantee,
  // this just keeps Jeff from ever submitting a slug it already knows is
  // hopeless.
  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable'; reason?: string }>(
    { status: 'idle' }
  )

  // Weather-share investigation round: required, not optional - a
  // tenant onboarded with no lat/lon on file has no sane weather
  // default at all (functions/api/public/weather-default.ts), which
  // silently cascaded to a real production tenant (Gyroplane Train)
  // showing fabricated mock weather with no indication anything was
  // wrong. Same plain-number-input pattern as AirfieldLocationSection.tsx's
  // own lat/lon fields (this tenant's own later self-service edit of the
  // same columns), not type="number" - keeps the same client-side
  // parse-and-range-check posture rather than relying on the browser's
  // own numeric input quirks.
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  const latBlank = lat.trim() === ''
  const lonBlank = lon.trim() === ''
  const latValid = !latBlank && Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
  const lonValid = !lonBlank && Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180

  // Postcode-first round - UK Postcode is now the primary way to fill in
  // lat/lon here (same "Locate" pattern as AirfieldLocationSection.tsx's
  // own tenant-editable version), reusing the same geocodePostcode()
  // helper the venue_cafe self-serve signup form already established
  // (functions/api/_utils/postcodeGeocode.ts) via a small platform-admin-
  // only lookup endpoint (geocode-postcode.ts - no tenant row exists yet
  // to PUT against here, unlike /config's own version). Locate only ever
  // populates lat/lon state below - onboard.ts's own submission and its
  // required-unless-parent-selected validation are completely unchanged,
  // they still just read lat/lon exactly as before.
  const [postcode, setPostcode] = useState('')
  const [locateStatus, setLocateStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [locateErrorMessage, setLocateErrorMessage] = useState<string | null>(null)
  const [advancedLocationExpanded, setAdvancedLocationExpanded] = useState(false)

  async function handleLocate() {
    if (postcode.trim() === '') return
    setLocateStatus('working')
    setLocateErrorMessage(null)
    try {
      const response = await fetch(PLATFORM_GEOCODE_POSTCODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode: postcode.trim() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.valid || typeof data.lat !== 'number' || typeof data.lon !== 'number') {
        setLocateErrorMessage(typeof data?.error === 'string' ? data.error : "Couldn't locate that postcode - please try again.")
        setLocateStatus('error')
        return
      }
      setLat(String(data.lat))
      setLon(String(data.lon))
      if (typeof data.postcode === 'string') setPostcode(data.postcode)
      setLocateStatus('success')
    } catch {
      setLocateErrorMessage("Couldn't reach the postcode lookup service - please try again.")
      setLocateStatus('error')
    }
  }

  // Parent Airfield (onboard-tool venue/café fork round) - venue_cafe
  // only, per the field list this branch replaces. Always visible for
  // that branch, right after Subdomain - no longer gated behind lat/lon
  // being valid first (a real ask: Jeff wants to pick a parent BEFORE
  // deciding whether to type coordinates at all, not after). Sets
  // tenants.parent_tenant_id directly at creation via onboard.ts's own
  // parentTenantSlug param - unlike ParentAirfieldEditor below (which
  // PUTs against an already-existing tenant's own :id route), there's
  // no tenant to PUT against yet here, so this is just local form state
  // until submit.
  const [parentTenantSlug, setParentTenantSlug] = useState('')

  // Conditional lat/lon requirement round - a parent link means the new
  // tenant can inherit the parent's own stored coordinates server-side
  // (onboard.ts's own fallback), so lat/lon become optional exactly
  // while a parent is selected: blank is now acceptable, but a
  // genuinely invalid TYPED value (out of range, non-numeric) still
  // blocks submission regardless of parent state - latValid/lonValid
  // above already encode "blank" as invalid, so "blank AND a parent is
  // selected" is the only new case this adds. Clearing the parent
  // selection naturally reverts to the strict latValid/lonValid
  // requirement with no extra effect/reset needed, since this is a
  // plain per-render derivation, not stored state of its own.
  const parentSelected = onboardTenantType === 'venue_cafe' && !!parentTenantSlug
  const latOk = latValid || (latBlank && parentSelected)
  const lonOk = lonValid || (lonBlank && parentSelected)

  // Client-side pre-check only, same posture as latValid/lonValid above -
  // onboard.ts's own validation (name required/max length, EMAIL_PATTERN,
  // not-already-registered) is still the real guarantee, this just avoids
  // a round trip for the obvious cases.
  const trimmedName = tenantName.trim()
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 100
  const trimmedEmail = contactEmail.trim()
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)

  const trimmedSlug = desiredSlug.trim()
  const slugFormatError =
    trimmedSlug && !SLUG_FORMAT.test(trimmedSlug)
      ? '3-63 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen'
      : null
  // Client-side mirror of validateSlugCandidate()'s own requiredSuffix
  // check - same "instant feedback, server stays the real authority"
  // posture as slugFormatError just above.
  const slugSuffixError =
    trimmedSlug && !slugFormatError && onboardTenantType === 'venue_cafe' && !trimmedSlug.endsWith(CAFE_SLUG_SUFFIX)
      ? `Subdomain must end with "${CAFE_SLUG_SUFFIX}"`
      : null
  const slugRequiredError = !trimmedSlug ? 'Subdomain is required' : null

  useEffect(() => {
    if (!trimmedSlug || slugFormatError || slugSuffixError) {
      setSlugCheck({ status: 'idle' })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking' })
    const timeoutId = window.setTimeout(() => {
      const tenantTypeParam = onboardTenantType === 'venue_cafe' ? '&tenantType=venue_cafe' : ''
      fetch(`${PLATFORM_CHECK_SLUG_URL}?slug=${encodeURIComponent(trimmedSlug)}${tenantTypeParam}`)
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
  }, [trimmedSlug, slugFormatError, slugSuffixError, onboardTenantType])

  async function handleOnboardTenant() {
    if (!onboardTenantType || !latOk || !lonOk || !nameValid || !emailValid || !trimmedSlug || slugSuffixError) return
    setOnboarding(true)
    setOnboardError(null)
    setInviteResult(null)
    try {
      const response = await fetch(PLATFORM_ONBOARD_TENANT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          slug: trimmedSlug,
          // null (not 0/NaN from an empty-string Number() conversion)
          // when left blank - onboard.ts distinguishes "not provided,
          // fall back to the parent's own coordinates" from "provided
          // exactly 0,0", which Number('') would otherwise collapse
          // into the same value.
          lat: latBlank ? null : parsedLat,
          lon: lonBlank ? null : parsedLon,
          tenantType: onboardTenantType,
          parentTenantSlug: onboardTenantType === 'venue_cafe' && parentTenantSlug ? parentTenantSlug : null,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setOnboardError(data?.error || 'Failed to onboard a new tenant')
        return
      }
      setInviteResult({ inviteUrl: data.inviteUrl, slug: data.slug, email: data.email })
      setOnboardTenantType(null)
      setTenantName('')
      setContactEmail('')
      setDesiredSlug('')
      lastAutoSlugRef.current = ''
      setSlugCheck({ status: 'idle' })
      setLat('')
      setLon('')
      setPostcode('')
      setLocateStatus('idle')
      setAdvancedLocationExpanded(false)
      setParentTenantSlug('')
      // Refresh the list so the new tenant row appears immediately (the same
      // GET /api/platform/tenants the page's own refresh uses).
      await onCreated()
    } finally {
      setOnboarding(false)
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteResult) return
    await navigator.clipboard.writeText(inviteResult.inviteUrl).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
        <div className="dev-type mb-6 rounded-2xl border border-border bg-panel p-6 [&_button]:min-h-[44px] [&_select]:min-h-[44px] [&_input:not([type=checkbox]):not([type=file]):not([type=radio])]:min-h-[44px]">
          <div className="mb-1 text-[18px] font-semibold leading-tight text-slate-50">Onboard New Tenant</div>
          <p className="mb-4 text-xs text-muted-500">
            Creates a new tenant and a single-use invite link. Subdomain is required and pre-filled from the name,
            but can be overridden before submitting. Latitude/longitude are required - without them there's no sane
            weather default for the tenant to start from. Email is locked onto the invite and becomes the resulting
            owner account's permanent login - not editable by whoever opens the link.
          </p>

          {/* Onboard-tool venue/café fork round - same forced-choice,
              no-default, freely-switchable concept as LandingPage.tsx's
              own ProductChoiceFork, without that one's qualifier copy
              aimed at public visitors - this is a trusted developer
              tool, brief labels are enough. Rest of the form stays
              hidden until a choice is made, same "never show a field for
              the product not yet picked" posture as the public form. */}
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setOnboardTenantType('airfield')}
              className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition ${
                onboardTenantType === 'airfield'
                  ? 'border-accent-sky-500 bg-accent-sky-500/10 text-accent-sky-400'
                  : 'border-slate-700 text-muted-400 hover:border-slate-500'
              }`}
            >
              Airfield
            </button>
            <button
              type="button"
              onClick={() => setOnboardTenantType('venue_cafe')}
              className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition ${
                onboardTenantType === 'venue_cafe'
                  ? 'border-accent-sky-500 bg-accent-sky-500/10 text-accent-sky-400'
                  : 'border-slate-700 text-muted-400 hover:border-slate-500'
              }`}
            >
              Café / Venue
            </button>
          </div>

          {onboardTenantType && (
            <>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="onboard-name" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                    {onboardTenantType === 'venue_cafe' ? 'Venue name' : 'Airfield name'}
                  </label>
                  <input
                    id="onboard-name"
                    type="text"
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                    placeholder={onboardTenantType === 'venue_cafe' ? "e.g. Meg's Cafe" : 'e.g. Gyroplane Train'}
                    className="w-64 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="onboard-email" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                    Contact email (becomes login)
                  </label>
                  <input
                    id="onboard-email"
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="owner@example.com"
                    className="w-64 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
                  />
                  {contactEmail.trim() !== '' && !emailValid && (
                    <p className="text-[11px] text-status-bad">Enter a valid email address.</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="onboard-subdomain" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                    Subdomain
                  </label>
                  <input
                    id="onboard-subdomain"
                    type="text"
                    value={desiredSlug}
                    onChange={(event) => setDesiredSlug(event.target.value.toLowerCase())}
                    placeholder={onboardTenantType === 'venue_cafe' ? 'e.g. megs-cafe-media' : 'e.g. gyroplane-train'}
                    className="w-64 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
                  />
                  <p className="text-[11px] text-muted-500">
                    {trimmedSlug ? `${trimmedSlug}.airfieldcentral.com` : 'Required'}
                    {!trimmedSlug && <span className="ml-2 text-status-bad">{slugRequiredError}</span>}
                    {slugFormatError && <span className="ml-2 text-status-bad">{slugFormatError}</span>}
                    {!slugFormatError && slugSuffixError && <span className="ml-2 text-status-bad">{slugSuffixError}</span>}
                    {!slugFormatError && !slugSuffixError && slugCheck.status === 'checking' && (
                      <span className="ml-2 text-muted-400">Checking…</span>
                    )}
                    {!slugFormatError && !slugSuffixError && slugCheck.status === 'available' && (
                      <span className="ml-2 text-status-good">Available</span>
                    )}
                    {!slugFormatError && !slugSuffixError && slugCheck.status === 'unavailable' && (
                      <span className="ml-2 text-status-bad">{slugCheck.reason}</span>
                    )}
                  </p>
                </div>
                {/* Parent Airfield round - always visible on the café
                    branch now, right after Subdomain, no longer gated
                    behind lat/lon being filled first: Jeff wants to pick
                    a parent BEFORE deciding whether to type coordinates
                    at all, since a parent link makes them optional (see
                    latOk/lonOk's own comment above).

                    Visibility round: selecting a real parent also clears
                    any typed lat/lon, not just hides the fields below -
                    without this, a value typed BEFORE picking a parent
                    would linger in state while its field disappears, and
                    if it happened to be invalid (non-blank, out of
                    range), latOk/lonOk would stay false with no visible
                    field left to fix it, silently blocking submission.
                    Clearing on select keeps "parent selected" and
                    "fields hidden" always mean the same thing: nothing
                    entered, will inherit the parent's own coordinates. */}
                {onboardTenantType === 'venue_cafe' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="onboard-parent" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                      Parent Airfield (optional)
                    </label>
                    <select
                      id="onboard-parent"
                      value={parentTenantSlug}
                      onChange={(event) => {
                        setParentTenantSlug(event.target.value)
                        if (event.target.value) {
                          setLat('')
                          setLon('')
                          setPostcode('')
                          setLocateStatus('idle')
                        }
                      }}
                      className="w-56 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    >
                      <option value="">(None)</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.slug}>
                          {t.name} ({t.slug})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Hidden entirely (not just marked optional) once a
                    parent is selected - nothing to fill in or look at
                    at that point, per spec. Reappear, required again,
                    the instant the selection reverts to "— None —" -
                    parentSelected is a plain per-render derivation, so
                    this needs no extra show/hide state of its own. */}
                {!parentSelected && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="onboard-postcode" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                        UK Postcode
                      </label>
                      <input
                        id="onboard-postcode"
                        value={postcode}
                        onChange={(event) => {
                          setPostcode(event.target.value)
                          if (locateStatus !== 'idle') setLocateStatus('idle')
                        }}
                        placeholder="HR6 9NR"
                        className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm uppercase text-white placeholder:text-muted-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleLocate}
                      disabled={locateStatus === 'working' || postcode.trim() === ''}
                      className="shrink-0 rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                    >
                      {locateStatus === 'working' ? 'Locating…' : 'Locate'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleOnboardTenant}
                  disabled={
                    onboarding ||
                    !trimmedSlug ||
                    !!slugFormatError ||
                    !!slugSuffixError ||
                    slugCheck.status === 'checking' ||
                    slugCheck.status === 'unavailable' ||
                    !latOk ||
                    !lonOk ||
                    !nameValid ||
                    !emailValid
                  }
                  className="shrink-0 rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                >
                  {onboarding ? 'Creating…' : 'Onboard new tenant'}
                </button>
              </div>
              {locateStatus === 'success' && latValid && lonValid ? (
                <p className="mt-2 text-[11px] text-status-good">Located at {parsedLat.toFixed(2)}, {parsedLon.toFixed(2)}</p>
              ) : locateStatus === 'error' ? (
                <p className="mt-2 text-[11px] text-status-bad">{locateErrorMessage}</p>
              ) : (lat.trim() !== '' && !latValid) || (lon.trim() !== '' && !lonValid) ? (
                <p className="mt-2 text-[11px] text-status-bad">Latitude must be -90 to 90, longitude -180 to 180.</p>
              ) : parentSelected && latBlank && lonBlank ? (
                <p className="mt-2 text-[11px] text-muted-500">
                  Left blank - will use the selected Parent Airfield's own coordinates.
                </p>
              ) : null}
              {/* Advanced/manual override - same "hidden entirely once a
                  parent is selected" posture as the postcode field above
                  (nothing to fill in or look at at that point). Still
                  needed for a future non-UK tenant (postcodes.io is
                  UK-only) or if a postcode lookup ever fails and Jeff
                  already knows the coordinates some other way. Directly
                  edits the same lat/lon state the postcode Locate action
                  above also populates - onboard.ts's own submission
                  reads whichever value is currently in that state,
                  regardless of which path set it. */}
              {!parentSelected && (
                <div className="mt-3 border-t border-slate-700/60 pt-3">
                  <button
                    type="button"
                    onClick={() => setAdvancedLocationExpanded((prev) => !prev)}
                    className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-400"
                    aria-expanded={advancedLocationExpanded}
                  >
                    <span className={`inline-block transition-transform ${advancedLocationExpanded ? 'rotate-90' : ''}`} aria-hidden="true">
                      ▸
                    </span>
                    Advanced / manual override
                  </button>
                  {advancedLocationExpanded && (
                    <div className="mt-2 flex flex-wrap items-end gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="onboard-lat" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                          Latitude
                        </label>
                        <input
                          id="onboard-lat"
                          value={lat}
                          onChange={(event) => setLat(event.target.value)}
                          placeholder="52.2416"
                          inputMode="decimal"
                          className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="onboard-lon" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                          Longitude
                        </label>
                        <input
                          id="onboard-lon"
                          value={lon}
                          onChange={(event) => setLon(event.target.value)}
                          placeholder="-2.8821"
                          inputMode="decimal"
                          className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {onboardError && <p className="mb-4 text-sm font-semibold text-status-bad">{onboardError}</p>}

        {inviteResult && (
          <div className="mb-8 rounded-2xl border border-accent-sky-500/40 bg-panel p-6">
            <div className="mb-2 text-[18px] font-semibold leading-tight text-slate-50">
              New tenant created: {inviteResult.slug}
            </div>
            <p className="mb-3 text-xs text-muted-500">
              Copy this single-use link and send it to <span className="text-white">{inviteResult.email}</span> manually
              - no email is sent automatically yet. That address is locked onto this invite; whoever opens the link
              can't change it.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteResult.inviteUrl}
                onFocus={(event) => event.target.select()}
                className="flex-1 rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="shrink-0 rounded bg-accent-sky-500 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-sky-400"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
    </>
  )
}
