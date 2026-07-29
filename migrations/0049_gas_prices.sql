-- One row per tenant (same shape as ops_panel_state/club_theme) - the
-- dedicated Gas Prices store (Dashboard Manager's new Gas Prices
-- container), deliberately separate from ops_panel_state/safetyNotices
-- rather than a 4th generic slot type: exactly 3 FIXED fuel types
-- (Avgas/UL91/Jet A1), not a repeatable list, so 3 real columns fit
-- better here than ops_panel_state's JSON-array-of-rows pattern (that
-- pattern fits an open-ended, admin-orderable set; this is a closed,
-- always-exactly-3 set with no ordering or add/remove concept).
-- Price columns are nullable - NULL means "not set", so a tenant that's
-- never touched this page shows no gas price tiles at all on the live
-- dashboard rather than three tiles reading "£0.00" (same "no sensible
-- default" posture as ops_panel_state.airfieldInfoText already takes,
-- see RightInfoPanel.tsx). currency is a single shared setting (not
-- per-price) applying to all three, stored as the literal symbol
-- (£/$/€) rather than an ISO code, since that's the only place it's
-- ever rendered - no formatting/lookup step needed downstream.
CREATE TABLE IF NOT EXISTS gas_prices (
  organizationId TEXT PRIMARY KEY,
  avgasPrice REAL,
  ul91Price REAL,
  jetA1Price REAL,
  currency TEXT NOT NULL DEFAULT '£',
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
