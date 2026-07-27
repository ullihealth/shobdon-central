import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'
import {
  onboardInviteAcceptUrl,
  onboardInviteSubdomainUrl,
  onboardInviteValidateUrl,
  PUBLIC_CHECK_SLUG_URL,
} from '../config/publicApi'
import { useHostReachable } from '../hooks/useHostReachable'
import PasswordField from '../components/PasswordField'

type ValidateState =
  | { status: 'loading' }
  | { status: 'invalid'; reason: string }
  | { status: 'valid'; tenantName: string; subdomain: string; subdomainConfirmed: boolean }

const REASON_MESSAGES: Record<string, string> = {
  not_found: 'This invite link is not valid.',
  used: 'This invite link has already been used.',
  expired: 'This invite link has expired.',
}

// Client-side mirror of functions/api/_utils/tenantSlug.ts's own
// SLUG_FORMAT - instant typo feedback with no network round-trip, same
// pattern as LandingPage.tsx's own signup form and
// PlatformTenantsPage.tsx's onboarding field.
const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const SLUG_CHECK_DEBOUNCE_MS = 400

// Public, unauthenticated: /onboard/:token - account setup step of the
// onboarding pipeline. On success, signs the new account in via
// authClient (real BetterAuth session, not a custom mechanism) and
// lands on /design (the branding step) - the mandatory terms gate
// (RequireAuth.tsx) then takes over from there on the next real
// navigation, since /design alone carries skipTermsGate.
//
// Cross-subdomain session round: the invite link itself is opened on
// the generic app domain (onboard.ts's own comment - deliberately
// host-agnostic), but every OTHER admin surface (AdminSidebar's own
// logo link, fixed a couple of rounds ago) now correctly sends a
// logged-in admin to their tenant's own subdomain, now that the
// wildcard DNS migration makes it actually resolve. Signing in HERE, on
// the generic domain, scopes the session cookie to that host only - the
// very first real click after onboarding (the header logo) would then
// land the brand-new admin on their own subdomain with no valid session
// there at all, looking exactly like a rejected password even though
// nothing about the credential itself was wrong. Fix: redirect onto the
// tenant's own subdomain BEFORE rendering the form at all, so account
// creation and sign-in both happen natively on the host the admin will
// actually keep using - not a cookie-domain change (that's a real
// security-relevant architecture decision, not made here), just doing
// the whole flow on the right host from the start.
//
// Subdomain-picker round: a tenant created via onboard.ts's optional
// custom-slug field already has a real, deliberately-chosen subdomain
// (subdomainConfirmed - migration 0046_tenant_subdomain_confirmed.sql)
// and skips straight to the redirect-then-account-setup flow above,
// unchanged. One created without it still has onboard.ts's own random
// tenant-XXXXXXXX placeholder - this now requires the customer to
// choose their real address FIRST, before anything else, since the
// platform admin proved easy to overlook. Confirming a subdomain here
// just updates local validate state with the new value; that alone is
// enough to feed the exact same redirect effect above (it doesn't care
// why the subdomain changed, just that it did) - no separate redirect
// path to keep in sync, so the exact bug this whole file exists to
// prevent can't reappear via a second code path.
export default function OnboardInvitePage(): JSX.Element {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [validate, setValidate] = useState<ValidateState>({ status: 'loading' })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Non-empty check on confirmPassword specifically - never flag a
  // mismatch just because the user hasn't typed the second field yet.
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword

  // Subdomain-picker step's own state - kept separate from the account-
  // setup form's error/submitting state above since they're genuinely
  // different steps a user never sees at the same time.
  const [pickedSlug, setPickedSlug] = useState('')
  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable'; reason?: string }>(
    { status: 'idle' }
  )
  const [confirmingSubdomain, setConfirmingSubdomain] = useState(false)
  const [subdomainError, setSubdomainError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(onboardInviteValidateUrl(token))
      .then((response) => (response.ok ? response.json() : { valid: false, reason: 'not_found' }))
      .then((data) => {
        if (cancelled) return
        setValidate(
          data.valid
            ? { status: 'valid', tenantName: data.tenantName ?? '', subdomain: data.subdomain, subdomainConfirmed: !!data.subdomainConfirmed }
            : { status: 'invalid', reason: data.reason }
        )
      })
      .catch(() => {
        if (!cancelled) setValidate({ status: 'invalid', reason: 'not_found' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const tenantSubdomain = validate.status === 'valid' ? validate.subdomain : null
  const subdomainConfirmed = validate.status === 'valid' && validate.subdomainConfirmed
  const isOnOwnSubdomain = !tenantSubdomain || tenantSubdomain === window.location.hostname
  // Never probe/redirect toward an unconfirmed (still-random) subdomain -
  // only once a human has actually chosen one, whether that was already
  // true on the very first validate() response (admin set it at
  // creation) or just became true via the picker step below.
  const crossHostSubdomain = subdomainConfirmed && !isOnOwnSubdomain ? tenantSubdomain : null
  const subdomainReachable = useHostReachable(crossHostSubdomain)

  useEffect(() => {
    if (!subdomainConfirmed || isOnOwnSubdomain || subdomainReachable !== true) return
    // Hard navigation, not React Router - this must actually leave the
    // current origin. No credentials are in flight yet at this point
    // (the form hasn't been submitted), so there's nothing sensitive to
    // carry across; the token in the URL is already how invite links
    // work today, unchanged.
    window.location.href = `https://${tenantSubdomain}/onboard/${token}`
  }, [subdomainConfirmed, isOnOwnSubdomain, subdomainReachable, tenantSubdomain, token])

  const trimmedPickedSlug = pickedSlug.trim()
  const pickedSlugFormatError =
    trimmedPickedSlug && !SLUG_FORMAT.test(trimmedPickedSlug)
      ? '3-63 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen'
      : null

  useEffect(() => {
    if (!trimmedPickedSlug || pickedSlugFormatError) {
      setSlugCheck({ status: 'idle' })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking' })
    const timeoutId = window.setTimeout(() => {
      fetch(`${PUBLIC_CHECK_SLUG_URL}?slug=${encodeURIComponent(trimmedPickedSlug)}`)
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
  }, [trimmedPickedSlug, pickedSlugFormatError])

  async function handleConfirmSubdomain(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!token) return
    setConfirmingSubdomain(true)
    setSubdomainError(null)

    const response = await fetch(onboardInviteSubdomainUrl(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: trimmedPickedSlug }),
    })
    const data = await response.json().catch(() => null)
    setConfirmingSubdomain(false)

    if (!response.ok) {
      setSubdomainError(data?.error || 'Something went wrong - please try again')
      return
    }

    // Feeds directly into the redirect effect above via the exact same
    // derived values every other case already uses - not a second
    // redirect path.
    setValidate((prev) =>
      prev.status === 'valid' ? { ...prev, subdomain: data.subdomain, subdomainConfirmed: true } : prev
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return
    setSubmitting(true)
    setError(null)

    const response = await fetch(onboardInviteAcceptUrl(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, email, password }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setSubmitting(false)
      setError(data?.error || 'Something went wrong - please try again')
      return
    }

    const { error: signInError } = await authClient.signIn.email({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError('Account created, but automatic sign-in failed - please sign in manually.')
      navigate('/login')
      return
    }
    navigate('/design')
  }

  if (validate.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <p className="text-sm text-muted-400">Checking your invite link…</p>
      </div>
    )
  }

  if (validate.status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Invite link unavailable</h1>
          <p className="text-sm text-muted-400">{REASON_MESSAGES[validate.reason] ?? REASON_MESSAGES.not_found}</p>
          <p className="mt-4 text-xs text-muted-500">Contact support@airfieldcentral.com for a new link.</p>
        </div>
      </div>
    )
  }

  // Required first step for a tenant with no deliberately-chosen
  // subdomain yet - skipped entirely (never rendered at all) when
  // subdomainConfirmed is already true, whether that's because the
  // platform admin set one at creation or a prior visit here already
  // confirmed it.
  if (!subdomainConfirmed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <form
          onSubmit={handleConfirmSubdomain}
          className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20"
        >
          <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Choose your address</h1>
          <p className="mb-6 text-base text-muted-400">
            Your dashboard will have its own unique web address — pick one below to get started.
          </p>

          <label className="mb-1 flex flex-col gap-1.5">
            <span className="text-sm font-semibold uppercase tracking-widest text-muted-400">Subdomain</span>
            <input
              type="text"
              required
              maxLength={63}
              value={pickedSlug}
              onChange={(event) => setPickedSlug(event.target.value.toLowerCase())}
              placeholder="e.g. staraeroclub"
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-base text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <p className="mb-6 text-sm text-muted-500">
            {trimmedPickedSlug || '?'}.airfieldcentral.com
            {pickedSlugFormatError && <span className="ml-2 text-status-bad">{pickedSlugFormatError}</span>}
            {!pickedSlugFormatError && slugCheck.status === 'checking' && <span className="ml-2 text-muted-400">Checking…</span>}
            {!pickedSlugFormatError && slugCheck.status === 'available' && <span className="ml-2 text-status-good">Available</span>}
            {!pickedSlugFormatError && slugCheck.status === 'unavailable' && (
              <span className="ml-2 text-status-bad">{slugCheck.reason}</span>
            )}
          </p>

          {subdomainError && <p className="mb-4 text-base font-semibold text-status-bad">{subdomainError}</p>}

          <button
            type="submit"
            disabled={confirmingSubdomain || !!pickedSlugFormatError || slugCheck.status !== 'available'}
            className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
          >
            {confirmingSubdomain ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    )
  }

  // Redirect in flight (or still probing whether the target even
  // resolves) - never render the account-setup form on the wrong host.
  // subdomainReachable === false is the fallback case (target genuinely
  // not reachable, e.g. DNS not yet propagated) - falls through to the
  // normal form below instead, completing on the current host exactly
  // as this page always did before this round, rather than redirecting
  // a brand-new customer into a dead end.
  if (!isOnOwnSubdomain && subdomainReachable !== false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <p className="text-sm text-muted-400">Taking you to your own dashboard address…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20"
      >
        <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Set up your account</h1>
        <p className="mb-6 text-base text-muted-400">Create your login to start setting up your tenant.</p>

        <label className="mb-4 flex flex-col gap-1.5">
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-400">Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-base text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="mb-4 flex flex-col gap-1.5">
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-base text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          required
          minLength={8}
          autoComplete="new-password"
          helperText="At least 8 characters."
        />

        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          required
          minLength={8}
          autoComplete="new-password"
        />
        {passwordsMismatch && <p className="mb-4 text-sm font-semibold text-status-bad">Passwords don't match.</p>}

        {error && <p className="mb-4 text-base font-semibold text-status-bad">{error}</p>}

        <button
          type="submit"
          disabled={submitting || passwordsMismatch || !confirmPassword}
          className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
