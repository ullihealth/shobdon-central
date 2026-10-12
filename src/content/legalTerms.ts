// Source of truth for AirfieldCentral's real legal text (legal-rollout
// round, Oct 2026), replacing the July 2026 "NOT FINAL" placeholder that
// used to live in the onboarding_content D1 table (migration 0032/0042).
//
// Deliberately a committed, typed code module - NOT the onboarding_content
// DB row - for three reasons specific to this content:
//   1. Versioning is now a CODE concept (TERMS_VERSION below). Keeping the
//      text itself in the same deploy as the version number that
//      identifies it is what makes "did this user accept the CURRENT
//      version" a meaningful question - a DB row editable independently
//      of a deploy could drift out of sync with whatever version number
//      the backend thinks is current.
//   2. The text needs real structural rendering (headings, numbered
//      clauses, an actual table for Part B's data-use table) -
//      onboarding_content's own text_text/privacy_text columns only ever
//      supported plain text with paragraph splitting (see that table's
//      own migration comment), which cannot represent a table at all.
//   3. This is now a reviewed legal document with a git history worth
//      having (diffable, blameable, matches the "solicitor review before
//      publish" workflow this round's source file describes) rather than
//      a content-edit with no audit trail beyond an updated_at column.
//
// videos_json (the onboarding gate's own "Getting started" video
// placeholders) stays exactly where it was, in onboarding_content - only
// terms_text/privacy_text are superseded by this file. See
// PlatformOnboardingContentPage.tsx's own comment for how its now-dead
// terms/privacy edit fields were handled.
//
// Transcribed VERBATIM from MD FILES/legal/airfieldcentral-legal-v1.md's
// Parts A/B/C (the internal "Draft status and points for solicitor
// review" section is intentionally never represented here - it must
// never be published). Only two kinds of change were made relative to
// that source, both structural, not wording:
//   - Each Part's own "## Part A: ..."/"**Version 1.0. Effective date:
//     [...]**" lines are NOT included in the markdown bodies below -
//     those two pieces of information are rendered programmatically from
//     TERMS_VERSION/TERMS_EFFECTIVE_DATE instead, by every page that
//     shows this content, so the displayed version/date can never drift
//     from what's actually recorded in the database on acceptance.
//   - The two short UI strings at the very end of the source file (the
//     Pilot's App on-screen disclaimer and the Reception Dashboard/Media
//     Screen footer line) are pulled out as their own constants, since
//     they're copy for small UI elements elsewhere, not part of the
//     Pilot's App Terms of Use document itself.

// Bump this (and update the source markdown below) the next time the
// legal text changes. Every acceptance is stamped with whatever this
// equals at the moment of acceptance (see functions/api/tenant/terms/
// accept.ts) - a user whose stored version != this one is re-prompted by
// RequireAuth.tsx's existing mandatory gate on their next back-office
// login, with no separate migration needed per bump.
export const TERMS_VERSION = "1.0";

// The real publication date, set by Jeff at deploy time (2026-10-12 -
// confirmed against the system clock at the moment of deploy, not just
// carried over from the drafting date, which happened to be the same
// day). Update this (and bump TERMS_VERSION) together, in one commit,
// the next time the legal text itself changes.
export const TERMS_EFFECTIVE_DATE = "2026-10-12";

export const CUSTOMER_TERMS_TITLE = "AirfieldCentral Customer Terms";
export const PRIVACY_POLICY_TITLE = "AirfieldCentral Privacy Policy";
export const PILOT_TERMS_TITLE = "AirfieldCentral Pilot's App Terms of Use";

