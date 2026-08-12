-- Pilot Panel round: server-persisted custom ticker-style templates for
-- /pilot, mirroring design_templates' exact shape (a named, saved LIST
-- of alternates a tenant can pick from and apply later - genuinely a
-- different concept from pilot_ticker_style_json above, which is the
-- ONE currently-applied style, same distinction design_templates already
-- draws against club_theme). Deliberately server-side rather than the
-- desktop ticker's own localStorage-only tickerStyleStore.ts custom
-- templates - that approach was already confirmed (see design-templates/
-- index.ts's own comment) to never actually reach a tenant's real
-- account, only the one browser it was saved in.
CREATE TABLE pilot_ticker_style_templates (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  styleJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
