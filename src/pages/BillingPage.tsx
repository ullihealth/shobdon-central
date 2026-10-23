import { useCallback, useEffect, useState } from 'react'
import { ActivateSubscription } from '../components/admin/ActivateSubscription'
import { findPricingPlan, formatGBP } from '../config/pricing'
import { customerStatusLabel } from '../utils/billingStatus'

const BILLING_STATUS_URL = '/api/tenant/billing/status'
const BILLING_PORTAL_URL = '/api/tenant/billing/portal'

interface Invoice {
  id: string
  number: string | null
  status: string | null
  amountPaid: number
  currency: string
  created: string | null
  hostedUrl: string | null
  pdfUrl: string | null
}

interface BillingStatus {
  tenantName: string
  plan: 'pack' | 'pilotApp'
  subscriptionStatus: string
  stripeStatus: string | null
  cancelAtPeriodEnd: boolean
  amount: { value: number; currency: string } | null
  nextPaymentDate: string | null
  invoices: Invoice[]
  hasStripeCustomer: boolean
  hasStripeSubscription: boolean
  tenantActive: boolean
  paymentReceived: boolean
  includesMediaBox: boolean
  hasMediaBoxConsent: boolean
  hasAcceptedTerms: boolean
  stripeError: boolean
  // A developer / platform admin viewing this tenant's billing: read-only (no checkout, no portal).
  isDeveloper?: boolean
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
}

function formatMoney(value: number, currency: string): string {
  return currency === 'GBP' ? formatGBP(value) : `${value.toFixed(2)} ${currency}`
}

// Tenant billing (owner/admin): plan, status, next payment date, recent invoices
// and "Update card / manage billing" (Stripe Customer Portal). Also reachable from
// the "subscription not active" page. A tenant with no Stripe customer yet gets
// "Activate subscription" instead. Data comes from GET /api/tenant/billing/status
// (live from Stripe when there is a customer; a Stripe outage just hides the live
// figures with a note).
export default function BillingPage(): JSX.Element {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [portalError, setPortalError] = useState('')
  const justPaid = new URLSearchParams(window.location.search).get('checkout') === 'success'

  const load = useCallback(() => {
    fetch(BILLING_STATUS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setStatus(data)
          setLoadError(false)
        } else setLoadError(true)
      })
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    document.title = 'Billing - Airfield Central'
    load()
  }, [load])

  // Right after Checkout the webhook may take a moment: re-read a few times.
  useEffect(() => {
    if (!justPaid) return
    const timers = [2000, 5000, 10000].map((ms) => window.setTimeout(load, ms))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [justPaid, load])

  async function openPortal() {
    setOpeningPortal(true)
    setPortalError('')
    try {
      const response = await fetch(BILLING_PORTAL_URL, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.portalUrl) {
        setPortalError(data?.error ?? 'Could not open the billing portal - please try again.')
        setOpeningPortal(false)
        return
      }
      window.location.href = data.portalUrl
    } catch {
      setPortalError('Could not reach the server - please try again.')
      setOpeningPortal(false)
    }
  }

  const plan = status ? findPricingPlan(status.plan) : undefined
  const card = 'rounded-2xl border border-border bg-panel p-6'
  const label = 'text-xs font-semibold uppercase tracking-widest text-muted-500'

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-black uppercase tracking-wide text-primary">Billing</h1>

      {loadError && <p className="text-sm text-status-bad">Couldn't load your billing details - please refresh and try again.</p>}
      {!status && !loadError && <p className="text-sm text-muted-400">Loading…</p>}

      {status && (
        <div className="flex flex-col gap-6">
          {justPaid && !status.hasStripeSubscription && (
            <p className="rounded-xl border border-border bg-slate-900/60 px-4 py-3 text-sm text-slate-300">Thanks - we're confirming your payment…</p>
          )}
          {status.paymentReceived && (
            <p role="status" className="rounded-xl border border-status-good/40 bg-status-good/10 px-4 py-3 text-sm font-semibold text-status-good">
              Payment received - your account will be reactivated shortly.
            </p>
          )}

          <section className={card}>
            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <div className={label}>Plan</div>
                <div className="mt-1 text-base font-bold text-white">{plan?.name ?? status.plan}</div>
                <div className="text-sm text-muted-400">
                  {status.amount ? `${formatMoney(status.amount.value, status.amount.currency)}/month` : plan ? `${formatGBP(plan.priceGBP)}/month` : ''}
                </div>
              </div>
              <div>
                <div className={label}>Status</div>
                <div className="mt-1 text-base font-bold text-white">{customerStatusLabel(status)}</div>
                {status.cancelAtPeriodEnd && <div className="text-sm text-status-warn">Ends at the end of this period</div>}
              </div>
              <div>
                <div className={label}>{status.cancelAtPeriodEnd ? 'Ends on' : 'Next payment'}</div>
                <div className="mt-1 text-base font-bold text-white">{formatDate(status.nextPaymentDate)}</div>
              </div>
            </div>
            {status.stripeError && <p className="mt-4 text-xs text-muted-500">Live billing details from Stripe are unavailable right now.</p>}
          </section>

          {(status.isDeveloper || status.hasStripeCustomer || !(status.paymentReceived || status.hasStripeSubscription)) && (
            <section className={card}>
              {status.isDeveloper ? (
                // Developers / platform admins can SEE a tenant's billing but never act as the tenant.
                <p className="text-sm text-muted-400">
                  Read-only view for developers. Checkout and the billing portal are only available to the tenant's own owner or admin.
                </p>
              ) : status.hasStripeCustomer ? (
                <>
                  <button
                    type="button"
                    onClick={openPortal}
                    disabled={openingPortal}
                    className="rounded-lg bg-accent-sky-500 px-5 py-3 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                  >
                    {openingPortal ? 'Opening...' : 'Update card / manage billing'}
                  </button>
                  <p className="mt-2 text-xs text-muted-500">Opens Stripe's secure billing portal.</p>
                  {portalError && <p className="mt-2 text-sm font-semibold text-status-bad">{portalError}</p>}
                </>
              ) : (
                <ActivateSubscription
                  hasAcceptedTerms={status.hasAcceptedTerms}
                  includesMediaBox={status.includesMediaBox}
                  hasMediaBoxConsent={status.hasMediaBoxConsent}
                  onChanged={load}
                />
              )}
            </section>
          )}

          <section className={card}>
            <div className={`mb-3 ${label}`}>Recent invoices</div>
            {status.invoices.length === 0 ? (
              <p className="text-sm text-muted-400">No invoices yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-widest text-muted-500">
                    <th className="pb-2 font-semibold">Date</th>
                    <th className="pb-2 font-semibold">Invoice</th>
                    <th className="pb-2 font-semibold">Amount</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {status.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-border/60">
                      <td className="py-2 text-slate-300">{formatDate(invoice.created)}</td>
                      <td className="py-2 text-slate-300">{invoice.number ?? invoice.id}</td>
                      <td className="py-2 text-slate-300">{formatMoney(invoice.amountPaid, invoice.currency)}</td>
                      <td className="py-2 capitalize text-slate-300">{invoice.status ?? '-'}</td>
                      <td className="py-2 text-right">
                        {invoice.hostedUrl && (
                          <a href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                            View
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
