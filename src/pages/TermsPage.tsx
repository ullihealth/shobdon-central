import { useEffect } from 'react'
import LegalPageLayout from '../components/LegalPageLayout'
import { CUSTOMER_TERMS_TITLE, customerTermsMarkdown } from '../content/legalTerms'

// Public, unauthenticated - /terms. See LegalPageLayout's own comment
// for the shared chrome/deploy-reachability notes.
export default function TermsPage(): JSX.Element {
  useEffect(() => {
    document.title = `${CUSTOMER_TERMS_TITLE} — AirfieldCentral`
  }, [])

  return <LegalPageLayout title={CUSTOMER_TERMS_TITLE} markdown={customerTermsMarkdown} activePage="terms" />
}
