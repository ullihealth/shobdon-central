import { useEffect } from 'react'
import LegalPageLayout from '../components/LegalPageLayout'
import { CUSTOMER_TERMS_TITLE, customerTermsMarkdown } from '../content/legalTerms'

// Public, unauthenticated - /terms. See LegalPageLayout's own comment
// for the shared chrome/deploy-reachability notes.
export default function TermsPage(): JSX.Element {
  useEffect(() => {
    document.title = `${CUSTOMER_TERMS_TITLE} - AirfieldCentral`
  }, [])

  // Media Box consent round - this page is reached from a brand-new
  // route navigation (e.g. the Media Box checkbox's /terms#schedule-1
  // link on signup/activation), not a same-page anchor click - this
  // app's router has no scroll-restoration/hash handling anywhere
  // (checked before adding this), so the browser's own native
  // scroll-to-anchor behaviour never fires for a client-side route
  // change. One explicit scroll, after the content (LegalMarkdown,
  // which now gives every heading a real id - see that file's own
  // comment) has had a render pass to mount.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const id = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView()
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  return <LegalPageLayout title={CUSTOMER_TERMS_TITLE} markdown={customerTermsMarkdown} activePage="terms" />
}
