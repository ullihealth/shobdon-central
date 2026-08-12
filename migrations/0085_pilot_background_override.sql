-- Pilot Panel round: lets a tenant independently override /pilot's
-- background colour instead of always inheriting the shared club_theme
-- (the same one-shared-theme record the desktop dashboard uses - see
-- club_theme's own comments). Nullable, no DEFAULT - presence/absence
-- of this JSON blob IS the on/off state (NULL = inherit club_theme
-- exactly as every existing tenant does today, unaffected by this
-- migration; a JSON object = override active), rather than a separate
-- boolean flag that could drift out of sync with a null colour value.
-- Shape when set: {"backgroundColor": "#rrggbb"}.
ALTER TABLE tenants ADD COLUMN pilot_background_override_json TEXT;