// Part A (Customer Terms) + Schedule 1 (Media Box Loan) - verbatim.
export const customerTermsMarkdown = `### 1. About us

1.1 AirfieldCentral is provided by Jeff Thompson, trading as Airfield Central ("we", "us", "our"), of Airfield Central, 61 Bridge Street, Kington, HR5 3DJ. Contact: support@airfieldcentral.com.

1.2 These terms apply between us and the business that subscribes to AirfieldCentral ("you", "the Customer"). By ticking the acceptance box, signing an order form or paying a subscription, you agree to these terms on behalf of your business.

1.3 AirfieldCentral is supplied to businesses and clubs only, not to consumers.

### 2. Definitions

- **Service:** the AirfieldCentral platform, including the Reception Dashboard, the Pilot's App, the Media Screen and any other features included in your plan.
- **Plan:** the package and price shown on your order, checkout page or invoice.
- **Media Box:** any display device we lend you to run the Service on a screen (see Schedule 1).
- **Your Content:** text, images, video, notices and other material you upload or enter into the Service.
- **Users:** your staff, members and visitors who view or use the Service through your account or your public pages.

### 3. The Service

3.1 We will provide the Service described in your Plan using reasonable skill and care.

3.2 We may improve, change or withdraw features from time to time. We will not materially reduce the core features of your Plan during a paid period without giving you at least 30 days' notice, and you may cancel without penalty if we do.

3.3 The Service relies on third-party providers, including hosting, payment processing, and weather and aeronautical data sources. We are not responsible for their availability or accuracy.

### 4. Availability and support

4.1 We aim to keep the Service available at all times but do not guarantee uninterrupted or error-free operation. Planned maintenance, internet outages, and third-party failures may cause interruptions.

4.2 Support is available by email at support@airfieldcentral.com. We aim to respond within 2 working days.

### 5. Weather, aviation and safety disclaimer

5.1 **The Service is for general information only. It is not an aeronautical information service, a flight-planning tool, or a substitute for official sources.**

5.2 Weather, wind, runway, NOTAM, circuit and other operational information shown by the Service may be delayed, incomplete, estimated or incorrect. Weather from Met Office data is provided as a standard feature. Weather from your own or a shared weather station is provided on a best-effort basis only and may stop, fail or fall back to other sources without notice.

5.3 Pilots and operators must obtain and rely on official sources (including METARs, TAFs, NOTAMs, Air Traffic Services and the aircraft commander's own judgement) for all flight planning and operational decisions.

5.4 You are responsible for any operational information you enter (for example runway status, notices and safety messages) and for keeping it current. You must not present the Service to your Users as an official or authoritative source.

### 6. Your account and responsibilities

6.1 You must keep login details secure and tell us promptly if you suspect unauthorised access. You are responsible for activity under your account.

6.2 You must not use the Service unlawfully, upload content that infringes anyone's rights or is offensive, attempt to access other customers' data, or interfere with the Service's security or operation.

6.3 You are responsible for providing a suitable screen, power supply and internet connection at your premises.

### 7. Your Content

7.1 You keep ownership of Your Content. You grant us a licence to host, copy and display it only as needed to provide the Service.

7.2 You confirm you have the right to use Your Content, including any images of identifiable people, and that it complies with the law and advertising standards.

7.3 We may remove content that breaches these terms or that we reasonably believe is unlawful.

### 8. Reserved AirfieldCentral slots and advertising

8.1 Where your Plan includes a media carousel, some slots may be reserved for us ("Reserved AirfieldCentral Slots"). We control the content of those slots, which may include third-party advertising.

8.2 Any revenue share or slot arrangement will be set out in your order or a separate written agreement. You must not alter, remove or obscure Reserved AirfieldCentral Slots.

### 9. Fees and payment

9.1 You will pay the fees for your Plan monthly in advance by card through our payment provider, Stripe. Fees are stated exclusive of VAT, which will be added if and when we are VAT-registered.

9.2 There is no free trial. Your first payment is taken when you subscribe.

9.3 If a payment fails, we will tell you and Stripe will retry. If payment remains outstanding 14 days after the due date, we may suspend the Service until it is paid.

9.4 We may change our prices by giving you at least 30 days' notice. If you do not agree, you may cancel before the change takes effect.

### 10. Term and cancellation

10.1 Your subscription has a minimum term of 3 months from the start date. After that it continues month to month.

10.2 You may cancel by email to support@airfieldcentral.com, giving at least 30 days' notice, to take effect at the end of a billing month after the minimum term. Fees already paid are not refundable, except as stated in clause 3.2.

10.3 We may cancel your subscription by giving you 30 days' notice.

### 11. Suspension and termination

11.1 We may suspend or terminate the Service immediately if you materially breach these terms and do not fix the breach within 14 days of notice, if you fail to pay as described in clause 9.3, or if your use threatens the security or stability of the Service.

11.2 On termination, your access ends, you must return any Media Box under Schedule 1, and we may delete Your Content after 30 days. Please export anything you need before then.

### 12. Liability

12.1 Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law.

12.2 We are not liable for any loss arising from reliance on weather, aviation or operational information shown by the Service (see clause 5), or for any loss of profit, revenue, business, goodwill or data, or any indirect or consequential loss.

12.3 Our total liability to you in any 12-month period is limited to the fees you paid us in that period.

### 13. Data protection

13.1 We handle personal data as described in our Privacy Policy (Part B).

13.2 Where we process personal data on your behalf (for example names of your staff who use your account), we do so only to provide the Service, keep it secure and confidential, and help you meet your data protection obligations.

### 14. Intellectual property

14.1 We own all rights in the Service, its software and design. You receive a non-exclusive right to use the Service during your subscription.

### 15. Changes to these terms

15.1 We may update these terms. We will notify you of material changes at least 30 days in advance, and you may be asked to accept the new version when you next log in. If you do not agree, you may cancel before the changes take effect.

### 16. General

16.1 These terms, your order and Schedule 1 (if applicable) are the whole agreement between us. If any part is found unenforceable, the rest remains in force.

16.2 You may not transfer your subscription without our written consent. Neither party is liable for delays caused by events beyond its reasonable control.

16.3 Notices to us go to support@airfieldcentral.com or our postal address in clause 1.1. Notices to you go to the email address on your account.

### 17. Governing law

17.1 These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.

## Schedule 1: Media Box Loan

This schedule applies only if we lend you a Media Box. It forms part of the Customer Terms.

### S1. Ownership

S1.1 The Media Box (including its power supply, cables, case and storage card) remains our property at all times. It is lent to you for use with the Service only, at the premises named in your order.

S1.2 You must not sell, lend, modify, open, re-image or install software on the Media Box, or let anyone else do so, without our written consent.

### S2. Care and use

S2.1 You must take reasonable care of the Media Box, keep it indoors in a dry, ventilated place, and use only the power supply we provide.

S2.2 You must keep the Media Box powered on and connected to the internet so we can monitor and update it remotely. You consent to us accessing the Media Box remotely to support, update and maintain it.

S2.3 You must tell us promptly if the Media Box is lost, stolen, damaged or stops working.

### S3. Faults

S3.1 If the Media Box develops a fault through normal use, we will repair or replace it at no charge to you.

### S4. Card charge authority

S4.1 By accepting these terms you authorise us to charge the payment card saved on your subscription up to **£99 per incident** if:

1. the Media Box is lost or stolen while in your care;
2. the Media Box is damaged other than through normal use and needs repair or replacement during your subscription; or
3. the Media Box is not returned within 14 days of your subscription ending, or is returned damaged.

S4.2 We will tell you by email before taking any charge, explaining the reason, and give you 7 days to respond. No money is taken or held when you subscribe.

S4.3 Where we supply a replacement Media Box, this schedule applies to the replacement in the same way.

S4.4 If your card cannot be charged, the amount becomes a debt payable within 14 days of our invoice.

### S5. Return

S5.1 When your subscription ends, you must return the Media Box and its accessories in good condition (normal wear excepted) within 14 days, either by handing it to us or by post using packaging we approve. We will agree the method with you.`;

