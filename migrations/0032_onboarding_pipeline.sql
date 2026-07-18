-- Onboarding pipeline: invite-link tenant provisioning + mandatory
-- Terms/Privacy consent gate. Additive only.

-- Per-user (not per-tenant) consent flag - individual legal consent is a
-- person-level fact, not an organization-level one, and this also lets a
-- second member invited later accept independently. NULL = not yet
-- accepted. Backfilled below so this never disrupts an existing account
-- (Shobdon's real owner, Demo's/newcustomer's dev account) with a forced
-- re-consent gate on their next login - the gate only meaningfully
-- applies going forward, to accounts created via the new invite flow.
ALTER TABLE user ADD COLUMN termsAcceptedAt TEXT;
UPDATE user SET termsAcceptedAt = datetime('now') WHERE termsAcceptedAt IS NULL;

-- Single-use invite tokens minted by /api/platform/tenants/onboard,
-- consumed by /api/public/onboard/:token/accept. used_at NULL = still
-- valid; set once and never reused. tenant_id/organization_id both kept
-- (rather than joining tenants.organization_id every time) since the
-- accept flow needs both directly and a tenant's org link is nullable in
-- general even though it won't be for a freshly-created row here.
CREATE TABLE tenant_invites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token           TEXT NOT NULL UNIQUE,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    organization_id TEXT NOT NULL REFERENCES organization(id),
    created_by      TEXT NOT NULL REFERENCES user(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL,
    used_at         TEXT
);
CREATE INDEX idx_tenant_invites_token ON tenant_invites(token);

-- Global (not per-tenant), developer-only-editable content shown on the
-- mandatory onboarding gate and the ongoing /help page: a handful of
-- video placeholders and the Terms/Privacy text. Singleton via the CHECK
-- constraint - this project has no existing "one global settings row"
-- table, so this is deliberately the smallest possible shape for it
-- (a single row, not a key/value table) rather than a new subsystem.
-- terms_text/privacy_text are stored as PLAIN TEXT (paragraphs split on
-- blank lines at render time), not HTML - zero injection surface even
-- though only requirePlatformAdmin can ever write it, and the real
-- legal text (pending proper legal review) can be dropped in later as a
-- pure content edit, no code changes.
CREATE TABLE onboarding_content (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    videos_json   TEXT NOT NULL DEFAULT '[]',
    terms_text    TEXT NOT NULL DEFAULT '',
    privacy_text  TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO onboarding_content (id, videos_json, terms_text, privacy_text)
VALUES (
    1,
    '[{"id":"video-1","title":"Welcome to Airfield Central","url":""},{"id":"video-2","title":"Setting Up Your Dashboard","url":""},{"id":"video-3","title":"Getting Help","url":""}]',
    '[PLACEHOLDER TERMS & CONDITIONS - NOT FINAL, PENDING LEGAL REVIEW]

This is dummy placeholder text standing in for the real Terms & Conditions, which have not yet been drafted or reviewed by counsel. Do not treat any of the following as binding.

1. Acceptance of Terms. By accessing or using this service, you agree to be bound by these placeholder terms, which exist solely to exercise the scroll-gate and consent-recording mechanism.

2. Use of Service. This placeholder section would normally describe permitted and prohibited uses of the dashboard, API access, and any embedded displays.

3. Account Responsibilities. This placeholder section would normally describe the account holder''s responsibility for credentials, member management, and content uploaded to the service.

4. Termination. This placeholder section would normally describe the conditions under which access may be suspended or terminated by either party.

5. Limitation of Liability. This placeholder section would normally set out liability limits and disclaimers.

6. Changes to Terms. This placeholder section would normally describe how updates to these terms are communicated and whether re-acceptance is required.

[END OF PLACEHOLDER TEXT - real content to be supplied later]',
    '[PLACEHOLDER PRIVACY POLICY - NOT FINAL, PENDING LEGAL REVIEW, INTENDED TO COVER GDPR]

This is dummy placeholder text standing in for the real Privacy Policy, which has not yet been drafted or reviewed by counsel. Do not treat any of the following as binding.

1. Data Controller. This placeholder section would normally identify the data controller and contact details for data protection queries.

2. What Data We Collect. This placeholder section would normally describe account data, usage data, and any weather/operational data processed on the tenant''s behalf.

3. Legal Basis for Processing (GDPR). This placeholder section would normally set out the legal basis (contract, consent, legitimate interest) for each category of processing.

4. Data Retention. This placeholder section would normally describe how long data is kept and deletion procedures.

5. Your Rights. This placeholder section would normally describe access, rectification, erasure, and portability rights under GDPR, and how to exercise them.

6. International Transfers. This placeholder section would normally describe any transfer of data outside the UK/EEA and the safeguards in place.

7. Changes to This Policy. This placeholder section would normally describe how updates are communicated.

[END OF PLACEHOLDER TEXT - real content to be supplied later]'
);
