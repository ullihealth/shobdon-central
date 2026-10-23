import { Link } from 'react-router-dom'
import { SUBSCRIPTION_NOT_ACTIVE_MESSAGE } from '../../utils/subscriptionLock'

// Top-of-admin banner shown to a SUSPENDED tenant's non-developer users.
export function SubscriptionLockBanner(): JSX.Element {
  return (
    <div
      role="alert"
      className="sticky top-0 z-30 border-b border-amber-500/50 bg-amber-950/90 px-6 py-3 text-sm font-semibold text-amber-200 backdrop-blur"
    >
      {SUBSCRIPTION_NOT_ACTIVE_MESSAGE}
    </div>
  )
}

// Shown INSTEAD of a locked admin page on direct navigation.
export function SubscriptionLockedPanel(): JSX.Element {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-amber-300">Subscription not active</h1>
      <p className="mb-6 text-sm text-muted-400">{SUBSCRIPTION_NOT_ACTIVE_MESSAGE}</p>
      <Link to="/account" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
        Go to My Account →
      </Link>
    </div>
  )
}