// Part B (Privacy Policy) - verbatim.
export const privacyPolicyMarkdown = `### Who we are

AirfieldCentral is run by Jeff Thompson, trading as Airfield Central, 61 Bridge Street, Kington, HR5 3DJ. We are the data controller for the information described below. Questions or requests: support@airfieldcentral.com.

### What we collect and why

| Information | Whose | Why we use it | Legal basis | How long we keep it |
| --- | --- | --- | --- | --- |
| Name, email address, login details | Customer account users (e.g. staff who manage a dashboard) | To provide and secure your account | Contract | While the account is active, then up to 30 days |
| Billing name, email, address; card details (held by Stripe, not us) | The paying customer | To take subscription payments | Contract; legal obligation (accounts) | 6 years for accounting records |
| Access logs, including IP address, browser type and time of visit | Anyone visiting AirfieldCentral pages | Security, troubleshooting and preventing abuse | Legitimate interests | 30 days |
| Display visit records (which screen or page was viewed, when) | Devices and visitors viewing dashboards | To confirm screens are working and, for advertising, how often content is shown | Legitimate interests | Normally 30 days |
| Messages you send us | Anyone contacting support | To answer you | Legitimate interests | Up to 2 years |

**The Pilot's App is read-only.** Pilots and visitors cannot create accounts or enter personal information in it. The only data it generates is the technical access information above.

### Who we share it with

We do not sell personal data. We use these service providers to run AirfieldCentral:

- **Cloudflare:** hosting, storage and security.
- **Stripe:** payment processing.
- We do not use any email-sending service to process your personal data. Support emails are handled from our own mailbox.

Some providers may process data outside the UK. Where they do, we rely on appropriate safeguards such as the UK International Data Transfer Addendum or adequacy regulations.

### Cookies and local storage

We use cookies and browser storage that are strictly necessary to log you in and remember display settings. We do not use analytics, advertising or tracking cookies, and no third-party tracking scripts run on AirfieldCentral pages.

### Your rights

You can ask to access, correct or delete your personal data, object to or restrict how we use it, or ask for a copy to take elsewhere. Email support@airfieldcentral.com. We will respond within one month.

If you are unhappy with how we handle your data, you can complain to the Information Commissioner's Office (ico.org.uk).

### Changes

We will post any changes on this page and update the version and date above.`;

