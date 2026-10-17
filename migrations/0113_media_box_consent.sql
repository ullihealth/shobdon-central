-- Media Box loan consent round (Customer Terms Schedule 1) - a second,
-- separate, mandatory consent distinct from general Customer Terms
-- acceptance (user.termsAcceptedAt/Version/Ip, migration 0108/0111).
-- The Schedule 1 card-charge authority (up to £99/incident) is a more
-- significant commitment than ordinary ToS acceptance, so it gets its
-- own explicit opt-in and its own audit trail, even though the general
-- Terms checkbox already mentions Schedule 1 in passing.
--
-- Stored on tenants, NOT user (unlike termsAccepted*) - go-ahead's own
-- instruction: the Media Box is tenant-level equipment, and consent
-- should travel with the tenant regardless of which individual member
-- happened to give it (whoever activates/signs up on a tenant's behalf).
ALTER TABLE tenants ADD COLUMN media_box_consent_at TEXT;
ALTER TABLE tenants ADD COLUMN media_box_consent_version TEXT;
ALTER TABLE tenants ADD COLUMN media_box_consent_ip TEXT;

-- Simple "box issued/returned" tracking (go-ahead's Step 4, optional).
-- pi_units (migration 0098) was checked first for a real link to reuse
-- - its own tenant_name column is deliberately free text, not a FK to
-- tenants (that migration's own comment: "some Pis are prepped and get
-- a serial number/hostname assigned before the tenant even exists"),
-- so there is no existing real tenant<->box link to reuse. These are
-- simple, independent fields instead of building a real FK relationship
-- neither table currently supports.
ALTER TABLE tenants ADD COLUMN media_box_identifier TEXT;
ALTER TABLE tenants ADD COLUMN media_box_issued_date TEXT;
ALTER TABLE tenants ADD COLUMN media_box_returned_date TEXT;

-- Per-activation-link toggle (go-ahead's Step 1) - "per-link option...
-- default ON when I create the link". 1/0 (SQLite has no native
-- boolean), same convention as every other flag column in this schema.
-- NOT NULL DEFAULT 1 so existing rows (today's activation_links, all
-- created before this feature existed) read as "yes" rather than NULL
-- - the safer default for a loan-equipment flag no one explicitly set.
ALTER TABLE activation_links ADD COLUMN includes_media_box INTEGER NOT NULL DEFAULT 1;
