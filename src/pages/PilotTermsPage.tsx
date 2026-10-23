import { useEffect } from 'react'
import LegalPageLayout from '../components/LegalPageLayout'
import { PILOT_TERMS_TITLE, pilotTermsMarkdown } from '../content/legalTerms'

// Public, unauthenticated - /pilot-terms. Linked from the always-visible
// on-screen disclaimer on every /pilot view (PilotViewPage.tsx) - see
// that file's own comment. See LegalPageLayout's own comment for the
// shared chrome/deploy-reachability notes.
export default function PilotTermsPage(): JSX.Element {
  useEffect(() => {
    document.title = `${PILOT_TERMS_TITLE} - AirfieldCentral`
  }, [])

  return <LegalPageLayout title={PILOT_TERMS_TITLE} markdown={pilotTermsMarkdown} activePage="pilot-terms" />
}