// Part C (Pilot's App Terms of Use) - verbatim.
export const pilotTermsMarkdown = `The Pilot's App is provided by Jeff Thompson, trading as Airfield Central, on behalf of the airfield or operator whose name appears on it. By using it you agree to these terms.

1. **Information only.** The Pilot's App shows general information about conditions at the airfield. It is not an official aeronautical information service and must not be used for flight planning or as a substitute for official sources.
2. **Use official sources.** Before and during any flight, obtain current information from official sources, including METARs, TAFs, NOTAMs and Air Traffic Services. The aircraft commander remains responsible for all operational decisions.
3. **Accuracy.** Weather, wind, runway and notice information may be delayed, estimated, incomplete or wrong, and may switch between data sources without notice.
4. **No liability.** To the extent the law allows, neither Airfield Central nor the airfield operator is liable for any loss arising from reliance on the Pilot's App.
5. **Privacy.** The Pilot's App does not ask for or store your personal information. Our servers keep basic access logs (including IP address) for 30 days for security. See our Privacy Policy.
6. **Law.** These terms are governed by the law of England and Wales.

Questions: support@airfieldcentral.com.`;

// The two short UI strings from the end of the source file - copy for
// small UI elements (the Pilot's App on-screen disclaimer and the
// Reception Dashboard/Media Screen footer line), not part of the Pilot's
// App Terms of Use document body above. Verbatim except the literal
// "[Terms of use]" marker, which the source itself describes as a link -
// PILOT_DISCLAIMER_LINK_TEXT is that link's own label, rendered as a
// real <Link to="/pilot-terms"> by whichever component uses it, per the
// task's own "followed by a 'Terms of use' link to /pilot-terms" spec.
export const PILOT_DISCLAIMER_TEXT =
  "For information only. Not for flight planning. Always check official sources (METAR, TAF, NOTAM, ATS).";
export const PILOT_DISCLAIMER_LINK_TEXT = "Terms of use";

export const DASHBOARD_FOOTER_TEXT = "Information only, not for flight planning. Check official sources.";
