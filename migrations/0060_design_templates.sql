-- Real backend persistence for Screens Design's "Save as template"
-- feature (Backgrounds tab, Custom sub-view) - confirmed last round to
-- have never touched the backend at all: it only wrote to
-- window.localStorage (src/services/designTemplateStore.ts,
-- 'shobdon-central.design-templates.v1'), so a saved template was
-- invisible outside the one browser it was saved in. This table plus
-- functions/api/tenant/design-templates/* replace that.
--
-- Mirrors media_folders' own shape/conventions exactly (migration 0020):
-- TEXT PRIMARY KEY (crypto.randomUUID(), not autoincrement), camelCase
-- columns, organizationId FK with ON DELETE CASCADE, own index. tokens
-- stored as tokensJson (one JSON blob of the ~26 '--color-*' CSS custom
-- properties, DesignTokens in designTemplateStore.ts) rather than one
-- column per token - same reasoning club_theme.tokensJson already
-- established for the tenant's own single live theme: this is a fixed,
-- cohesive bundle always read/written together, never queried by
-- individual token.
--
-- gradientMode/baseColour mirror DesignTemplate's own optional fields
-- (designTemplateStore.ts) exactly, not guessed - gradientMode defaults
-- 'gradient' (every template saved before that field existed behaves
-- the same way client-side); baseColour is nullable and, as of this
-- migration, never actually set by any save path (handleSaveAsTemplate/
-- handleDuplicate/handleImportFile) - only the two built-in presets
-- (Current Live Theme, Bright Blue, neither of which lives in this
-- table) carry one today. Stored anyway for shape fidelity and so a
-- future tagging feature has somewhere to write it without a further
-- migration.
CREATE TABLE IF NOT EXISTS design_templates (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  tokensJson TEXT NOT NULL,
  gradientMode TEXT NOT NULL DEFAULT 'gradient',
  baseColour TEXT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_design_templates_org ON design_templates(organizationId);
