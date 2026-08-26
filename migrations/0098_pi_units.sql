-- Pi Fleet round - a lightweight CRM/inventory for physical Raspberry Pi
-- kiosk units deployed to tenants (Meg's Cafe live; Tiger Helicopters,
-- Gyroplane Train, Swift Light Flight, Herefordshire Gliding Club
-- queued). Platform-admin only (/platform/pi-fleet), no tenant-facing
-- surface, no data-isolation concerns.
--
-- Deliberately schema-generic (no "airfield"/"café" language, no FK to
-- tenants) - this table is designed to also work as-is for a future
-- Venue-Central spinoff (separate Cloudflare account entirely, per
-- Decision #1 in Shobdon-Central-Decisions.md) if that ever gets built,
-- without implying any actual cross-product connection today.
--
-- tenant_name is plain free text, NOT a foreign key to tenants(id) -
-- some Pis are prepped and get a serial number/hostname assigned before
-- the tenant even exists in the main tenants table yet, so forcing a
-- real tenant link would block recording a unit early. The UI's own
-- "— unassigned —" display fallback for an empty tenant_name is a
-- display-only convenience, not a stored value.
--
-- status is a plain TEXT column with an app-level enum (active | spare |
-- faulty | retired), no CHECK constraint and no separate lookup table -
-- matching tenants.subscription_status and subscription_history.status,
-- both of which use the exact same "plain string, validated in app
-- code" convention rather than a DB-enforced enum.
--
-- wifi_network_name ONLY - deliberately no password column of any kind,
-- not even a nullable/placeholder one. WiFi credentials are set
-- directly on-device via SSH/nmcli and must never be persisted here -
-- see raspberry-pi/README.md for the onboarding flow this supports.
CREATE TABLE pi_units (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_number       TEXT NOT NULL UNIQUE,
    tenant_name         TEXT,
    physical_address    TEXT,
    contact_name        TEXT,
    contact_email       TEXT,
    contact_phone       TEXT,
    wifi_network_name   TEXT,
    date_issued         TEXT,
    hostname            TEXT,
    dashboard_url       TEXT,
    master_image_version TEXT,
    image_source_link   TEXT,
    status              TEXT NOT NULL DEFAULT 'spare',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only dated notes log, same shape as subscription_history
-- (migration 0043) and display_visits (migration 0041) - this
-- codebase's own established pattern for "a running list of timestamped
-- entries tied to a parent record" is a child table, not a JSON column
-- (JSON here is reserved for small, bounded, always-fully-overwritten
-- config blobs - see e.g. club_theme.saved_swatches_json - which a
-- growing notes log is not). No update/delete path exists or should
-- ever exist for this table, in the API or the UI - a correction gets
-- added as a new entry, same as a real CRM activity log.
CREATE TABLE pi_unit_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pi_unit_id  INTEGER NOT NULL,
    note_text   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (pi_unit_id) REFERENCES pi_units(id) ON DELETE CASCADE
);

-- Same shape as idx_subscription_history_tenant_time - every real query
-- here is "this unit's notes, newest first".
CREATE INDEX idx_pi_unit_notes_unit_time ON pi_unit_notes(pi_unit_id, created_at);
