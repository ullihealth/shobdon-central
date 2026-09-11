-- Pilot Panel round: server-persisted custom colour-scheme templates for
-- /pilot's independent mobile theme (background + compass + info-panel +
-- text colours, all bundled under pilotBackgroundOverride - see
-- functions/api/tenant/pilot-view.ts's own BackgroundOverrideInput).
-- Deliberately its OWN table, not a `scope` column added to
-- design_templates (Screens Design's own template library) - this exact
-- fork was already decided one round ago for pilot_ticker_style_templates
-- (migration 0087), which mirrors design_templates' shape rather than
-- reusing its table, precisely because the desktop table's own
-- tokensJson/gradientMode/baseColour shape is a DIFFERENT, desktop-
-- specific bundle (~26 CSS custom properties) from pilotBackgroundOverride's
-- much smaller, pilot-specific one - following that same precedent here
-- rather than reopening a decision already made and shipped.
--
-- Same shape/conventions as pilot_ticker_style_templates: TEXT PRIMARY
-- KEY (crypto.randomUUID()), camelCase columns, organizationId FK with
-- ON DELETE CASCADE, own index. themeJson stores the full
-- BackgroundOverride object (backgroundColor required, every other
-- field optional) exactly as pilot_background_override_json itself does
-- - a template is "a named, saved alternate of that same shape", not a
-- new concept of its own.
CREATE TABLE pilot_background_templates (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  themeJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX idx_pilot_background_templates_org ON pilot_background_templates(organizationId);
