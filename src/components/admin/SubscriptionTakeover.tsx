import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../../lib/auth/authClient'
import { findPricingPlan, formatGBP } from '../../config/pricing'
import { ActivateSubscription } from './ActivateSubscription'

export interface TakeoverMe {
  role?: string | null
  organizationName?: string | null
  logoUrl?: string | null
  hasAcceptedTerms?: boolean
  subscription?: {
    planId?: string
    paymentReceived?: boolean
    includesMediaBox?: boolean
    hasMediaBoxConsent?: boolean
  } | null
}

interface Props {
  me: TakeoverMe | null
  onChanged: () => void
}

// The ONE page a suspended tenant's non-developer user sees (replaces the admin
// app entirely: no sidebar, no admin pages). Reached automatically after login and
// whenever any admin request answers 403 "Subscription not active"
// (AdminLayout + adminFetchGuard). The server-side lock (tenantAuth.ts) and its
// allow-list are what actually protect the tenant; this is the explanation and the
// way out: activate (straight into Stripe Checkout, no activation link), or see
// billing. Payment does NOT resume the tenant - a developer does that - so once
// Stripe reports it paid this shows "Payment received" instead of the button.
export function SubscriptionTakeover({ me, onChanged }: Props): JSX.Element {
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const sub = me?.subscription
  const plan = findPricingPlan((sub?.planId as 'pack' | 'pilotApp') ?? 'pack')
  const canPay = me?.role === 'owner' || me?.role === 'admin'

  async function logout() {
    setLoggingOut(true)
    await authClient.signOut()
    navigate('/login')
  }

  const link = 'text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 py-10 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
        {me?.logoUrl ? (
          <img src={me.logoUrl} alt={me.organizationName ?? 'Airfield logo'} className="mx-auto mb-4 h-16 max-w-[220px] object-contain" />
        ) : (
          me?.organizationName && <div className="mb-4 text-xl font-black uppercase tracking-wide text-primary">{me.organizationName}</div>
        )}
        {me?.logoUrl && me?.organizationName && <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-400">{me.organizationName}</div>}

        <h1 className="mb-3 text-2xl font-black text-white">Your subscription isn't active</h1>
        <p className="mb-6 text-sm text-slate-300">Activate your subscription to restore your dashboard, media screen and Pilot's App.</p>

        {plan && (
          <div className="mb-6 rounded-xl border border-border bg-slate-900/60 px-4 py-3 text-sm">
            <span className="font-bold text-white">{plan.name}</span> <span className="text-muted-400">— {formatGBP(plan.priceGBP)}/month</span>
          </div>
        )}

        {sub?.paymentReceived ? (
          <div role="status" className="mb-6 rounded-xl border border-status-good/40 bg-status-good/10 px-4 py-4 text-sm font-semibold text-status-good">
            Payment received — your account will be reactivated shortly.
          </div>
        ) : canPay ? (
          <div className="mb-6">
            <ActivateSubscription
              hasAcceptedTerms={!!me?.hasAcceptedTerms}
              includesMediaBox={!!sub?.includesMediaBox}
              hasMediaBoxConsent={!!sub?.hasMediaBoxConsent}
              onChanged={onChanged}
            />
          </div>
        ) : (
          <p className="mb-6 text-sm text-muted-400">Ask your airfield's owner to activate the subscription.</p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-border pt-5">
          {canPay && (
            <Link to="/billing" className={link}>
              Billing
            </Link>
          )}
          <Link to="/account" className={link}>
            My Account
          </Link>
          <a href="mailto:support@airfieldcentral.com" className={link}>
            Contact support
          </a>
          <button type="button" onClick={logout} disabled={loggingOut} className="text-sm font-semibold text-muted-400 hover:text-status-bad disabled:opacity-50">
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Minimal frame for the few pages a locked user may still open (My Account,
// Billing): no sidebar, just the tenant name, a way back to the subscription page
// and Log out.
export function LockedShell({ me, children }: { me: TakeoverMe | null; children: React.ReactNode }): JSX.Element {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-3">
        <span className="text-sm font-black uppercase tracking-wide text-primary">{me?.organizationName ?? ''}</span>
        <div className="flex items-center gap-5">
          <Link to="/subscription" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
            ← Subscription
          </Link>
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut()
              navigate('/login')
            }}
            className="text-sm font-semibold text-muted-400 hover:text-status-bad"
          >
            Log out
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
