import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MEDIA_BOX_CONSENT_ACCEPT_URL, TERMS_ACCEPT_URL } from '../../config/publicApi'

const BILLING_CHECKOUT_URL = '/api/tenant/billing/checkout'

interface Props {
  // Which consent steps are still outstanding (from /api/tenant/me or
  // /api/tenant/billing/status).
  hasAcceptedTerms: boolean
  includesMediaBox: boolean
  hasMediaBoxConsent: boolean
  // Refetch the caller's state after a consent was saved.
  onChanged: () => void
  buttonLabel?: string
}

// "Activate subscription" with NO activation link: shows the Customer Terms
// and (for plans that include a Media Box) the Schedule 1 consent inline FIRST
// if they have not been given yet - the same wording and the same routes the
// /activate/<token> page uses (POST /api/tenant/terms/accept and
// /api/tenant/media-box-consent/accept) - then a big button straight into Stripe
// Checkout for the tenant's plan (POST /api/tenant/billing/checkout, which
// re-checks both consents server-side).
export function ActivateSubscription({ hasAcceptedTerms, includesMediaBox, hasMediaBoxConsent, onChanged, buttonLabel = 'Activate subscription' }: Props): JSX.Element {
  const [termsChecked, setTermsChecked] = useState(false)
  const [mediaBoxChecked, setMediaBoxChecked] = useState(false)
  const [saving, setSaving] = useState<'terms' | 'consent' | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  async function accept(url: string, which: 'terms' | 'consent') {
    setSaving(which)
    setError('')
    try {
      const response = await fetch(url, { method: 'POST' })
      if (response.ok) onChanged()
      else setError("Couldn't save that - please try again.")
    } catch {
      setError('Could not reach the server - please check your connection and try again.')
    } finally {
      setSaving(null)
    }
  }

  async function startCheckout() {
    setStarting(true)
    setError('')
    try {
      const response = await fetch(BILLING_CHECKOUT_URL, { method: 'POST' })
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

  const primary =
    'w-full rounded-lg bg-accent-sky-500 px-4 py-3 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50'

  return (
    <div className="flex flex-col gap-4 text-left">
      {!hasAcceptedTerms && (
        <div className="rounded-lg border border-border bg-slate-900/60 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-300">
            <input type="checkbox" checked={termsChecked} onChange={(event) => setTermsChecked(event.target.checked)} className="mt-0.5" />
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
          <button type="button" disabled={!termsChecked || saving === 'terms'} onClick={() => accept(TERMS_ACCEPT_URL, 'terms')} className={`mt-4 ${primary}`}>
            {saving === 'terms' ? 'Saving…' : 'Agree and continue'}
          </button>
        </div>
      )}

      {hasAcceptedTerms && includesMediaBox && !hasMediaBoxConsent && (
        <div className="rounded-lg border border-border bg-slate-900/60 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-300">
            <input type="checkbox" checked={mediaBoxChecked} onChange={(event) => setMediaBoxChecked(event.target.checked)} className="mt-0.5" />
            <span>
              I agree to the{' '}
              <Link to="/terms#schedule-1" target="_blank" rel="noopener noreferrer" className="text-accent-sky-400 hover:underline">
                Media Box loan terms (Schedule 1)
              </Link>
              : the box remains Airfield Central's property, and I authorise Airfield Central to charge my saved card up to £99 per incident if it
              is lost, damaged beyond normal use, or not returned within 14 days of my subscription ending. I'll be emailed first and given 7 days
              to respond. Nothing is charged or held today.
            </span>
          </label>
          <button type="button" disabled={!mediaBoxChecked || saving === 'consent'} onClick={() => accept(MEDIA_BOX_CONSENT_ACCEPT_URL, 'consent')} className={`mt-4 ${primary}`}>
            {saving === 'consent' ? 'Saving…' : 'Agree and continue'}
          </button>
        </div>
      )}

      {hasAcceptedTerms && (!includesMediaBox || hasMediaBoxConsent) && (
        <button type="button" disabled={starting} onClick={startCheckout} className={`${primary} py-4 text-base`}>
          {starting ? 'Starting checkout…' : buttonLabel}
        </button>
      )}
      {error && <p className="text-sm font-semibold text-status-bad">{error}</p>}
    </div>
  )
}
