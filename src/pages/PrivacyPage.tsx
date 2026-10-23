import { useEffect } from 'react'
import LegalPageLayout from '../components/LegalPageLayout'
import { PRIVACY_POLICY_TITLE, privacyPolicyMarkdown } from '../content/legalTerms'

// Public, unauthenticated - /privacy. See LegalPageLayout's own comment
// for the shared chrome/deploy-reachability notes.
export default function PrivacyPage(): JSX.Element {
  useEffect(() => {
    document.title = `${PRIVACY_POLICY_TITLE} - AirfieldCentral`
  }, [])

  return <LegalPageLayout title={PRIVACY_POLICY_TITLE} markdown={privacyPolicyMarkdown} activePage="privacy" />
}
