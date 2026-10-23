import { useEffect, useState } from 'react'
import { STRIPE_CHECKOUT_URL } from '../config/publicApi'
import { findPricingPlan, formatGBP, type PlanId } from '../config/pricing'

// Abandoned-checkout round - reached via RequireAuth.tsx's own gate
// (meCheck.subscriptionPending), not linked from anywhere else. A
// tenant created via the new paid-signup route that closed the Stripe
// tab, declined, or otherwise never finished Checkout lands here on
// every subsequent login/page visit instead of a dashboard full of
// locked panels - same "/api/stripe/checkout" call PaidSignupForm
// itself makes right after signup, just re-triggerable here.
export default function CompleteSubscriptionPage(): JSX.Element {
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'Complete your subscription - Airfield Central'
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setPendingPlan((data?.pendingPlan as PlanId) ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleContinue() {
    if (!pendingPlan) return
    setStarting(true)
    setError('')
    try {
      const response = await fetch(STRIPE_CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: pendingPlan }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.checkoutUrl) {
        setError(data?.error ?? 'Could not start checkout - please try again.')
        setStarting(false)
        return
      }
      window.location.href = data.checkoutUrl
    } catch {
      setError('Could not reach the server - please check your connection and try again.')
      setStarting(false)
    }
  }

  const plan = pendingPlan ? findPricingPlan(pendingPlan) : undefined

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
        <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-primary">Complete your subscription</h1>
        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted-400">
              Your account is set up, but checkout for{' '}
              <span className="font-semibold text-white">{plan?.name ?? pendingPlan ?? 'your plan'}</span>{' '}
              {plan ? `(${formatGBP(plan.priceGBP)}/mo) ` : ''}
              wasn't finished. Your dashboard unlocks as soon as payment is confirmed.
            </p>
            {error && <p className="mb-4 text-sm font-semibold text-status-bad">{error}</p>}
            <button
              type="button"
              disabled={starting || !pendingPlan}
              onClick={handleContinue}
              className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {starting ? 'Taking you to checkout…' : 'Continue to payment'}
            </button>
            <a
              href="mailto:support@airfieldcentral.com"
              className="mt-4 block text-sm text-accent-sky-400 hover:underline"
            >
              Need help? Contact support
            </a>
          </>
        )}
      </div>
    </div>
  )
}
