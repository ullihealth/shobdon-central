-- One row per tenant (same shape as club_theme) - the ATC-control page's
-- dynamic Ops Panel state: which runway end is currently active, which
-- way the circuit runs, the free-text airfield info line, and up to 4
-- manual safety notice rows. safetyNoticesJson is a JSON string[] rather
-- than 4 separate columns - the rows are always read/written together as
-- an ordered, bounded set (max 4, enforced in the route handler, not
-- here), matching club_theme.tokensJson's precedent rather than
-- camera_slots' fixed-slot-with-composite-PK shape (that pattern fits
-- when slots are independently addressable; these aren't).
CREATE TABLE IF NOT EXISTS ops_panel_state (
  organizationId TEXT PRIMARY KEY,
  activeRunwayEnd TEXT NOT NULL, -- e.g. '08' or '26' - literal match to one half of runwayGroups[0].label, not a fixed enum
  circuitDirection TEXT NOT NULL, -- 'left' | 'right'
  airfieldInfoText TEXT NOT NULL,
  safetyNoticesJson TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);

-- Seed values chosen to exactly match RightInfoPanel.tsx's current
-- hardcoded strings, so deploying this causes zero visible change to
-- Circuit Direction ("Left-hand") or Airfield Info ("PPR only after
-- 17:00") until ATC actually uses the new page. Runway Status is the one
-- exception: today's static display is the full "08/26 Open" label; the
-- new design only ever shows one active end, so seeding activeRunwayEnd
-- = '08' (the first-listed identifier, no operational reason to prefer
-- '26') changes that one card's text from "08/26 Open" to "08 Open" -
-- expected and correct per the new design, confirmed not a bug.
INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, updatedAt)
SELECT 'org_shobdon', '08', 'left', 'PPR only after 17:00', '[]', '2026-07-11T00:00:00.000Z'
WHERE NOT EXISTS (
  SELECT 1 FROM ops_panel_state WHERE organizationId = 'org_shobdon'
);
