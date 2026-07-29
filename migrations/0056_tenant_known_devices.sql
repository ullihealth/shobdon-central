-- Phase B of the visit-log uptime work: Jeff-confirmed "this IP is a
-- known device for this tenant+display" record, backing both the
-- suggestion-review UI and (Phase C, a later migration) the uptime
-- report's "only count visits from a confirmed device" filter.
--
-- Scoped by tenant_id + display_slug, not just tenant_id - confirmed
-- via direct D1 query (2026-07) that Shobdon alone already logs two
-- distinct real display_slug values ('main', 'cafe-tv') with very
-- different IP-stability profiles (2 distinct IPs on cafe-tv vs. 57 on
-- main), so a single "known IP" per tenant would conflate two
-- physically different screens.
--
-- status distinguishes "this IS a real device" (confirmed) from "this
-- IP showed up in the suggestion list but isn't legit - dev traffic,
-- a one-off visitor, etc." (dismissed) - both need to stop being
-- re-suggested, but only 'confirmed' rows should ever count toward an
-- uptime calculation. active is separate from status: a previously
-- confirmed IP that's been explicitly retired (e.g. the venue's ISP
-- gave it a new IP and Jeff confirmed the new one) is active=0 rather
-- than deleted, keeping the historical record intact for audit
-- purposes, but excluded from the CURRENT known-IP set new uptime
-- reports use. A retired (active=0) IP remains eligible for
-- re-suggestion if it reappears later - only currently-active rows
-- (confirmed or dismissed) suppress the suggestion list, since a
-- dormant IP coming back into use is new signal worth re-asking about.
--
-- UNIQUE(tenant_id, display_slug, ip_address) - one row per IP per
-- tenant+display; re-confirming or re-dismissing an existing IP is an
-- UPDATE (INSERT ... ON CONFLICT), not a new row, so history doesn't
-- accumulate duplicate decisions about the same IP.
CREATE TABLE tenant_known_devices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_slug    TEXT NOT NULL,
  ip_address      TEXT NOT NULL,
  label           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'dismissed')),
  active          INTEGER NOT NULL DEFAULT 1,
  confirmed_at    TEXT NOT NULL,
  UNIQUE(tenant_id, display_slug, ip_address)
);

-- Backs both the "known IPs for this tenant+display" lookup (Phase C's
-- uptime query) and the "exclude already-decided IPs" filter the
-- suggestion query runs on every load.
CREATE INDEX idx_tenant_known_devices_tenant_display ON tenant_known_devices(tenant_id, display_slug, active);
