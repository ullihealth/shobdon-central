import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { activationCheckUrl, STRIPE_CHECKOUT_URL, TERMS_ACCEPT_URL } from '../config/publicApi'
import { findPricingPlan } from '../config/pricing'

// Stripe groundwork Part C - existing-tenant activation. Public route
// (see App.tsx's own comment on why no RequireAuth wrapper), but every
// real action here (accepting terms, starting checkout) goes through an
// authenticated endpoint that re-derives the tenant from the caller's
// own session - this page is just the UI shell around functions/api/
// public/activation/[token].ts (read-only validation) and
// functions/api/stripe/checkout.ts (the actual token-spending action).
// No cloning, no tenant-config writes anywhere on this page - Tiger's
// (or any tenant's) existing setup is never touched.
interface ActivationState {
  tenantName: string
  tenantSlug: string
  plan: string
  loggedIn: boolean
  isMemberOfTenant: boolean
  hasAcceptedCurrentTerms: boolean
}

type LoadStatus = 'loading' | 'ready' | 'error'

export default function ActivationPage(): JSX.Element {
  const { token } = useParams<{ token: string }>()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [state, setState] = useState<ActivationState | null>(null)
  const [acceptingTerms, setAcceptingTerms] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const [startingCheckout, setStartingCheckout] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')

  function load() {
    if (!token) return
    setStatus('loading')
    fetch(activationCheckUrl(token))
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok || !data) {
          setErrorMessage(data?.error ?? 'This activation link is not valid.')
          setStatus('error')
          return
        }
        setState(data as ActivationState)
        setStatus('ready')
      })
      .catch(() => {
        setErrorMessage('Could not reach the server - please check your connection and try again.')
        setStatus('error')
      })
  }

  useEffect(() => {
    document.title = 'Activate your subscription — Airfield Central'
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleAcceptTerms() {
    setAcceptingTerms(true)
    try {
      const response = await fetch(TERMS_ACCEPT_URL, { method: 'POST' })
      if (response.ok) load()
    } finally {
      setAcceptingTerms(false)
    }
  }

  async function handleStartCheckout() {
    if (!token || !state) return
    setStartingCheckout(true)
    setCheckoutError('')
    try {
      const response = await fetch(STRIPE_CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: state.plan, activationToken: token }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.checkoutUrl) {
        setCheckoutError(data?.error ?? 'Could not start checkout - please try again.')
        setStartingCheckout(false)
        return
      }
      window.location.href = data.checkoutUrl
    } catch {
      setCheckoutError('Could not reach the server - please check your connection and try again.')
      setStartingCheckout(false)
    }
  }

  const plan = state ? findPricingPlan(state.plan as 'pack' | 'pilotApp') : undefined

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
        <h1 className="mb-6 text-xl font-black uppercase tracking-wide text-primary">Activate your subscription</h1>

        {status === 'loading' && <p className="text-sm text-muted-400">Checking your activation link…</p>}

        {status === 'error' && (
          <>
            <p className="text-sm font-semibold text-status-bad">{errorMessage}</p>
            <p className="mt-4 text-sm text-muted-400">
              Contact <a href="mailto:support@airfieldcentral.com" className="text-accent-sky-400 hover:underline">support@airfieldcentral.com</a> if you think this is wrong.
            </p>
          </>
        )}

        {status === 'ready' && state && (
          <>
            <p className="mb-2 text-sm text-slate-300">
              Activating <span className="font-semibold text-white">{plan?.name ?? state.plan}</span> for{' '}
              <span className="font-semibold text-white">{state.tenantName}</span>.
            </p>
            {plan && <p className="mb-6 text-sm text-muted-400">{plan.description}</p>}

            {!state.loggedIn && (
              <div className="rounded-lg border border-border bg-slate-900/60 p-4 text-sm text-slate-300">
                Please{' '}
                <Link to="/login" className="text-accent-sky-400 hover:underline">
                  log in
                </Link>{' '}
                as a member of {state.tenantName}, then come back to this link to continue.
              </div>
            )}

            {state.loggedIn && !state.isMemberOfTenant && (
              <div className="rounded-lg border border-status-bad/40 bg-status-bad/10 p-4 text-sm text-status-bad">
                You're not logged in as a member of {state.tenantName}. Please log in with that tenant's own account.
              </div>
            )}

            {state.loggedIn && state.isMemberOfTenant && !state.hasAcceptedCurrentTerms && (
              <div className="rounded-lg border border-border bg-slate-900/60 p-4">
                <label className="flex items-start gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={termsChecked}
                    onChange={(event) => setTermsChecked(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I agree to the{' '}
                    <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                      Customer Terms
                    </Link>{' '}
                    (incl. Schedule 1 Media Box loan and card-charge authority up to £99 per incident) and{' '}
                    <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>
                <button
                  type="button"
                  disabled={!termsChecked || acceptingTerms}
                  onClick={handleAcceptTerms}
                  className="mt-4 w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                >
                  {acceptingTerms ? 'Saving…' : 'Agree and continue'}
                </button>
              </div>
            )}

            {state.loggedIn && state.isMemberOfTenant && state.hasAcceptedCurrentTerms && (
              <>
                <button
                  type="button"
                  disabled={startingCheckout}
                  onClick={handleStartCheckout}
                  className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                >
                  {startingCheckout ? 'Starting checkout…' : `Activate ${plan?.name ?? state.plan}`}
                </button>
                {checkoutError && <p className="mt-3 text-sm font-semibold text-status-bad">{checkoutError}</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
